//! Live change detection: watches the scanned folder and tells the UI when the disk no longer
//! matches the loaded scan. Events are debounced and filtered against the scan, so the app's own
//! deletes and excluded folders don't raise false alarms.

use crate::models::flat_scan::ScanArena;
use crate::scan::norm_path_lower;
use crate::scan_session::ScanSession;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const FLUSH_EVERY: Duration = Duration::from_millis(2000);
const MAX_DIRS: usize = 15;

/// Handle to the running watcher; dropping it (or `stop`) ends the watch.
pub struct Watch {
    _watcher: RecommendedWatcher,
    stop: Arc<AtomicBool>,
}

impl Drop for Watch {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

#[derive(Default)]
pub struct WatchState(pub Mutex<Option<Watch>>);

#[derive(Serialize, Clone)]
pub struct TreeChanged {
    /// Number of distinct paths that differ from the scan.
    pub count: usize,
    /// Folders to re-read; empty when there are too many (refresh everything instead).
    pub dirs: Vec<String>,
}

fn is_excluded(a: &ScanArena, path: &Path) -> bool {
    let ex = a.excluded();
    if ex.is_empty() {
        return false;
    }
    let lower = norm_path_lower(&path.to_string_lossy());
    if ex
        .abs_paths()
        .iter()
        .any(|p| lower == *p || lower.strip_prefix(p.as_str()).map_or(false, |r| r.starts_with('\\')))
    {
        return true;
    }
    path.components()
        .any(|c| c.as_os_str().to_str().map_or(false, |n| ex.matches_name(n)))
}

/// Does the disk disagree with the scan about `path`?
fn differs(a: &ScanArena, path: &Path) -> bool {
    let s = path.to_string_lossy();
    if s.contains(".space-analyzer") || is_excluded(a, path) {
        return false;
    }
    let known = a.resolve_path(&s).ok();
    let meta = std::fs::symlink_metadata(path).ok();
    match (known, meta) {
        (None, None) => false,
        (Some(_), None) | (None, Some(_)) => true,
        (Some(id), Some(m)) => !m.is_dir() && !a.is_dir(id) && m.len() != a.size(id),
    }
}

/// Folders that have to be re-read: the parent of every changed path, minus folders that are
/// inside another listed folder.
fn collapse_dirs(paths: &[PathBuf]) -> Vec<String> {
    let mut dirs: Vec<String> = paths
        .iter()
        .filter_map(|p| p.parent().map(|d| d.to_string_lossy().to_string()))
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    dirs.sort_by_key(|d| d.len());
    let mut out: Vec<String> = Vec::new();
    for d in dirs {
        let dl = d.to_lowercase();
        if !out.iter().any(|o| {
            let ol = o.to_lowercase();
            dl == ol || dl.strip_prefix(&ol).map_or(false, |r| r.starts_with('\\'))
        }) {
            out.push(d);
        }
    }
    out
}

pub fn start(app: AppHandle, session: ScanSession, root: &str) -> Result<Watch, String> {
    let pending: Arc<Mutex<HashSet<PathBuf>>> = Arc::new(Mutex::new(HashSet::new()));
    let stop = Arc::new(AtomicBool::new(false));

    let sink = Arc::clone(&pending);
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(ev) = res else { return };
        if matches!(ev.kind, EventKind::Access(_)) {
            return;
        }
        let mut set = sink.lock().unwrap_or_else(|e| e.into_inner());
        // bound memory during bulk operations; the UI is told to refresh everything anyway
        if set.len() < 50_000 {
            set.extend(ev.paths);
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(Path::new(root), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    let flag = Arc::clone(&stop);
    std::thread::spawn(move || {
        let mut reported: HashSet<PathBuf> = HashSet::new();
        let mut last_gen = 0u64;
        while !flag.load(Ordering::Relaxed) {
            std::thread::sleep(FLUSH_EVERY);
            // a refresh or rescan replaced the arena: earlier differences are resolved
            let gen = session.with_arena(|a| Ok(a.generation())).unwrap_or(0);
            if gen != last_gen {
                reported.clear();
                last_gen = gen;
            }
            let batch: Vec<PathBuf> = {
                let mut g = pending.lock().unwrap_or_else(|e| e.into_inner());
                g.drain().collect()
            };
            if batch.is_empty() {
                continue;
            }
            let changed: Vec<PathBuf> = session
                .with_arena(|a| Ok(batch.into_iter().filter(|p| differs(a, p)).collect::<Vec<_>>()))
                .unwrap_or_default();
            let fresh: Vec<PathBuf> = changed.into_iter().filter(|p| reported.insert(p.clone())).collect();
            if fresh.is_empty() || flag.load(Ordering::Relaxed) {
                continue;
            }
            let dirs = collapse_dirs(&reported.iter().cloned().collect::<Vec<_>>());
            let payload = TreeChanged {
                count: reported.len(),
                dirs: if dirs.len() > MAX_DIRS { Vec::new() } else { dirs },
            };
            let _ = app.emit("tree-changed", payload);
        }
    });

    Ok(Watch { _watcher: watcher, stop })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collapses_nested_dirs() {
        let paths = vec![
            PathBuf::from(r"C:\a\b\x.txt"),
            PathBuf::from(r"C:\a\b\c\y.txt"),
            PathBuf::from(r"C:\a\z.txt"),
            PathBuf::from(r"C:\q\w.txt"),
        ];
        let mut d = collapse_dirs(&paths);
        d.sort();
        assert_eq!(d, vec![r"C:\a".to_string(), r"C:\q".to_string()]);
    }
}
