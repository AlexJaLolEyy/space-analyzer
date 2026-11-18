//! Fast directory walker: every directory is listed exactly once with a single
//! `GetFileInformationByHandleEx(FileFullDirectoryInfo)` loop that returns name, size,
//! attributes and mtime together. Directories are processed by a work-stealing pool and
//! results are collected in per-directory batches that are merged into columns at the end.

use super::{is_cancelled, Progress, ProgressFn, RawScan, F_DIR, F_USED, NONE};
use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, GetDiskFreeSpaceExW, GetFileInformationByHandleEx, FILE_FLAG_BACKUP_SEMANTICS, FILE_LIST_DIRECTORY,
    FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};

const FILE_FULL_DIR_INFO_CLASS: i32 = 14;
const FILE_FULL_DIR_RESTART_INFO_CLASS: i32 = 15;
const ATTR_DIRECTORY: u32 = 0x10;
const ATTR_REPARSE_POINT: u32 = 0x400;
const ATTR_RECALL_ON_OPEN: u32 = 0x0004_0000;
const ATTR_RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;

thread_local! {
    static LIST_BUF: RefCell<Vec<u8>> = RefCell::new(vec![0u8; 128 * 1024]);
}

struct Batch {
    base_id: u32,
    parent: u32,
    flags: Vec<u8>,
    size: Vec<u64>,
    alloc: Vec<u64>,
    mtime: Vec<u32>,
    name_len: Vec<u16>,
    names: Vec<u8>,
}

struct Ctx {
    cancel: Arc<AtomicBool>,
    next_id: AtomicU32,
    batches: Mutex<Vec<Batch>>,
    files: AtomicU64,
    bytes: AtomicU64,
}

fn filetime_to_unix(ft: i64) -> u32 {
    const EPOCH_DIFF: i64 = 11_644_473_600;
    let secs = ft / 10_000_000 - EPOCH_DIFF;
    secs.clamp(0, u32::MAX as i64) as u32
}

fn to_wide_extended(path: &str) -> Vec<u16> {
    let ext = if let Some(rest) = path.strip_prefix(r"\\") {
        format!(r"\\?\UNC\{}", rest)
    } else {
        format!(r"\\?\{}", path)
    };
    ext.encode_utf16().collect()
}

/// `total - free` of a drive root (0 if unknown).
fn drive_used_bytes(root: &str) -> u64 {
    let mut wide: Vec<u16> = root.encode_utf16().collect();
    if wide.last() != Some(&(b'\\' as u16)) {
        wide.push(b'\\' as u16);
    }
    wide.push(0);
    let (mut total, mut free) = (0u64, 0u64);
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), std::ptr::null_mut(), &mut total, &mut free) };
    if ok == 0 {
        0
    } else {
        total.saturating_sub(free)
    }
}

fn rd_u32(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}

fn rd_i64(b: &[u8], o: usize) -> i64 {
    let mut a = [0u8; 8];
    a.copy_from_slice(&b[o..o + 8]);
    i64::from_le_bytes(a)
}

/// Lists one directory. Returns the batch (ids not assigned yet) and subdirectories to descend into
/// as `(index in batch, wide path)`.
fn list_dir(wide_dir: &[u16]) -> (Batch, Vec<(u32, Vec<u16>)>) {
    let mut batch = Batch {
        base_id: 0,
        parent: 0,
        flags: Vec::new(),
        size: Vec::new(),
        alloc: Vec::new(),
        mtime: Vec::new(),
        name_len: Vec::new(),
        names: Vec::new(),
    };
    let mut subdirs: Vec<(u32, Vec<u16>)> = Vec::new();

    let mut path0: Vec<u16> = wide_dir.to_vec();
    path0.push(0);
    let handle = unsafe {
        CreateFileW(
            path0.as_ptr(),
            FILE_LIST_DIRECTORY,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            0,
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return (batch, subdirs);
    }

    LIST_BUF.with(|cell| {
        let mut buf = cell.borrow_mut();
        let mut class = FILE_FULL_DIR_RESTART_INFO_CLASS;
        loop {
            let ok = unsafe {
                GetFileInformationByHandleEx(
                    handle,
                    class,
                    buf.as_mut_ptr().cast(),
                    buf.len() as u32,
                )
            };
            if ok == 0 {
                break; // ERROR_NO_MORE_FILES or an error: either way we are done
            }
            class = FILE_FULL_DIR_INFO_CLASS;

            let mut off = 0usize;
            loop {
                if off + 68 > buf.len() {
                    break;
                }
                let next = rd_u32(&buf, off) as usize;
                let nlen = rd_u32(&buf, off + 60) as usize;
                let name_start = off + 68;
                if name_start + nlen <= buf.len() && nlen >= 2 && nlen % 2 == 0 {
                    let units: Vec<u16> = buf[name_start..name_start + nlen]
                        .chunks_exact(2)
                        .map(|c| u16::from_le_bytes([c[0], c[1]]))
                        .collect();
                    let is_dot = (units.len() == 1 && units[0] == b'.' as u16)
                        || (units.len() == 2 && units[0] == b'.' as u16 && units[1] == b'.' as u16);
                    if !is_dot {
                        let attrs = rd_u32(&buf, off + 56);
                        let is_dir = attrs & ATTR_DIRECTORY != 0;
                        let mtime = filetime_to_unix(rd_i64(&buf, off + 24));
                        let eof = rd_i64(&buf, off + 40).max(0) as u64;
                        let alloc = rd_i64(&buf, off + 48).max(0) as u64;

                        let idx = batch.flags.len() as u32;
                        let before = batch.names.len();
                        for ch in char::decode_utf16(units.iter().copied()) {
                            let c = ch.unwrap_or('\u{FFFD}');
                            let mut tmp = [0u8; 4];
                            batch.names.extend_from_slice(c.encode_utf8(&mut tmp).as_bytes());
                        }
                        batch.name_len.push((batch.names.len() - before).min(u16::MAX as usize) as u16);
                        batch.mtime.push(mtime);
                        if is_dir {
                            batch.flags.push(F_DIR | F_USED);
                            batch.size.push(0);
                            batch.alloc.push(0);
                            let descend = attrs & ATTR_REPARSE_POINT == 0
                                || attrs & (ATTR_RECALL_ON_OPEN | ATTR_RECALL_ON_DATA_ACCESS) != 0;
                            if descend {
                                let mut child = wide_dir.to_vec();
                                if child.last() != Some(&(b'\\' as u16)) {
                                    child.push(b'\\' as u16);
                                }
                                child.extend_from_slice(&units);
                                subdirs.push((idx, child));
                            }
                        } else {
                            batch.flags.push(F_USED);
                            batch.size.push(eof);
                            batch.alloc.push(alloc);
                        }
                    }
                }
                if next == 0 {
                    break;
                }
                off += next;
            }
        }
    });

    unsafe {
        CloseHandle(handle);
    }
    (batch, subdirs)
}

fn walk<'s>(scope: &rayon::Scope<'s>, ctx: &'s Ctx, wide_dir: Vec<u16>, dir_id: u32) {
    if is_cancelled(&ctx.cancel) {
        return;
    }
    let (mut batch, subdirs) = list_dir(&wide_dir);
    let count = batch.flags.len() as u32;
    if count == 0 {
        return;
    }

    let mut bytes = 0u64;
    let mut files = 0u64;
    for (i, f) in batch.flags.iter().enumerate() {
        if f & F_DIR == 0 {
            files += 1;
            bytes += batch.size[i];
        }
    }
    ctx.files.fetch_add(files, Ordering::Relaxed);
    ctx.bytes.fetch_add(bytes, Ordering::Relaxed);

    let base = ctx.next_id.fetch_add(count, Ordering::Relaxed);
    batch.base_id = base;
    batch.parent = dir_id;
    ctx.batches.lock().unwrap_or_else(|e| e.into_inner()).push(batch);

    for (idx, wide) in subdirs {
        let id = base + idx;
        scope.spawn(move |s| walk(s, ctx, wide, id));
    }
}

