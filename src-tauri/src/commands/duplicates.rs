use crate::models::{
    duplicate::{DuplicateFile, DuplicateGroup},
    scan::ScanNode,
};
use rayon::prelude::*;
use serde::Serialize;
use sha2::{Digest, Sha256};
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

fn collect_files(node: &ScanNode, out: &mut Vec<FileEntry>) {
    if !node.is_dir && node.size > 0 {
        out.push(FileEntry {
            name: node.name.clone(),
            path: node.path.clone(),
            size: node.size,
        });
    }
    for child in &node.children {
        collect_files(child, out);
    }
}

fn compute_partial_hash(path: &str) -> Result<String, String> {
    const CHUNK: u64 = 4096;
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    let mut hasher = Sha256::new();
    if len <= CHUNK * 2 {
        let mut buf = Vec::new();
        file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        hasher.update(&buf);
    } else {
        let mut buf = vec![0u8; CHUNK as usize];
        file.read_exact(&mut buf).map_err(|e| e.to_string())?;
        hasher.update(&buf);
        let seek_pos = len.saturating_sub(CHUNK);
        file.seek(SeekFrom::Start(seek_pos)).map_err(|e| e.to_string())?;
        let to_read = (len - seek_pos) as usize;
        buf.resize(to_read.max(1), 0);
        file.read_exact(&mut buf).map_err(|e| e.to_string())?;
        hasher.update(&buf);
    }
    hasher.update(len.to_le_bytes());
    Ok(hasher
        .finalize()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect())
}

fn compute_full_hash(path: &str) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect())
}

fn push_full_hash_groups_parallel(
    size: u64,
    candidates: Vec<&FileEntry>,
    groups_out: &mut Vec<DuplicateGroup>,
    cancel: &Arc<AtomicBool>,
    processed_full: &Arc<AtomicU64>,
) {
    if candidates.len() < 2 {
        return;
    }
    let pairs: Vec<(String, DuplicateFile)> = candidates
        .par_iter()
        .filter_map(|f| {
            if cancel.load(Ordering::Relaxed) {
                return None;
            }
            match compute_full_hash(&f.path) {
                Ok(h) => {
                    processed_full.fetch_add(1, Ordering::Relaxed);
                    Some((
                        h,
                        DuplicateFile {
                            name: f.name.clone(),
                            path: f.path.clone(),
                        },
                    ))
                }
                Err(_) => None,
            }
        })
        .collect();

    if cancel.load(Ordering::Relaxed) {
        return;
    }

    let mut fm: HashMap<String, Vec<DuplicateFile>> = HashMap::new();
    for (h, df) in pairs {
        fm.entry(h).or_default().push(df);
    }
    for (content_hash, file_list) in fm {
        if file_list.len() > 1 {
            let wasted = size * (file_list.len() as u64 - 1);
            groups_out.push(DuplicateGroup {
                content_hash,
                size,
                files: file_list,
                total_wasted: wasted,
            });
        }
    }
}

