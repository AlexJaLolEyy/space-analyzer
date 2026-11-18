//! Raw NTFS `$MFT` reader (requires administrator rights).
//!
//! The volume's `$MFT` is read sequentially in large chunks. File records contain names,
//! parents, sizes and timestamps inline, so no per-file syscalls are needed. A reader thread
//! streams chunks into a bounded channel while rayon workers parse the previous chunk.

use super::{is_cancelled, MftMeta, Progress, ProgressFn, RawScan, F_DIR, F_USED, NONE};
use rayon::prelude::*;
use std::fs::{File, OpenOptions};
use std::os::windows::fs::{FileExt, OpenOptionsExt};
use std::os::windows::io::AsRawHandle;
use std::sync::atomic::AtomicBool;
use std::sync::{mpsc, Arc};
use std::time::Instant;
use windows_sys::Win32::Storage::FileSystem::GetVolumeInformationW;
use windows_sys::Win32::System::IO::DeviceIoControl;

const FSCTL_GET_NTFS_VOLUME_DATA: u32 = 0x0009_0064;
const FILE_FLAG_SEQUENTIAL_SCAN: u32 = 0x0800_0000;
const MASK48: u64 = 0x0000_FFFF_FFFF_FFFF;
const CHUNK: usize = 16 * 1024 * 1024;
const ROOT_RECORD: u32 = 5;

const HAS_NAME: u8 = 4;
const HAS_DATA: u8 = 8;

pub fn volume_is_ntfs(path: &str) -> bool {
    let Some(letter) = path.chars().next() else {
        return false;
    };
    let root: Vec<u16> = format!("{}:\\", letter).encode_utf16().chain(Some(0)).collect();
    let mut fs_name = [0u16; 64];
    let ok = unsafe {
        GetVolumeInformationW(
            root.as_ptr(),
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            fs_name.as_mut_ptr(),
            fs_name.len() as u32,
        )
    };
    if ok == 0 {
        return false;
    }
    let len = fs_name.iter().position(|&c| c == 0).unwrap_or(fs_name.len());
    String::from_utf16_lossy(&fs_name[..len]).eq_ignore_ascii_case("NTFS")
}

fn rd16(b: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([b[o], b[o + 1]])
}
fn rd32(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}
fn rd64(b: &[u8], o: usize) -> u64 {
    let mut a = [0u8; 8];
    a.copy_from_slice(&b[o..o + 8]);
    u64::from_le_bytes(a)
}

struct VolumeData {
    bytes_per_cluster: u64,
    bytes_per_record: usize,
    mft_start_lcn: u64,
}

