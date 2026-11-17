use crate::errors::AppError;
use crate::models::duplicate::{DuplicateFile, DuplicateGroup};
use crate::scan_session::ScanSession;
use rayon::prelude::*;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::Duration;
use tauri::{command, AppHandle, Emitter, State};
use xxhash_rust::xxh3::Xxh3;

const DEFAULT_MIN_SIZE: u64 = 1024 * 1024;

#[derive(Clone, Serialize)]
pub struct DuplicateProgress {
    pub phase: String,
    pub processed: u64,
    pub total: u64,
}

pub struct DuplicateScanState {
    pub cancel_flag: Arc<AtomicBool>,
}

#[derive(Clone)]
struct FileEntry {
    name: String,
    path: String,
    size: u64,
}

fn partial_hash(path: &str) -> Result<u128, String> {
    const CHUNK: u64 = 4096;
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    let mut h = Xxh3::new();
    if len <= CHUNK * 2 {
        let mut buf = Vec::new();
        file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        h.update(&buf);
    } else {
        let mut buf = vec![0u8; CHUNK as usize];
        file.read_exact(&mut buf).map_err(|e| e.to_string())?;
        h.update(&buf);
        file.seek(SeekFrom::Start(len - CHUNK)).map_err(|e| e.to_string())?;
        file.read_exact(&mut buf).map_err(|e| e.to_string())?;
        h.update(&buf);
        // middle sample as well
        file.seek(SeekFrom::Start(len / 2 - CHUNK / 2)).map_err(|e| e.to_string())?;
        file.read_exact(&mut buf).map_err(|e| e.to_string())?;
        h.update(&buf);
    }
    h.update(&len.to_le_bytes());
    Ok(h.digest128())
}

fn full_hash(path: &str, cancel: &AtomicBool) -> Result<u128, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut h = Xxh3::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".to_string());
        }
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.digest128())
}

fn spawn_monitor(
    app: AppHandle,
    phase: &'static str,
    processed: Arc<AtomicU64>,
    total: u64,
) -> (Arc<AtomicBool>, thread::JoinHandle<()>) {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_m = Arc::clone(&stop);
    let handle = thread::spawn(move || {
        while !stop_m.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(200));
            let _ = app.emit(
                "duplicate-progress",
                DuplicateProgress {
                    phase: phase.to_string(),
                    processed: processed.load(Ordering::Relaxed),
                    total,
                },
            );
        }
    });
    (stop, handle)
}

/// Bucket candidate files straight from the arena (paths are only built for bucket members).
fn collect_buckets(session: &ScanSession, quick_scan: bool, min_size: u64) -> Result<Vec<Vec<FileEntry>>, AppError> {
    session.with_arena(|a| {
        let ids: Vec<u32> = (0..a.len() as u32)
            .into_par_iter()
            .filter(|&id| a.is_used(id) && !a.is_dir(id) && a.size(id) >= min_size && !a.is_protected(id))
            .collect();

        let mut groups: HashMap<(u64, Option<String>), Vec<u32>> = HashMap::new();
        for id in ids {
            let key = (a.size(id), if quick_scan { Some(a.name(id).to_lowercase()) } else { None });
            groups.entry(key).or_default().push(id);
        }
        Ok(groups
            .into_values()
            .filter(|v| v.len() >= 2)
            .map(|v| {
                v.into_iter()
                    .map(|id| FileEntry {
                        name: a.name(id).to_string(),
                        path: a.full_path(id),
                        size: a.size(id),
                    })
                    .collect()
            })
            .collect())
    })
}

