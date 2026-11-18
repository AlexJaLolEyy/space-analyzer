//! Per-root scan snapshots (`SAH2`). Shared by the app (changes since last scan), headless
//! `--snapshot` mode and scheduled tasks, so the folder is resolved from `%APPDATA%` directly
//! instead of through the Tauri path API.
//!
//! Layout (gzip): `SAH2`, `u64` unix time, `u8` engine (0 walker, 1 MFT), `u8` origin
//! (0 app, 1 headless), `u64` usn journal id, `i64` next usn, then the arena body.

use crate::models::flat_scan::ScanArena;
use crate::scan::{norm_path_lower, Engine};
use crate::scan_session::ScanSession;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use xxhash_rust::xxh3::xxh3_64;

pub const MAX_SNAPSHOTS: usize = 20;
pub const ORIGIN_APP: u8 = 0;
pub const ORIGIN_HEADLESS: u8 = 1;

#[derive(Clone, Copy, Debug)]
pub struct SnapshotMeta {
    pub timestamp: u64,
    pub engine: u8,
    pub origin: u8,
    pub journal_id: u64,
    pub next_usn: i64,
}

pub fn snapshot_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join("com.alex.space-analyzer").join("snapshots")
}

pub fn snapshot_path(root_path: &str) -> PathBuf {
    let key = norm_path_lower(root_path);
    snapshot_dir().join(format!("{:016x}.snap.gz", xxh3_64(key.as_bytes())))
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Writes the snapshot for the arena's root (replacing the previous one) and prunes old files.
pub fn write_snapshot(arena: &ScanArena, origin: u8) -> Result<PathBuf, String> {
    let dir = snapshot_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = snapshot_path(arena.root_path());
    let tmp = path.with_extension("tmp");
    {
        let file = File::create(&tmp).map_err(|e| e.to_string())?;
        let enc = GzEncoder::new(file, Compression::fast());
        let mut w = BufWriter::with_capacity(1 << 20, enc);
        let (journal_id, next_usn) = arena.mft_meta().map(|m| (m.journal_id, m.next_usn)).unwrap_or((0, 0));
        let io = (|| -> std::io::Result<()> {
            w.write_all(b"SAH2")?;
            w.write_all(&now_secs().to_le_bytes())?;
            w.write_all(&[if arena.engine() == Engine::Mft { 1 } else { 0 }, origin])?;
            w.write_all(&journal_id.to_le_bytes())?;
            w.write_all(&next_usn.to_le_bytes())?;
            arena.write_snapshot_body(&mut w)
        })();
        io.map_err(|e| e.to_string())?;
        let enc = w.into_inner().map_err(|e| e.to_string())?;
        enc.finish().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    prune(&dir);
    Ok(path)
}

fn prune(dir: &Path) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = rd
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(".snap.gz"))
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    if files.len() <= MAX_SNAPSHOTS {
        return;
    }
    files.sort_by_key(|f| f.0);
    let excess = files.len() - MAX_SNAPSHOTS;
    for (_, p) in files.into_iter().take(excess) {
        let _ = fs::remove_file(p);
    }
}

pub fn read_snapshot(path: &Path) -> Result<(SnapshotMeta, ScanArena), String> {
    fn rd<const N: usize, R: Read>(r: &mut R) -> Result<[u8; N], String> {
        let mut b = [0u8; N];
        r.read_exact(&mut b).map_err(|e| e.to_string())?;
        Ok(b)
    }
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut r = BufReader::with_capacity(1 << 20, GzDecoder::new(file));
    if &rd::<4, _>(&mut r)? != b"SAH2" {
        return Err("Unsupported snapshot format".to_string());
    }
    let timestamp = u64::from_le_bytes(rd::<8, _>(&mut r)?);
    let [engine, origin] = rd::<2, _>(&mut r)?;
    let journal_id = u64::from_le_bytes(rd::<8, _>(&mut r)?);
    let next_usn = i64::from_le_bytes(rd::<8, _>(&mut r)?);
    let cancel = AtomicBool::new(false);
    let arena = ScanArena::read_snapshot_body(&mut r, &cancel)?;
    Ok((
        SnapshotMeta {
            timestamp,
            engine,
            origin,
            journal_id,
            next_usn,
        },
        arena,
    ))
}

pub fn load_previous(root_path: &str) -> Option<(SnapshotMeta, ScanArena)> {
    let p = snapshot_path(root_path);
    if !p.exists() {
        return None;
    }
    read_snapshot(&p).ok()
}

fn mark_subtree(a: &ScanArena, id: u32, deltas: &mut [i64]) {
    let mut stack = vec![id];
    while let Some(cur) = stack.pop() {
        deltas[cur as usize] = a.size(cur) as i64;
        if a.is_dir(cur) {
            stack.extend(a.live_children(cur));
        }
    }
}

/// Size change per node of `new` relative to `old`, matching children by lowercase name.
/// Existing nodes get `new - old`; nodes that did not exist get their full size.
pub fn compute_deltas(new: &ScanArena, old: &ScanArena) -> Vec<i64> {
    let mut deltas = vec![0i64; new.len()];
    let (nr, or) = (new.root_id(), old.root_id());
    deltas[nr as usize] = new.size(nr) as i64 - old.size(or) as i64;
    let mut stack = vec![(nr, or)];
    while let Some((nd, od)) = stack.pop() {
        let mut old_map: HashMap<String, u32> = old
            .live_children(od)
            .map(|c| (old.name(c).to_lowercase(), c))
            .collect();
        for nc in new.live_children(nd) {
            match old_map.remove(&new.name(nc).to_lowercase()) {
                Some(oc) => {
                    let d = new.size(nc) as i64 - old.size(oc) as i64;
                    deltas[nc as usize] = d;
                    if d != 0 && new.is_dir(nc) {
                        if old.is_dir(oc) {
                            stack.push((nc, oc));
                        } else {
                            mark_subtree(new, nc, &mut deltas);
                        }
                    }
                }
                None => mark_subtree(new, nc, &mut deltas),
            }
        }
    }
    deltas
}

/// Compares the session's arena with the previous snapshot of its root (storing the deltas),
/// then writes the new snapshot. Runs on a background thread after a scan or refresh.
/// Returns true when deltas were applied.
pub fn update_deltas_and_save(session: &ScanSession, origin: u8, save: bool) -> bool {
    let Ok((generation, root)) = session.with_arena(|a| Ok((a.generation(), a.root_path().to_string()))) else {
        return false;
    };
    let mut applied = false;
    if let Some((meta, old)) = load_previous(&root) {
        let deltas = session
            .with_arena(|a| Ok((a.generation() == generation).then(|| compute_deltas(a, &old))))
            .ok()
            .flatten();
        if let Some(d) = deltas {
            applied = session
                .with_arena_mut(|a| {
                    if a.generation() == generation {
                        a.set_deltas(d, meta.timestamp, meta.origin);
                        Ok(true)
                    } else {
                        Ok(false)
                    }
                })
                .unwrap_or(false);
        }
    }
    if save {
        let _ = session.with_arena(|a| {
            if a.generation() == generation {
                write_snapshot(a, origin)?;
            }
            Ok(())
        });
    }
    applied
}
