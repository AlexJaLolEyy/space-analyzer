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
                    // Efficiently check exclusions without multiple allocations
                    let os_name = dir_entry.file_name();

                    // Simple check for common exclusions
                    let name_str = os_name.to_string_lossy();
                    !excludes.contains(&name_str.as_ref())
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
            let file_type = dir_entry.file_type;

            // Skip symbolic links to avoid loops
            if file_type.is_symlink() {
                continue;
            }

            let file_path = dir_entry.path();
            let is_dir = file_type.is_dir();

            // Determine size and metadata ONLY if needed
            let mut size = 0;
            let mut last_modified = None;

            if !is_dir {
                if let Ok(m) = dir_entry.metadata() {
                    size = m.len();
                    last_modified = m
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs());
                } else {
                    continue;
                }
            }

            if !is_dir {
                files_scanned += 1;
                bytes_scanned += size;
            }

            // DEV LIMIT: Cap at 500GB/1M files for faster testing if needed
            #[cfg(debug_assertions)]
            if bytes_scanned > 500_000_000_000 || files_scanned > 1_000_000 {
                break;
            }

            if is_dir {
                // Ignore root to avoid overwriting the pre-initialized path matching
                if file_path != PathBuf::from(&path) {
                    let name = file_path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();

                    let node = ScanNode {
                        name,
                        path: file_path.to_string_lossy().to_string(),
                        size: 0,
                        is_dir: true,
                        children: Vec::with_capacity(16),
                        file_count: 0,
                        category: FileCategory::Other,
                        last_modified,
                    };
                    nodes_map.insert(file_path.clone(), node);
                }
            } else {
                // For files, directly insert into parent dir's children if possible
                if let Some(parent_path) = file_path.parent() {
                    if let Some(parent_node) = nodes_map.get_mut(parent_path) {
                        parent_node.size += size;
                        parent_node.file_count += 1;

                        // CULLING OPTIMIZATION:
                        // Only create ScanNode and categorize for files > 1MB
                        if size > 1_048_576 {
                            let category = if let Some(ext) = file_path.extension() {
                                categorize_file(&ext.to_string_lossy())
                            } else {
                                FileCategory::Other
                            };

                            let name = file_path
                                .file_name()
                                .map(|n| n.to_string_lossy().to_string())
                                .unwrap_or_default();

                            let node = ScanNode {
                                name,
                                path: file_path.to_string_lossy().to_string(),
                                size,
                                is_dir: false,
                                children: Vec::new(),
                                file_count: 1,
                                category,
                                last_modified,
                            };
                            parent_node.children.push(node);
                        }
                    }
                }
            }

            // Limit emissions (300ms + file count threshold)
            if (files_scanned % 5000 == 0 || is_dir) && last_emit.elapsed().as_millis() > 300 {
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
