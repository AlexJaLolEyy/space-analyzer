use super::categorizer::categorize_file;
use crate::models::{file::FileCategory, scan::ScanNode};
use jwalk::WalkDirGeneric;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Instant;
use tauri::Emitter;

#[derive(Clone, Serialize)]
pub struct ScanProgress {
    pub files_scanned: u64,
    pub bytes_scanned: u64,
    pub current_path: String,
    pub percent: f32,
    pub elapsed_ms: u64,
}

pub fn scan_directory(
    app_handle: &tauri::AppHandle,
    path: String,
    cancel_flag: Arc<AtomicBool>,
) -> ScanNode {
    let start_time = Instant::now();
    let mut files_scanned = 0;
    let mut bytes_scanned = 0;
    let mut last_emit = Instant::now();

    // Quick exclusions
    let excludes = [
        "$Recycle.Bin",
        "System Volume Information",
        "pagefile.sys",
        "hiberfil.sys",
    ];

    let root_node = ScanNode {
        name: Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone()),
        path: path.clone(),
        size: 0,
        is_dir: true,
        children: Vec::new(),
        file_count: 0,
        category: FileCategory::Other,
        last_modified: None,
    };

    // nodes_map only stores DIRECTORIES to save memory and processing time.
    let mut nodes_map: HashMap<PathBuf, ScanNode> = HashMap::new();
    nodes_map.insert(PathBuf::from(&path), root_node);

    let flag_clone = Arc::clone(&cancel_flag);
    let walker = WalkDirGeneric::<((), ())>::new(&path)
        .skip_hidden(false)
        .process_read_dir(move |_depth, _path, _read_dir_state, children| {
            if flag_clone.load(Ordering::Relaxed) {
                return;
            }
            children.retain(|dir_entry_result| {
                if let Ok(dir_entry) = dir_entry_result {
                    let name = dir_entry.file_name().to_string_lossy().to_string();
                    !excludes.contains(&name.as_str())
                } else {
                    false
                }
            });
        });

    for entry in walker {
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }

        if let Ok(dir_entry) = entry {
            let metadata = match dir_entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };

            // Skip symbolic links to avoid loops
            if dir_entry.file_type.is_symlink() {
                continue;
            }

            let file_path = dir_entry.path();

            let name = file_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            let is_dir = dir_entry.file_type.is_dir();
            let size = if is_dir { 0 } else { metadata.len() };

            let last_modified = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs());

            let category = if !is_dir {
                if let Some(ext) = file_path.extension() {
                    categorize_file(&ext.to_string_lossy())
                } else {
                    FileCategory::Other
                }
            } else {
                FileCategory::Other
            };

            if !is_dir {
                files_scanned += 1;
                bytes_scanned += size;
            }

            // DEV LIMIT: Cap at 20GB so development testing is fast (only applies in debug builds)
            #[cfg(debug_assertions)]
            if bytes_scanned > 20_000_000_000 || files_scanned > 100_000 {
                break;
            }

            let node = ScanNode {
                name: name.clone(),
                path: file_path.to_string_lossy().to_string(),
                size,
                is_dir,
                children: Vec::new(),
                file_count: if is_dir { 0 } else { 1 },
                category,
                last_modified,
            };

            if is_dir {
                // Ignore root to avoid overwriting the pre-initialized path matching
                if file_path != PathBuf::from(&path) {
                    nodes_map.insert(file_path.clone(), node);
                }
            } else {
                // For files, directly insert into parent dir's children if possible
                if let Some(parent_path) = file_path.parent() {
                    if let Some(parent_node) = nodes_map.get_mut(parent_path) {
                        // Aggregate size & file count immediately
                        parent_node.size += size;
                        parent_node.file_count += 1;

                        // CULLING OPTIMIZATION:
                        // Do not send native files smaller than 1MB to the UI to avoid
                        // crashing the WebView's V8 JSON parser with gigabytes of stringified data.
                        // The size is still perfectly accounted for in the parent directory!
                        if size > 1_048_576 {
                            // 1MB threshold
                            parent_node.children.push(node);
                        }
                    }
                }
            }

            // Limit emissions to keep frontend from hanging
            if last_emit.elapsed().as_millis() > 200 {
                last_emit = Instant::now();
                let _ = app_handle.emit(
                    "scan-progress",
                    ScanProgress {
                        files_scanned,
                        bytes_scanned,
                        current_path: file_path.to_string_lossy().to_string(),
                        percent: 0.0,
                        elapsed_ms: start_time.elapsed().as_millis() as u64,
                    },
                );
            }
        }
    }

    // Now organize directories into the tree recursively
    let mut paths: Vec<_> = nodes_map.keys().cloned().collect();
    // Sort directories so deeper ones are processed first
    paths.sort_by_key(|p| std::cmp::Reverse(p.components().count()));

    for p in paths {
        if p == PathBuf::from(&path) {
            continue;
        }

        let mut node = nodes_map.remove(&p).unwrap();

        if let Some(parent) = p.parent() {
            if let Some(parent_node) = nodes_map.get_mut(parent) {
                // Because we go bottom-up, this bubbles the total child sizes to the parent
                parent_node.size += node.size;
                parent_node.file_count += node.file_count;

                // Optional: we can sort the node's children here to keep the structure clean
                node.children.sort_by(|a, b| b.size.cmp(&a.size));

                parent_node.children.push(node);
            }
        }
    }

    let mut final_root = nodes_map.remove(&PathBuf::from(&path)).unwrap();
    final_root.children.sort_by(|a, b| b.size.cmp(&a.size));

    final_root
}
