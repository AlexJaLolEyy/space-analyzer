//! Scan engines. Both engines produce a [`RawScan`] (columnar, no per-entry allocations)
//! which is turned into a [`ScanArena`] by `ScanArena::build`.

pub mod ntfs;
pub mod walker;

use crate::models::flat_scan::ScanArena;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

pub const NONE: u32 = u32::MAX;
pub const F_DIR: u8 = 1;
pub const F_USED: u8 = 2;

/// Columnar scan output; the index in every column is the entry id.
pub struct RawScan {
    pub parent: Vec<u32>,
    pub size: Vec<u64>,
    pub alloc: Vec<u64>,
    pub mtime: Vec<u32>,
    pub flags: Vec<u8>,
    pub name_off: Vec<u32>,
    pub name_len: Vec<u16>,
    pub names: Vec<u8>,
    pub root: u32,
    pub root_path: String,
    pub mft_meta: Option<MftMeta>,
}

/// Raw-MFT state needed to refresh a drive-root scan through the USN journal.
#[derive(Clone, Debug)]
pub struct MftMeta {
    pub volume: String,
    pub bytes_per_record: u32,
    /// `(volume byte offset, length in bytes)` runs of the $MFT data stream.
    pub extents: Vec<(u64, u64)>,
    pub total_records: u64,
    pub journal_id: u64,
    pub next_usn: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Engine {
    Mft,
    Walker,
}

impl Engine {
    pub fn label(self) -> &'static str {
        match self {
            Engine::Mft => "Turbo",
            Engine::Walker => "Standard",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Progress {
    pub phase: &'static str,
    pub engine: &'static str,
    pub files: u64,
    pub bytes: u64,
    pub percent: f32,
    pub elapsed_ms: u64,
}

pub type ProgressFn<'a> = &'a (dyn Fn(Progress) + Send + Sync);

pub fn cancelled() -> String {
    "Scan cancelled".to_string()
}

pub fn is_cancelled(flag: &AtomicBool) -> bool {
    flag.load(Ordering::Relaxed)
}

/// Strip the `\\?\` prefix and normalize slashes.
pub fn clean_path(p: &str) -> String {
    let p = p.strip_prefix(r"\\?\UNC\").map(|r| format!(r"\\{}", r)).unwrap_or_else(|| {
        p.strip_prefix(r"\\?\").unwrap_or(p).to_string()
    });
    p.replace('/', "\\")
}

/// Lowercase, backslash-normalized path without `\\?\` prefix or trailing separator.
pub fn norm_path_lower(p: &str) -> String {
    let mut s = clean_path(p.trim());
    while s.ends_with('\\') && s.len() > 3 {
        s.pop();
    }
    if s.ends_with('\\') && s.len() == 3 {
        s.pop();
    }
    s.to_lowercase()
}

fn eq_lower(a_lower: &str, name: &str) -> bool {
    if name.is_ascii() {
        a_lower.eq_ignore_ascii_case(name)
    } else {
        a_lower == name.to_lowercase()
    }
}

/// User exclusions: entries containing `\` or `:` are absolute paths (the entry and everything
/// below it); anything else is a file or folder name matched anywhere. Case-insensitive.
#[derive(Default, Clone, Debug)]
pub struct Excluded {
    names: Vec<String>,
    abs: Vec<String>,
    abs_split: Vec<(String, String)>,
}

impl Excluded {
    pub fn new(list: &[String]) -> Self {
        let mut ex = Excluded::default();
        for e in list {
            let e = e.trim();
            if e.is_empty() {
                continue;
            }
            if e.contains('\\') || e.contains(':') || e.contains('/') {
                let n = norm_path_lower(e);
                if let Some((parent, name)) = n.rsplit_once('\\') {
                    ex.abs_split.push((parent.to_string(), name.to_string()));
                }
                ex.abs.push(n);
            } else {
                ex.names.push(e.to_lowercase());
            }
        }
        ex
    }

    pub fn is_empty(&self) -> bool {
        self.names.is_empty() && self.abs.is_empty()
    }

    pub fn matches_name(&self, name: &str) -> bool {
        self.names.iter().any(|n| eq_lower(n, name))
    }

    pub fn abs_paths(&self) -> &[String] {
        &self.abs
    }

    /// Excluded absolute entries that live directly in `dir_lower` (see [`norm_path_lower`]).
    pub fn names_in_dir<'a>(&'a self, dir_lower: &str) -> Vec<&'a str> {
        self.abs_split
            .iter()
            .filter(|(p, _)| p == dir_lower)
            .map(|(_, n)| n.as_str())
            .collect()
    }

    pub fn name_eq(a_lower: &str, name: &str) -> bool {
        eq_lower(a_lower, name)
    }
}

pub fn is_drive_path(p: &str) -> bool {
    let b = p.as_bytes();
    b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':'
}

pub struct ScanOutcome {
    pub arena: ScanArena,
    pub engine: Engine,
    pub elapsed_ms: u64,
}

/// Choose an engine (or use `force`) and run it; build the arena afterwards.
pub fn scan_path(
    path: &str,
    force: Option<Engine>,
    cancel: &Arc<AtomicBool>,
    progress: ProgressFn,
    excluded: &[String],
) -> Result<ScanOutcome, String> {
    let ex = Excluded::new(excluded);
    let start = Instant::now();
    let path = clean_path(path);

    let engine = match force {
        Some(e) => e,
        None => {
            if crate::utils::is_admin() && is_drive_path(&path) && ntfs::volume_is_ntfs(&path) {
                Engine::Mft
            } else {
                Engine::Walker
            }
        }
    };

    // remember the last counters so the "Building index" message doesn't reset them
    let last_files = AtomicU64::new(0);
    let last_bytes = AtomicU64::new(0);
    let tracked = |p: Progress| {
        last_files.store(p.files, Ordering::Relaxed);
        last_bytes.store(p.bytes, Ordering::Relaxed);
        progress(p);
    };

    let (raw, used) = match engine {
        Engine::Mft => match ntfs::scan(&path, cancel, &tracked, start) {
            Ok(r) => (r, Engine::Mft),
            Err(e) if is_cancelled(cancel) => return Err(e),
            Err(e) => {
                eprintln!("MFT scan failed ({e}); falling back to walker");
                (walker::scan(&path, cancel, &tracked, start, &ex)?, Engine::Walker)
            }
        },
        Engine::Walker => (walker::scan(&path, cancel, &tracked, start, &ex)?, Engine::Walker),
    };

    if is_cancelled(cancel) {
        return Err(cancelled());
    }

    progress(Progress {
        phase: "Building index",
        engine: used.label(),
        files: last_files.load(Ordering::Relaxed),
        bytes: last_bytes.load(Ordering::Relaxed),
        percent: 100.0,
        elapsed_ms: start.elapsed().as_millis() as u64,
    });
    let mut arena = ScanArena::build(raw, cancel, &ex)?;
    arena.set_engine(used);
    Ok(ScanOutcome {
        arena,
        engine: used,
        elapsed_ms: start.elapsed().as_millis() as u64,
    })
}