fn volume_data(file: &File) -> Result<VolumeData, String> {
    let mut buf = [0u8; 128];
    let mut ret = 0u32;
    let ok = unsafe {
        DeviceIoControl(
            file.as_raw_handle() as isize,
            FSCTL_GET_NTFS_VOLUME_DATA,
            std::ptr::null(),
            0,
            buf.as_mut_ptr().cast(),
            buf.len() as u32,
            &mut ret,
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        return Err(format!("FSCTL_GET_NTFS_VOLUME_DATA failed: {}", std::io::Error::last_os_error()));
    }
    let bytes_per_cluster = rd32(&buf, 44) as u64;
    let bytes_per_record = rd32(&buf, 48) as usize;
    let mft_start_lcn = rd64(&buf, 64);
    if !(512..=65536).contains(&bytes_per_record)
        || !bytes_per_record.is_power_of_two()
        || bytes_per_cluster < 512
        || CHUNK % bytes_per_cluster as usize != 0
        || CHUNK % bytes_per_record != 0
    {
        return Err("Unsupported NTFS geometry".to_string());
    }
    Ok(VolumeData {
        bytes_per_cluster,
        bytes_per_record,
        mft_start_lcn,
    })
}

const FSCTL_QUERY_USN_JOURNAL: u32 = 0x0009_00F4;

/// `(journal id, first usn, next usn)` of the volume's change journal, if it has one.
pub(crate) fn query_usn_journal(file: &File) -> Option<(u64, i64, i64)> {
    let mut buf = [0u8; 80];
    let mut ret = 0u32;
    let ok = unsafe {
        DeviceIoControl(
            file.as_raw_handle() as isize,
            FSCTL_QUERY_USN_JOURNAL,
            std::ptr::null(),
            0,
            buf.as_mut_ptr().cast(),
            buf.len() as u32,
            &mut ret,
            std::ptr::null_mut(),
        )
    };
    if ok == 0 || ret < 24 {
        return None;
    }
    Some((rd64(&buf, 0), rd64(&buf, 8) as i64, rd64(&buf, 16) as i64))
}

pub(crate) fn read_exact_at(file: &File, mut off: u64, mut buf: &mut [u8]) -> Result<(), String> {
    while !buf.is_empty() {
        let n = file.seek_read(buf, off).map_err(|e| format!("Volume read failed at {off}: {e}"))?;
        if n == 0 {
            return Err(format!("Unexpected end of volume at {off}"));
        }
        off += n as u64;
        buf = &mut buf[n..];
    }
    Ok(())
}

/// Replace the update-sequence stamps at the end of each 512-byte stripe with the original bytes.
fn apply_fixups(rec: &mut [u8]) -> bool {
    if rec.len() < 0x30 || &rec[0..4] != b"FILE" {
        return false;
    }
    let usa_off = rd16(rec, 4) as usize;
    let usa_cnt = rd16(rec, 6) as usize;
    if usa_cnt < 2 || usa_off + usa_cnt * 2 > rec.len() {
        return false;
    }
    let usn = [rec[usa_off], rec[usa_off + 1]];
    for i in 1..usa_cnt {
        let end = i * 512;
        if end > rec.len() {
            break;
        }
        if rec[end - 2] != usn[0] || rec[end - 1] != usn[1] {
            return false;
        }
        rec[end - 2] = rec[usa_off + i * 2];
        rec[end - 1] = rec[usa_off + i * 2 + 1];
    }
    true
}

fn filetime_to_unix(ft: u64) -> u32 {
    let secs = (ft / 10_000_000) as i64 - 11_644_473_600;
    secs.clamp(0, u32::MAX as i64) as u32
}

pub(crate) struct RecOut {
    rec: u32,
    base: u32,
    is_dir: bool,
    has_name: bool,
    has_data: bool,
    parent: u32,
    name_off: u32,
    name_len: u16,
    size: u64,
    alloc: u64,
    mtime: u32,
}

pub(crate) fn parse_record(rec: &mut [u8], rec_no: u32, outs: &mut Vec<RecOut>, pool: &mut Vec<u8>) {
    if rec.len() < 0x30 || &rec[0..4] != b"FILE" {
        return;
    }
    let rflags = rd16(rec, 0x16);
    if rflags & 1 == 0 {
        return;
    }
    if !apply_fixups(rec) {
        return;
    }
    let base_ref = rd64(rec, 0x20) & MASK48;
    let base = if base_ref == 0 {
        NONE
    } else if base_ref >= u32::MAX as u64 {
        return;
    } else {
        base_ref as u32
    };
    let used = (rd32(rec, 0x18) as usize).min(rec.len());
    let mut off = rd16(rec, 0x14) as usize;

    let mut best_name: Option<(usize, usize, u32, u8)> = None; // (byte start, utf16 units, parent, priority)
    let mut mtime = 0u32;
    let (mut size, mut alloc, mut has_data) = (0u64, 0u64, false);

    while off + 16 <= used {
        let ty = rd32(rec, off);
        if ty == 0xFFFF_FFFF {
            break;
        }
        let len = rd32(rec, off + 4) as usize;
        if len < 16 || off + len > used {
            break;
        }
        let nonres = rec[off + 8];
        let name_len = rec[off + 9];
        match ty {
            0x10 if nonres == 0 => {
                let vo = rd16(rec, off + 0x14) as usize;
                if vo + 16 <= len {
                    mtime = filetime_to_unix(rd64(rec, off + vo + 8));
                }
            }
            0x30 if nonres == 0 => {
                let vo = rd16(rec, off + 0x14) as usize;
                let vl = rd32(rec, off + 0x10) as usize;
                if vl >= 0x42 && vo + vl <= len {
                    let p = off + vo;
                    let nl = rec[p + 0x40] as usize;
                    let ns = rec[p + 0x41];
                    let parent = rd64(rec, p) & MASK48;
                    if 0x42 + nl * 2 <= vl && parent < u32::MAX as u64 {
                        let prio = match ns {
                            1 | 3 => 3,
                            0 => 2,
                            _ => 1,
                        };
                        if best_name.map_or(true, |b| prio > b.3) {
                            best_name = Some((p + 0x42, nl, parent as u32, prio));
                        }
                    }
                }
            }
            0x80 if name_len == 0 => {
                if nonres == 0 {
                    size = rd32(rec, off + 0x10) as u64;
                    alloc = 0;
                    has_data = true;
                } else if len >= 0x40 && rd64(rec, off + 0x10) == 0 {
                    alloc = rd64(rec, off + 0x28);
                    size = rd64(rec, off + 0x30);
                    if rd16(rec, off + 0x22) != 0 && len >= 0x48 {
                        alloc = rd64(rec, off + 0x40);
                    }
                    has_data = true;
                }
            }
            _ => {}
        }
        off += len;
    }

    let mut out = RecOut {
        rec: rec_no,
        base,
        is_dir: rflags & 2 != 0,
        has_name: false,
        has_data,
        parent: NONE,
        name_off: 0,
        name_len: 0,
        size,
        alloc,
        mtime,
    };
    if let Some((start, units, parent, _)) = best_name {
        let before = pool.len();
        let wide = rec[start..start + units * 2]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]));
        for ch in char::decode_utf16(wide) {
            let c = ch.unwrap_or('\u{FFFD}');
            let mut tmp = [0u8; 4];
            pool.extend_from_slice(c.encode_utf8(&mut tmp).as_bytes());
        }
        out.has_name = true;
        out.parent = parent;
        out.name_off = before as u32;
        out.name_len = (pool.len() - before).min(u16::MAX as usize) as u16;
    }
    if base == NONE || out.has_name || out.has_data {
        outs.push(out);
    }
}

