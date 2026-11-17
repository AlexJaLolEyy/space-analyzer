use crate::errors::AppError;
use crate::models::flat_scan::ScanArena;
use crate::models::history::{ScanDiff, ScanHistoryEntry};
use crate::models::scan::ScanNode;
use crate::scan_session::ScanSession;
use chrono::Utc;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Write};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

const MAX_DIFF_ENTRIES: usize = 1000;

fn validate_history_id(id: &str) -> Result<(), AppError> {
    Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| AppError::validation("Invalid scan ID"))
}

fn get_history_dir(app_handle: &AppHandle) -> Result<PathBuf, AppError> {
    let mut path = app_handle
        .path()
        .app_data_dir()
        .map_err(|_| AppError::io("Failed to get app data directory"))?;

    path.push("history");
    if !path.exists() {
        fs::create_dir_all(&path)?;
    }
    Ok(path)
}

fn read_snapshot(app_handle: &AppHandle, id: &str) -> Result<ScanArena, AppError> {
    validate_history_id(id)?;
    let mut data_path = get_history_dir(app_handle)?;
    data_path.push(format!("{}.snap.gz", id));

    if !data_path.exists() {
        return Err(AppError::NotFound {
            path: id.to_string(),
        });
    }
    let file = File::open(data_path)?;
    let mut rd = BufReader::with_capacity(1 << 20, GzDecoder::new(file));
    let cancel = AtomicBool::new(false);
    Ok(ScanArena::read_snapshot(&mut rd, &cancel)?)
}

fn join(base: &str, name: &str) -> String {
    if base.ends_with('\\') {
        format!("{}{}", base, name)
    } else {
        format!("{}\\{}", base, name)
    }
}

#[derive(Default)]
struct DiffAcc {
    added: Vec<(String, u64)>,
    removed: Vec<(String, u64)>,
    grown: Vec<(String, u64, u64)>,
    shrunk: Vec<(String, u64, u64)>,
}

fn diff_dirs(a: &ScanArena, ai: u32, b: &ScanArena, bi: u32, path: &str, acc: &mut DiffAcc) {
    let mut a_map: HashMap<String, u32> = HashMap::new();
    for c in a.live_children(ai) {
        a_map.insert(a.name(c).to_lowercase(), c);
    }
    for bc in b.live_children(bi) {
        let name = b.name(bc);
        let cpath = join(path, name);
        match a_map.remove(&name.to_lowercase()) {
            Some(ac) => {
                let (sa, sb) = (a.size(ac), b.size(bc));
                if sb > sa {
                    acc.grown.push((cpath.clone(), sa, sb));
                } else if sb < sa {
                    acc.shrunk.push((cpath.clone(), sa, sb));
                }
                if a.is_dir(ac) && b.is_dir(bc) && sa != sb {
                    diff_dirs(a, ac, b, bc, &cpath, acc);
                }
            }
            None => acc.added.push((cpath, b.size(bc))),
        }
    }
    for (_, ac) in a_map {
        acc.removed.push((join(path, a.name(ac)), a.size(ac)));
    }
}

fn finish_diff(mut acc: DiffAcc) -> ScanDiff {
    acc.added.sort_by(|x, y| y.1.cmp(&x.1));
    acc.removed.sort_by(|x, y| y.1.cmp(&x.1));
    let delta = |t: &(String, u64, u64)| t.1.abs_diff(t.2);
    acc.grown.sort_by(|x, y| delta(y).cmp(&delta(x)));
    acc.shrunk.sort_by(|x, y| delta(y).cmp(&delta(x)));
    acc.added.truncate(MAX_DIFF_ENTRIES);
    acc.removed.truncate(MAX_DIFF_ENTRIES);
    acc.grown.truncate(MAX_DIFF_ENTRIES);
    acc.shrunk.truncate(MAX_DIFF_ENTRIES);
    ScanDiff {
        added: acc.added.into_iter().map(|x| x.0).collect(),
        removed: acc.removed.into_iter().map(|x| x.0).collect(),
        grown: acc.grown,
        shrunk: acc.shrunk,
    }
}

#[tauri::command]
pub async fn save_scan(
    app_handle: AppHandle,
    session: State<'_, ScanSession>,
    label: String,
) -> Result<String, AppError> {
    let history_dir = get_history_dir(&app_handle)?;
    let id = Uuid::new_v4().to_string();

    let data_path = history_dir.join(format!("{}.snap.gz", id));
    let entry = session.with_arena(|a| {
        let file = File::create(&data_path).map_err(|e| e.to_string())?;
        let enc = GzEncoder::new(file, Compression::fast());
        let mut w = BufWriter::with_capacity(1 << 20, enc);
        a.write_snapshot(&mut w).map_err(|e| e.to_string())?;
        let enc = w.into_inner().map_err(|e| e.to_string())?;
        enc.finish().map_err(|e| e.to_string())?;
        Ok(ScanHistoryEntry {
            id: id.clone(),
            label: label.clone(),
            timestamp: Utc::now().to_rfc3339(),
            drive_path: a.display_name(a.root_id()),
            total_size: a.total_size(),
            file_count: a.total_files(),
        })
    })?;

    let meta_path = history_dir.join(format!("{}.json", id));
    let mut f = File::create(meta_path)?;
    f.write_all(serde_json::to_string(&entry)?.as_bytes())?;
    Ok(id)
}

#[tauri::command]
pub async fn list_scans(app_handle: AppHandle) -> Result<Vec<ScanHistoryEntry>, AppError> {
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

    entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(entries)
}

#[tauri::command]
pub async fn load_scan(
    app_handle: AppHandle,
    session: State<'_, ScanSession>,
    id: String,
) -> Result<ScanNode, AppError> {
    let arena = read_snapshot(&app_handle, &id)?;
    session.replace(arena);
    session.with_arena(|a| Ok(a.root_shallow(2)))
}

#[tauri::command]
pub async fn delete_scan_history(app_handle: AppHandle, id: String) -> Result<(), AppError> {
    validate_history_id(&id)?;
    let dir = get_history_dir(&app_handle)?;
    let _ = fs::remove_file(dir.join(format!("{}.json", id)));
    let _ = fs::remove_file(dir.join(format!("{}.snap.gz", id)));
    Ok(())
}

#[tauri::command]
pub async fn compare_scans(
    app_handle: AppHandle,
    id_a: String,
    id_b: String,
) -> Result<ScanDiff, AppError> {
    let a = read_snapshot(&app_handle, &id_a)?;
    let b = read_snapshot(&app_handle, &id_b)?;
    let mut acc = DiffAcc::default();
    diff_dirs(&a, a.root_id(), &b, b.root_id(), &b.full_path(b.root_id()), &mut acc);
    Ok(finish_diff(acc))
}
