//! Scan engines. Both engines produce a [`RawScan`] (columnar, no per-entry allocations)
//! which is turned into a [`ScanArena`] by `ScanArena::build`.

pub mod ntfs;
pub mod walker;

use crate::models::flat_scan::ScanArena;
use std::sync::atomic::{AtomicBool, Ordering};
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

pub fn is_drive_path(p: &str) -> bool {
    let b = p.as_bytes();
    b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':'
}

pub struct ScanOutcome {
    pub arena: ScanArena,
    pub engine: Engine,
}

/// Choose an engine (or use `force`) and run it; build the arena afterwards.
pub fn scan_path(
    path: &str,
    force: Option<Engine>,
    cancel: &Arc<AtomicBool>,
    progress: ProgressFn,
) -> Result<ScanOutcome, String> {
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

    let (raw, used) = match engine {
        Engine::Mft => match ntfs::scan(&path, cancel, progress, start) {
            Ok(r) => (r, Engine::Mft),
            Err(e) if is_cancelled(cancel) => return Err(e),
            Err(e) => {
                eprintln!("MFT scan failed ({e}); falling back to walker");
                (walker::scan(&path, cancel, progress, start)?, Engine::Walker)
            }
        },
        Engine::Walker => (walker::scan(&path, cancel, progress, start)?, Engine::Walker),
    };

    if is_cancelled(cancel) {
        return Err(cancelled());
    }

    progress(Progress {
        phase: "Building index",
        files: 0,
        bytes: 0,
        percent: 100.0,
        elapsed_ms: start.elapsed().as_millis() as u64,
    });
    let arena = ScanArena::build(raw, cancel)?;
    Ok(ScanOutcome { arena, engine: used })
}