struct Extents {
    runs: Vec<(u64, u64)>, // (byte offset on volume, byte length)
    total_bytes: u64,
}

/// Parse record 0 (`$MFT`) and decode the runlist of its unnamed `$DATA` attribute.
fn mft_extents(rec0: &mut [u8], bpc: u64, bpr: usize) -> Result<Extents, String> {
    if !apply_fixups(rec0) {
        return Err("$MFT record 0 invalid".to_string());
    }
    let used = (rd32(rec0, 0x18) as usize).min(rec0.len());
    let mut off = rd16(rec0, 0x14) as usize;
    while off + 16 <= used {
        let ty = rd32(rec0, off);
        if ty == 0xFFFF_FFFF {
            break;
        }
        let len = rd32(rec0, off + 4) as usize;
        if len < 16 || off + len > used {
            break;
        }
        if ty == 0x80 && rec0[off + 9] == 0 && rec0[off + 8] != 0 && len >= 0x40 {
            let rl_off = rd16(rec0, off + 0x20) as usize;
            let init_size = rd64(rec0, off + 0x38);
            let mut p = off + rl_off;
            let end = off + len;
            let mut lcn: i64 = 0;
            let mut runs = Vec::new();
            let mut sum = 0u64;
            while p < end {
                let h = rec0[p];
                if h == 0 {
                    break;
                }
                p += 1;
                let ln = (h & 0xF) as usize;
                let on = (h >> 4) as usize;
                if ln == 0 || ln > 8 || on == 0 || on > 8 || p + ln + on > end {
                    return Err("Unsupported $MFT runlist (sparse or malformed)".to_string());
                }
                let mut l = 0u64;
                for i in 0..ln {
                    l |= (rec0[p + i] as u64) << (8 * i);
                }
                p += ln;
                let mut o = 0i64;
                for i in 0..on {
                    o |= (rec0[p + i] as i64) << (8 * i);
                }
                if on < 8 && rec0[p + on - 1] & 0x80 != 0 {
                    o |= -1i64 << (8 * on);
                }
                p += on;
                lcn += o;
                if lcn < 0 {
                    return Err("Negative LCN in $MFT runlist".to_string());
                }
                runs.push((lcn as u64 * bpc, l * bpc));
                sum += l * bpc;
            }
            let total = init_size.min(sum) / bpr as u64 * bpr as u64;
            if runs.is_empty() || total == 0 {
                return Err("Empty $MFT runlist".to_string());
            }
            return Ok(Extents { runs, total_bytes: total });
        }
        off += len;
    }
    Err("$MFT $DATA attribute not found in record 0 (attribute list not supported)".to_string())
}