fn hash_buckets(
    app: AppHandle,
    buckets: Vec<Vec<FileEntry>>,
    cancel: Arc<AtomicBool>,
) -> Result<Vec<DuplicateGroup>, AppError> {
    if cancel.load(Ordering::Relaxed) {
        return Err(AppError::Cancelled);
    }

    // 2. partial hashes per size bucket
    let total_partial: u64 = buckets.iter().map(|b| b.len() as u64).sum();
    let processed = Arc::new(AtomicU64::new(0));
    let (stop, mon) = spawn_monitor(app.clone(), "partial_hash", Arc::clone(&processed), total_partial);

    let mut full_jobs: Vec<Vec<&FileEntry>> = Vec::new();
    for bucket in &buckets {
        if cancel.load(Ordering::Relaxed) {
            stop.store(true, Ordering::Relaxed);
            let _ = mon.join();
            return Err(AppError::Cancelled);
        }
        let rows: Vec<(u128, &FileEntry)> = bucket
            .par_iter()
            .filter_map(|f| {
                let r = partial_hash(&f.path).ok().map(|h| (h, f));
                processed.fetch_add(1, Ordering::Relaxed);
                r
            })
            .collect();
        let mut pm: HashMap<u128, Vec<&FileEntry>> = HashMap::new();
        for (h, f) in rows {
            pm.entry(h).or_default().push(f);
        }
        full_jobs.extend(pm.into_values().filter(|c| c.len() >= 2));
    }
    stop.store(true, Ordering::Relaxed);
    let _ = mon.join();

    // 3. full hashes of the remaining candidates
    let total_full: u64 = full_jobs.iter().map(|c| c.len() as u64).sum();
    let processed_full = Arc::new(AtomicU64::new(0));
    let (stop2, mon2) = spawn_monitor(app, "full_hash", Arc::clone(&processed_full), total_full);

    let mut groups_out: Vec<DuplicateGroup> = Vec::new();
    for candidates in full_jobs {
        if cancel.load(Ordering::Relaxed) {
            stop2.store(true, Ordering::Relaxed);
            let _ = mon2.join();
            return Err(AppError::Cancelled);
        }
        let size = candidates[0].size;
        let rows: Vec<(u128, &FileEntry)> = candidates
            .par_iter()
            .filter_map(|f| {
                let r = full_hash(&f.path, &cancel).ok().map(|h| (h, *f));
                processed_full.fetch_add(1, Ordering::Relaxed);
                r
            })
            .collect();
        let mut fm: HashMap<u128, Vec<&FileEntry>> = HashMap::new();
        for (h, f) in rows {
            fm.entry(h).or_default().push(f);
        }
        for (h, list) in fm {
            if list.len() > 1 {
                groups_out.push(DuplicateGroup {
                    content_hash: format!("{:032x}", h),
                    size,
                    total_wasted: size * (list.len() as u64 - 1),
                    files: list
                        .into_iter()
                        .map(|f| DuplicateFile {
                            name: f.name.clone(),
                            path: f.path.clone(),
                        })
                        .collect(),
                });
            }
        }
    }
    stop2.store(true, Ordering::Relaxed);
    let _ = mon2.join();

    if cancel.load(Ordering::Relaxed) {
        return Err(AppError::Cancelled);
    }
    groups_out.sort_by(|a, b| b.total_wasted.cmp(&a.total_wasted));
    Ok(groups_out)
}

#[command]
pub async fn find_duplicates(
    app: AppHandle,
    dup_state: State<'_, Mutex<DuplicateScanState>>,
    session: State<'_, ScanSession>,
    quick_scan: bool,
    min_size: Option<u64>,
) -> Result<Vec<DuplicateGroup>, AppError> {
    let cancel_flag = {
        let mut lock = dup_state.lock().unwrap_or_else(|e| e.into_inner());
        lock.cancel_flag = Arc::new(AtomicBool::new(false));
        Arc::clone(&lock.cancel_flag)
    };
    let min = min_size.unwrap_or(DEFAULT_MIN_SIZE);

    let buckets = collect_buckets(&session, quick_scan, min)?;
    tauri::async_runtime::spawn_blocking(move || hash_buckets(app, buckets, cancel_flag))
        .await
        .map_err(|e| AppError::Internal {
            message: e.to_string(),
        })?
}

#[command]
pub fn cancel_duplicate_scan(dup_state: State<'_, Mutex<DuplicateScanState>>) {
    let lock = dup_state.lock().unwrap_or_else(|e| e.into_inner());
    lock.cancel_flag.store(true, Ordering::Relaxed);
}