fn process_duplicate_buckets(
    app: &AppHandle,
    buckets: Vec<Vec<&FileEntry>>,
    cancel: &Arc<AtomicBool>,
    groups_out: &mut Vec<DuplicateGroup>,
) -> Result<(), String> {
    if buckets.is_empty() {
        return Ok(());
    }

    let total_partial: u64 = buckets.iter().map(|b| b.len() as u64).sum();
    let processed = Arc::new(AtomicU64::new(0));
    let stop = Arc::new(AtomicBool::new(false));
    let stop_mon = Arc::clone(&stop);
    let app_m = app.clone();
    let proc_m = Arc::clone(&processed);
    let tp = total_partial;
    let mon = thread::spawn(move || {
        while !stop_mon.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(200));
            let _ = app_m.emit(
                "duplicate-progress",
                DuplicateProgress {
                    phase: "partial_hash".to_string(),
                    processed: proc_m.load(Ordering::Relaxed),
                    total: tp,
                },
            );
        }
    });

    let mut full_jobs: Vec<(u64, Vec<&FileEntry>)> = Vec::new();

    for bucket in buckets {
        if cancel.load(Ordering::Relaxed) {
            stop.store(true, Ordering::Relaxed);
            let _ = mon.join();
            return Err("Duplicate scan cancelled".to_string());
        }
        let size = bucket[0].size;
        let partial_rows: Vec<(String, &FileEntry)> = bucket
            .par_iter()
            .filter_map(|f| {
                compute_partial_hash(&f.path).ok().map(|h| {
                    processed.fetch_add(1, Ordering::Relaxed);
                    (h, *f)
                })
            })
            .collect();

        let mut pm: HashMap<String, Vec<&FileEntry>> = HashMap::new();
        for (h, f) in partial_rows {
            pm.entry(h).or_default().push(f);
        }
        for candidates in pm.into_values() {
            if candidates.len() >= 2 {
                full_jobs.push((size, candidates));
            }
        }
    }

    stop.store(true, Ordering::Relaxed);
    let _ = mon.join();

    if cancel.load(Ordering::Relaxed) {
        return Err("Duplicate scan cancelled".to_string());
    }

    let total_full: u64 = full_jobs.iter().map(|(_, c)| c.len() as u64).sum();

    if total_full > 0 {
        let processed_full = Arc::new(AtomicU64::new(0));
        let stop2 = Arc::new(AtomicBool::new(false));
        let stop2_mon = Arc::clone(&stop2);
        let app_m2 = app.clone();
        let proc_m2 = Arc::clone(&processed_full);
        let tf = total_full;
        let mon2 = thread::spawn(move || {
            while !stop2_mon.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(200));
                let _ = app_m2.emit(
                    "duplicate-progress",
                    DuplicateProgress {
                        phase: "full_hash".to_string(),
                        processed: proc_m2.load(Ordering::Relaxed),
                        total: tf,
                    },
                );
            }
        });

        for (size, candidates) in full_jobs {
            if cancel.load(Ordering::Relaxed) {
                stop2.store(true, Ordering::Relaxed);
                let _ = mon2.join();
                return Err("Duplicate scan cancelled".to_string());
            }
            push_full_hash_groups_parallel(
                size,
                candidates,
                groups_out,
                cancel,
                &processed_full,
            );
        }

        stop2.store(true, Ordering::Relaxed);
        let _ = mon2.join();
    }

    Ok(())
}

fn find_duplicates_inner(
    app: AppHandle,
    scan_tree: ScanNode,
    quick_scan: bool,
    cancel: Arc<AtomicBool>,
) -> Result<Vec<DuplicateGroup>, String> {
    if cancel.load(Ordering::Relaxed) {
        return Err("Duplicate scan cancelled".to_string());
    }

    let mut files = Vec::new();
    collect_files(&scan_tree, &mut files);
    files.retain(|f| f.size > 0);

    let buckets: Vec<Vec<&FileEntry>> = if quick_scan {
        let mut by_name_size: HashMap<(String, u64), Vec<&FileEntry>> = HashMap::new();
        for f in &files {
            by_name_size
                .entry((f.name.clone(), f.size))
                .or_default()
                .push(f);
        }
        by_name_size
            .into_values()
            .filter(|b| b.len() >= 2)
            .collect()
    } else {
        let mut by_size: HashMap<u64, Vec<&FileEntry>> = HashMap::new();
        for f in &files {
            by_size.entry(f.size).or_default().push(f);
        }
        by_size
            .into_values()
            .filter(|b| b.len() >= 2)
            .collect()
    };

    let mut groups_out = Vec::new();
    process_duplicate_buckets(&app, buckets, &cancel, &mut groups_out)?;

    if cancel.load(Ordering::Relaxed) {
        return Err("Duplicate scan cancelled".to_string());
    }

    groups_out.sort_by(|a, b| b.total_wasted.cmp(&a.total_wasted));
    Ok(groups_out)
}

#[command]
pub async fn find_duplicates(
    app: AppHandle,
    dup_state: State<'_, Mutex<DuplicateScanState>>,
    scan_tree: ScanNode,
    quick_scan: bool,
) -> Result<Vec<DuplicateGroup>, String> {
    let cancel_flag = {
        let mut lock = dup_state
            .lock()
            .map_err(|_| "Duplicate scan state lock poisoned".to_string())?;
        lock.cancel_flag = Arc::new(AtomicBool::new(false));
        Arc::clone(&lock.cancel_flag)
    };

    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        find_duplicates_inner(app_clone, scan_tree, quick_scan, cancel_flag)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[command]
pub fn cancel_duplicate_scan(dup_state: State<'_, Mutex<DuplicateScanState>>) {
    if let Ok(lock) = dup_state.lock() {
        lock.cancel_flag.store(true, Ordering::Relaxed);
    }
}