struct Cols {
    parent: Vec<u32>,
    size: Vec<u64>,
    alloc: Vec<u64>,
    mtime: Vec<u32>,
    flags: Vec<u8>,
    name_off: Vec<u32>,
    name_len: Vec<u16>,
    names: Vec<u8>,
    files: u64,
    bytes: u64,
}

impl Cols {
    fn set_name(&mut self, idx: usize, r: &RecOut, pool: &[u8]) {
        let o = self.names.len() as u32;
        self.names
            .extend_from_slice(&pool[r.name_off as usize..r.name_off as usize + r.name_len as usize]);
        self.name_off[idx] = o;
        self.name_len[idx] = r.name_len;
        self.parent[idx] = r.parent;
        self.flags[idx] |= HAS_NAME;
    }

    fn merge(&mut self, outs: &[RecOut], pool: &[u8]) {
        let n = self.parent.len();
        for r in outs {
            if r.base == NONE {
                let i = r.rec as usize;
                if i >= n {
                    continue;
                }
                self.flags[i] |= F_USED;
                if r.is_dir {
                    self.flags[i] |= F_DIR;
                }
                if r.has_name {
                    self.set_name(i, r, pool);
                }
                if r.has_data {
                    self.size[i] = r.size;
                    self.alloc[i] = r.alloc;
                    self.flags[i] |= HAS_DATA;
                }
                self.mtime[i] = r.mtime;
            } else {
                let i = r.base as usize;
                if i >= n {
                    continue;
                }
                if r.has_name && self.flags[i] & HAS_NAME == 0 {
                    self.set_name(i, r, pool);
                }
                if r.has_data && self.flags[i] & HAS_DATA == 0 {
                    self.size[i] = r.size;
                    self.alloc[i] = r.alloc;
                    self.flags[i] |= HAS_DATA;
                }
            }
        }
    }
}

fn name_matches(a: &str, b: &str) -> bool {
    if a.is_ascii() && b.is_ascii() {
        a.eq_ignore_ascii_case(b)
    } else {
        a.to_lowercase() == b.to_lowercase()
    }
}