pub fn scan(
    path: &str,
    cancel: &Arc<AtomicBool>,
    progress: ProgressFn,
    start: Instant,
) -> Result<RawScan, String> {
    let root_path = path.to_string();
    let ctx = Ctx {
        cancel: Arc::clone(cancel),
        next_id: AtomicU32::new(1),
        batches: Mutex::new(Vec::new()),
        files: AtomicU64::new(0),
        bytes: AtomicU64::new(0),
    };

    let threads = (std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4) * 2).clamp(8, 32);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .build()
        .map_err(|e| e.to_string())?;

    let done = AtomicBool::new(false);
    let root_wide = to_wide_extended(&root_path);
    let used_bytes = if root_path.len() <= 3 && super::is_drive_path(&root_path) {
        drive_used_bytes(&root_path)
    } else {
        0
    };

    std::thread::scope(|s| {
        s.spawn(|| {
            while !done.load(Ordering::Relaxed) {
                let bytes = ctx.bytes.load(Ordering::Relaxed);
                let percent = if used_bytes > 0 {
                    (bytes as f64 / used_bytes as f64 * 100.0).min(99.0) as f32
                } else {
                    0.0
                };
                progress(Progress {
                    phase: "Scanning folders",
                    engine: "Standard",
                    files: ctx.files.load(Ordering::Relaxed),
                    bytes,
                    percent,
                    elapsed_ms: start.elapsed().as_millis() as u64,
                });
                std::thread::sleep(Duration::from_millis(150));
            }
        });
        pool.install(|| {
            rayon::scope(|sc| walk(sc, &ctx, root_wide, 0));
        });
        done.store(true, Ordering::Relaxed);
    });

    if is_cancelled(cancel) {
        return Err(super::cancelled());
    }

    // merge batches into columns
    let total = ctx.next_id.load(Ordering::Relaxed) as usize;
    let batches = ctx.batches.into_inner().unwrap_or_else(|e| e.into_inner());
    let names_total: usize = batches.iter().map(|b| b.names.len()).sum();

    let mut raw = RawScan {
        parent: vec![NONE; total],
        size: vec![0; total],
        alloc: vec![0; total],
        mtime: vec![0; total],
        flags: vec![0; total],
        name_off: vec![0; total],
        name_len: vec![0; total],
        names: Vec::with_capacity(names_total),
        root: 0,
        root_path,
    };
    raw.flags[0] = F_DIR | F_USED;

    for b in batches {
        let base = b.base_id as usize;
        let n = b.flags.len();
        raw.flags[base..base + n].copy_from_slice(&b.flags);
        raw.size[base..base + n].copy_from_slice(&b.size);
        raw.alloc[base..base + n].copy_from_slice(&b.alloc);
        raw.mtime[base..base + n].copy_from_slice(&b.mtime);
        raw.name_len[base..base + n].copy_from_slice(&b.name_len);
        let gbase = raw.names.len() as u32;
        let mut local = 0u32;
        for i in 0..n {
            raw.parent[base + i] = b.parent;
            raw.name_off[base + i] = gbase + local;
            local += b.name_len[i] as u32;
        }
        raw.names.extend_from_slice(&b.names);
    }
    Ok(raw)
}
