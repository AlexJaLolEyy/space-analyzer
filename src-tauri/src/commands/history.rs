use chrono::Utc;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::models::history::{ScanDiff, ScanHistoryEntry};
use crate::models::scan::ScanNode;

fn get_history_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app_handle
        .path()
        .app_data_dir()
        .map_err(|_| "Failed to get app data dir".to_string())?;

    path.push("history");
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

#[tauri::command]
pub async fn save_scan(
    app_handle: AppHandle,
    tree: ScanNode,
    label: String,
) -> Result<String, String> {
    let history_dir = get_history_dir(&app_handle)?;
    let id = Uuid::new_v4().to_string();
    let timestamp = Utc::now().to_rfc3339();

    let entry = ScanHistoryEntry {
        id: id.clone(),
        label,
        timestamp,
        drive_path: tree.name.clone(),
        total_size: tree.size,
        file_count: tree.file_count,
    };

    // Save metadata
    let mut meta_path = history_dir.clone();
    meta_path.push(format!("{}.json", id));
    let meta_json = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
    fs::write(meta_path, meta_json).map_err(|e| e.to_string())?;

    // Save scan tree as gzipped JSON
    let mut data_path = history_dir;
    data_path.push(format!("{}.tree.gz", id));

    let file = File::create(data_path).map_err(|e| e.to_string())?;
    let mut encoder = GzEncoder::new(file, Compression::default());

    let tree_json = serde_json::to_string(&tree).map_err(|e| e.to_string())?;
    encoder
        .write_all(tree_json.as_bytes())
        .map_err(|e| e.to_string())?;
    encoder.finish().map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
pub async fn list_scans(app_handle: AppHandle) -> Result<Vec<ScanHistoryEntry>, String> {
    let history_dir = get_history_dir(&app_handle)?;
    let mut entries = Vec::new();

    if let Ok(dir_entries) = fs::read_dir(history_dir) {
        for entry in dir_entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Ok(content) = fs::read_to_string(path) {
                    if let Ok(history_entry) = serde_json::from_str::<ScanHistoryEntry>(&content) {
                        entries.push(history_entry);
                    }
                }
            }
        }
    }

    // Sort by timestamp descending
    entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(entries)
}

#[tauri::command]
pub async fn load_scan(app_handle: AppHandle, id: String) -> Result<ScanNode, String> {
    let mut data_path = get_history_dir(&app_handle)?;
    data_path.push(format!("{}.tree.gz", id));

    if !data_path.exists() {
        return Err("Scan data not found".into());
    }

    let file = File::open(data_path).map_err(|e| e.to_string())?;
    let mut decoder = GzDecoder::new(file);
    let mut json_str = String::new();
    decoder
        .read_to_string(&mut json_str)
        .map_err(|e| e.to_string())?;

    let tree: ScanNode = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;
    Ok(tree)
}

#[tauri::command]
pub async fn delete_scan_history(app_handle: AppHandle, id: String) -> Result<(), String> {
    let dir = get_history_dir(&app_handle)?;
    let meta_path = dir.join(format!("{}.json", id));
    let data_path = dir.join(format!("{}.tree.gz", id));

    let _ = fs::remove_file(meta_path);
    let _ = fs::remove_file(data_path);

    Ok(())
}

fn build_path_map(node: &ScanNode, map: &mut HashMap<String, u64>) {
    map.insert(node.path.clone(), node.size);
    for child in &node.children {
        build_path_map(child, map);
    }
}

#[tauri::command]
pub async fn compare_scans(
    app_handle: AppHandle,
    id_a: String,
    id_b: String,
) -> Result<ScanDiff, String> {
    let tree_a = load_scan(app_handle.clone(), id_a).await?;
    let tree_b = load_scan(app_handle, id_b).await?;

    let mut map_a = HashMap::new();
    let mut map_b = HashMap::new();

    build_path_map(&tree_a, &mut map_a);
    build_path_map(&tree_b, &mut map_b);

    let mut diff = ScanDiff {
        added: Vec::new(),
        removed: Vec::new(),
        grown: Vec::new(),
        shrunk: Vec::new(),
    };

    for (path, &size_b) in &map_b {
        match map_a.get(path) {
            Some(&size_a) => {
                if size_b > size_a {
                    diff.grown.push((path.clone(), size_a, size_b));
                } else if size_b < size_a {
                    diff.shrunk.push((path.clone(), size_a, size_b));
                }
            }
            None => {
                diff.added.push(path.clone());
            }
        }
    }

    for path in map_a.keys() {
        if !map_b.contains_key(path) {
            diff.removed.push(path.clone());
        }
    }

    Ok(diff)
}