pub fn scan(
    path: &str,
    cancel: &Arc<AtomicBool>,
    progress: ProgressFn,
    start: Instant,
) -> Result<RawScan, String> {
    if path.len() < 2 {
        return Err("Invalid path".to_string());
    }
    let drive = &path[..2];
    let vol_path = format!(r"\\.\{}", drive);
    let file = OpenOptions::new()
        .read(true)
        .share_mode(7)
        .custom_flags(FILE_FLAG_SEQUENTIAL_SCAN)
        .open(&vol_path)
        .map_err(|e| format!("Cannot open volume {vol_path}: {e}"))?;
    let vd = volume_data(&file)?;
    let bpr = vd.bytes_per_record;
    let bpc = vd.bytes_per_cluster;
    // query the journal first: changes made while we read are simply replayed on refresh
    let journal = query_usn_journal(&file);

    let mut rec0 = vec![0u8; bpr];
    read_exact_at(&file, vd.mft_start_lcn * bpc, &mut rec0)?;
    let ext = mft_extents(&mut rec0, bpc, bpr)?;
    let total_records = (ext.total_bytes / bpr as u64) as usize;
    if total_records > u32::MAX as usize - 1 {
        return Err("MFT too large".to_string());
    }
    for (_, len) in &ext.runs {
        if len % bpr as u64 != 0 {
            return Err("MFT extent not aligned to record size".to_string());
        }
    }

    let mut cols = Cols {
        parent: vec![NONE; total_records],
        size: vec![0; total_records],
        alloc: vec![0; total_records],
        mtime: vec![0; total_records],
        flags: vec![0; total_records],
        name_off: vec![0; total_records],
        name_len: vec![0; total_records],
        names: Vec::with_capacity(total_records * 16),
        files: 0,
        bytes: 0,
    };

    let (data_tx, data_rx) = mpsc::sync_channel::<(u32, usize, Vec<u8>)>(3);
    let (free_tx, free_rx) = mpsc::channel::<Vec<u8>>();
    for _ in 0..4 {
        let _ = free_tx.send(vec![0u8; CHUNK]);
    }

    let result: Result<(), String> = std::thread::scope(|s| {
        let file_ref = &file;
        let runs = &ext.runs;
        let total_bytes = ext.total_bytes;
        let reader = s.spawn(move || -> Result<(), String> {
            let mut remaining_total = total_bytes;
            let mut rec_no: u64 = 0;
            for &(offset, len) in runs {
                let mut run_off = 0u64;
                while run_off < len && remaining_total > 0 {
                    if is_cancelled(cancel) {
                        return Ok(());
                    }
                    let take = (CHUNK as u64).min(len - run_off).min(remaining_total) as usize;
                    let Ok(mut buf) = free_rx.recv() else {
                        return Ok(());
                    };
                    read_exact_at(file_ref, offset + run_off, &mut buf[..take])?;
                    if data_tx.send((rec_no as u32, take, buf)).is_err() {
                        return Ok(());
                    }
                    rec_no += (take / bpr) as u64;
                    run_off += take as u64;
                    remaining_total -= take as u64;
                }
            }
            Ok(())
        });

        let cols_ref = &mut cols;
        let consume = move || -> Result<(), String> {
            let mut last_emit = Instant::now();
            let mut done_records: u64 = 0;
            for (first_rec, take, mut buf) in data_rx {
                let parts: Vec<(Vec<RecOut>, Vec<u8>)> = buf[..take]
                    .par_chunks_mut(bpr)
                    .enumerate()
                    .fold(
                        || (Vec::new(), Vec::new()),
                        |mut acc, (i, rec)| {
                            parse_record(rec, first_rec + i as u32, &mut acc.0, &mut acc.1);
                            acc
                        },
                    )
                    .collect();
                for (outs, pool) in &parts {
                    for r in outs {
                        if r.base == NONE && r.has_name && !r.is_dir {
                            cols_ref.files += 1;
                            cols_ref.bytes += r.size;
                        }
                    }
                    cols_ref.merge(outs, pool);
                }
                done_records += (take / bpr) as u64;
                let _ = free_tx.send(buf);
                if last_emit.elapsed().as_millis() >= 150 {
                    last_emit = Instant::now();
                    progress(Progress {
                        phase: "Reading file table",
                        engine: "Turbo",
                        files: cols_ref.files,
                        bytes: cols_ref.bytes,
                        percent: (done_records as f32 / total_records.max(1) as f32 * 100.0).min(100.0),
                        elapsed_ms: start.elapsed().as_millis() as u64,
                    });
                }
                if is_cancelled(cancel) {
                    break;
                }
            }
            Ok(())
        };
        let cres = consume();
        let rres = reader.join().map_err(|_| "MFT reader thread panicked".to_string())?;
        cres.and(rres)
    });
    result?;

    if is_cancelled(cancel) {
        return Err(super::cancelled());
    }

    // finalize flags: keep only entries that have a name
    let n = total_records;
    for i in 0..n {
        let f = cols.flags[i];
        cols.flags[i] = if f & F_USED != 0 && f & HAS_NAME != 0 { f & (F_DIR | F_USED) } else { 0 };
    }
    if (ROOT_RECORD as usize) >= n || cols.flags[ROOT_RECORD as usize] & F_USED == 0 {
        return Err("Root directory record not found".to_string());
    }

    // resolve the scan root (drive root or a subfolder)
    let rest = path[2..].trim_matches('\\');
    let mut root = ROOT_RECORD;
    let mut root_path = format!("{}\\", drive);
    if !rest.is_empty() {
        for comp in rest.split('\\').filter(|c| !c.is_empty()) {
            let mut found = None;
            for id in 0..n {
                if cols.flags[id] & F_DIR != 0 && cols.parent[id] == root && id as u32 != root {
                    let o = cols.name_off[id] as usize;
                    let l = cols.name_len[id] as usize;
                    if let Ok(nm) = std::str::from_utf8(&cols.names[o..o + l]) {
                        if name_matches(nm, comp) {
                            found = Some(id as u32);
                            break;
                        }
                    }
                }
            }
            root = found.ok_or_else(|| format!("Folder not found in MFT: {}", comp))?;
        }
        root_path = format!("{}\\{}", drive, rest);
    }

    Ok(RawScan {
        parent: cols.parent,
        size: cols.size,
        alloc: cols.alloc,
        mtime: cols.mtime,
        flags: cols.flags,
        name_off: cols.name_off,
        name_len: cols.name_len,
        names: cols.names,
        root,
        root_path,
        mft_meta: journal.map(|(journal_id, _, next_usn)| MftMeta {
            volume: drive.to_string(),
            bytes_per_record: bpr as u32,
            extents: ext.runs.clone(),
            total_records: total_records as u64,
            journal_id,
            next_usn,
        }),
    })
}

// ---------- incremental refresh through the USN change journal ----------

const FSCTL_READ_USN_JOURNAL: u32 = 0x0009_00BB;

/// Adds the file record numbers mentioned by the USN records in `buf` (the part after the
/// leading 8-byte "next USN" of a `FSCTL_READ_USN_JOURNAL` reply) to `out`.
fn parse_usn_records(buf: &[u8], out: &mut std::collections::HashSet<u32>) {
    let mut off = 0usize;
    while off + 24 <= buf.len() {
        let len = rd32(buf, off) as usize;
        if len < 24 || off + len > buf.len() {
            break;
        }
        let major = rd16(buf, off + 4);
        // V2 and V3 both start the file reference at offset 8; NTFS keeps the record number in
        // its low 48 bits.
        if major == 2 || major == 3 {
            let rn = rd64(buf, off + 8) & MASK48;
            if rn < u32::MAX as u64 {
                out.insert(rn as u32);
            }
        }
        off += len;
    }
}

/// Reads the journal from `start` up to `end` and returns the changed record numbers and the
/// USN to continue from next time.
fn read_journal(file: &File, journal_id: u64, start: i64, end: i64) -> Result<(Vec<u32>, i64), String> {
    let mut changed = std::collections::HashSet::new();
    let mut usn = start;
    let mut buf = vec![0u8; 1 << 20];
    while usn < end {
        let mut input = [0u8; 40];
        input[0..8].copy_from_slice(&usn.to_le_bytes());
        input[8..12].copy_from_slice(&0xFFFF_FFFFu32.to_le_bytes()); // every reason
        input[12..16].copy_from_slice(&1u32.to_le_bytes()); // only on close: the MFT record is final
        input[32..40].copy_from_slice(&journal_id.to_le_bytes());
        let mut ret = 0u32;
        let ok = unsafe {
            DeviceIoControl(
                file.as_raw_handle() as isize,
                FSCTL_READ_USN_JOURNAL,
                input.as_ptr().cast(),
                input.len() as u32,
                buf.as_mut_ptr().cast(),
                buf.len() as u32,
                &mut ret,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err("Could not read the change journal".to_string());
        }
        if (ret as usize) < 8 {
            break;
        }
        let next = rd64(&buf, 0) as i64;
        parse_usn_records(&buf[8..ret as usize], &mut changed);
        if next <= usn {
            break;
        }
        usn = next;
    }
    let mut v: Vec<u32> = changed.into_iter().collect();
    v.sort_unstable();
    Ok((v, usn.max(start)))
}

/// Volume byte offset of MFT record `rn`, or `None` when it lies beyond the known extents.
fn record_offset(extents: &[(u64, u64)], rn: u64, bpr: u64) -> Option<u64> {
    let mut pos = rn.checked_mul(bpr)?;
    for &(off, len) in extents {
        if pos + bpr <= len {
            return Some(off + pos);
        }
        if pos < len {
            return None; // record straddles two extents; not expected, let the caller rescan
        }
        pos -= len;
    }
    None
}

struct Parsed {
    rn: u32,
    outs: Vec<RecOut>,
    pool: Vec<u8>,
}

/// Brings a drive-root MFT scan up to date by replaying the USN journal and re-reading just
/// the changed records. Returns the number of records refreshed. `raw` is only modified once
/// every read succeeded, so on `Err` the caller can keep it as is and fall back to a rescan
/// (journal wrapped or recreated, MFT grew, volume unreadable).
pub fn quick_refresh(raw: &mut RawScan) -> Result<usize, String> {
    let meta = raw.mft_meta.clone().ok_or("No change journal information for this scan")?;
    let vol_path = format!(r"\\.\{}", meta.volume);
    let file = OpenOptions::new()
        .read(true)
        .share_mode(7)
        .open(&vol_path)
        .map_err(|e| format!("Cannot open volume {vol_path}: {e}"))?;
    let (journal_id, first, next) = query_usn_journal(&file).ok_or("The change journal is no longer available")?;
    if journal_id != meta.journal_id || meta.next_usn < first {
        return Err("The change journal was reset since the scan".to_string());
    }
    let (changed, new_usn) = read_journal(&file, journal_id, meta.next_usn, next)?;

    let bpr = meta.bytes_per_record as usize;
    let mut parsed: Vec<Parsed> = Vec::with_capacity(changed.len());
    let mut rec = vec![0u8; bpr];
    for &rn in &changed {
        if rn as usize >= raw.parent.len() {
            return Err("The file table grew since the scan".to_string());
        }
        let off = record_offset(&meta.extents, rn as u64, bpr as u64).ok_or("The file table layout changed")?;
        read_exact_at(&file, off, &mut rec)?;
        let mut p = Parsed { rn, outs: Vec::new(), pool: Vec::new() };
        parse_record(&mut rec, rn, &mut p.outs, &mut p.pool);
        parsed.push(p);
    }

    // all reads succeeded: patch the columns
    for p in &parsed {
        let i = p.rn as usize;
        let own = p.outs.iter().find(|r| r.base == NONE);
        match own {
            None if p.outs.is_empty() => raw.flags[i] = 0, // record freed
            Some(r) => {
                raw.flags[i] = F_USED | if r.is_dir { F_DIR } else { 0 };
                raw.mtime[i] = r.mtime;
                if r.has_name {
                    set_name(raw, i, r, &p.pool);
                } else if raw.name_len[i] == 0 {
                    raw.flags[i] = 0;
                }
                if r.has_data {
                    raw.size[i] = r.size;
                    raw.alloc[i] = r.alloc;
                } else if r.is_dir {
                    raw.size[i] = 0;
                    raw.alloc[i] = 0;
                }
                // files whose data lives in an extension record keep their previous size
            }
            None => {}
        }
        // extension records carry attributes for their base record
        for r in p.outs.iter().filter(|r| r.base != NONE) {
            let b = r.base as usize;
            if b >= raw.parent.len() || raw.flags[b] & F_USED == 0 {
                continue;
            }
            if r.has_data && raw.flags[b] & F_DIR == 0 {
                raw.size[b] = r.size;
                raw.alloc[b] = r.alloc;
            }
            if r.has_name && raw.name_len[b] == 0 {
                set_name(raw, b, r, &p.pool);
            }
        }
    }
    if let Some(m) = raw.mft_meta.as_mut() {
        m.next_usn = new_usn;
    }
    Ok(parsed.len())
}

fn set_name(raw: &mut RawScan, i: usize, r: &RecOut, pool: &[u8]) {
    raw.name_off[i] = raw.names.len() as u32;
    raw.name_len[i] = r.name_len;
    raw.names
        .extend_from_slice(&pool[r.name_off as usize..r.name_off as usize + r.name_len as usize]);
    raw.parent[i] = r.parent;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn usn_record(version: u16, frn: u64) -> Vec<u8> {
        let mut r = vec![0u8; 64];
        r[0..4].copy_from_slice(&64u32.to_le_bytes());
        r[4..6].copy_from_slice(&version.to_le_bytes());
        r[8..16].copy_from_slice(&frn.to_le_bytes());
        r
    }

    #[test]
    fn parses_usn_records() {
        let mut buf = usn_record(2, 0x0003_0000_0000_1234);
        buf.extend(usn_record(3, 77));
        buf.extend(usn_record(4, 99)); // range-tracking record: ignored
        let mut set = std::collections::HashSet::new();
        parse_usn_records(&buf, &mut set);
        let mut v: Vec<u32> = set.into_iter().collect();
        v.sort();
        assert_eq!(v, vec![77, 0x1234]);
    }

    #[test]
    fn finds_record_offsets() {
        let ext = [(1000u64, 4096u64), (100_000, 2048)];
        assert_eq!(record_offset(&ext, 0, 1024), Some(1000));
        assert_eq!(record_offset(&ext, 3, 1024), Some(1000 + 3072));
        assert_eq!(record_offset(&ext, 4, 1024), Some(100_000));
        assert_eq!(record_offset(&ext, 5, 1024), Some(101_024));
        assert_eq!(record_offset(&ext, 6, 1024), None);
    }
}