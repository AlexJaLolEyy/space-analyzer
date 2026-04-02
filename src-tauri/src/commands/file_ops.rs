use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;
use trash;

fn is_protected_path(path: &Path) -> bool {
    #[cfg(windows)]
    {
        let protected_components = [
            "windows",
            "program files",
            "program files (x86)",
            "programdata",
            "system volume information",
            "boot",
            "recovery",
            "$recycle.bin",
        ];
        let protected_filenames = [
            "pagefile.sys",
            "hiberfil.sys",
            "swapfile.sys",
            "ntldr",
            "bootmgr",
        ];

        if let Some(name) = path
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
        {
            if protected_filenames.iter().any(|p| p == &name) {
                return true;
            }
        }

        for c in path.components() {
            if let std::path::Component::Normal(os) = c {
                if let Some(s) = os.to_str() {
                    let lower = s.to_ascii_lowercase();
                    if protected_components.iter().any(|p| p == &lower) {
                        return true;
                    }
                }
            }
        }
    }

    false
}

fn validate_delete_path(path: &str, scan_root: Option<&PathBuf>) -> Result<PathBuf, String> {
    let scan_root = scan_root.ok_or_else(|| "No scan root set. Run a scan first.".to_string())?;

    let original = Path::new(path);
    let original_meta = fs::symlink_metadata(original).map_err(|e| e.to_string())?;
    if original_meta.file_type().is_symlink() {
        return Err("Refusing to delete symlinks".to_string());
    }

    let canonical = fs::canonicalize(original).map_err(|e| e.to_string())?;
    let scan_root_canonical = fs::canonicalize(scan_root).map_err(|e| e.to_string())?;

    if !canonical.starts_with(&scan_root_canonical) {
        return Err("Refusing to delete path outside scan root".to_string());
    }

    if is_protected_path(&canonical) {
        return Err("Refusing to delete system-protected paths".to_string());
    }

    Ok(canonical)
}

fn safe_remove_dir_all(path: &Path) -> Result<(), String> {
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let child = entry.path();
        let meta = fs::symlink_metadata(&child).map_err(|e| e.to_string())?;
        let ft = meta.file_type();

        if ft.is_symlink() {
            if meta.is_dir() {
                fs::remove_dir(&child).map_err(|e| e.to_string())?;
            } else {
                fs::remove_file(&child).map_err(|e| e.to_string())?;
            }
            continue;
        }

        if meta.is_dir() {
            safe_remove_dir_all(&child)?;
        } else {
            fs::remove_file(&child).map_err(|e| e.to_string())?;
        }
    }

    fs::remove_dir(path).map_err(|e| e.to_string())?;
    Ok(())
}

fn delete_one(canonical: &Path, permanent: bool) -> Result<(), String> {
    let meta = fs::symlink_metadata(canonical).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() {
        return Err("Cannot delete symlink targets".to_string());
    }

    if permanent {
        if meta.is_dir() {
            safe_remove_dir_all(canonical)?;
        } else {
            fs::remove_file(canonical).map_err(|e| e.to_string())?;
        }
    } else {
        trash::delete(canonical).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_item(
    app_state: State<'_, Mutex<crate::AppState>>,
    path: String,
    permanent: bool,
) -> Result<(), String> {
    let app_state_lock = app_state.lock().map_err(|_| "State lock poisoned".to_string())?;
    let _delete_guard = app_state_lock
        .delete_lock
        .lock()
        .map_err(|_| "Delete lock poisoned".to_string())?;

    let canonical = validate_delete_path(&path, app_state_lock.scan_root.as_ref())?;
    delete_one(&canonical, permanent)?;
    
    Ok(())
}

#[tauri::command]
pub fn delete_items(
    app_state: State<'_, Mutex<crate::AppState>>,
    paths: Vec<String>,
    permanent: bool,
) -> Result<Vec<String>, String> {
    let mut failed = Vec::new();
    let app_state_lock = app_state.lock().map_err(|_| "State lock poisoned".to_string())?;
    let _delete_guard = app_state_lock
        .delete_lock
        .lock()
        .map_err(|_| "Delete lock poisoned".to_string())?;

    for path in paths {
        let res = (|| {
            let canonical = validate_delete_path(&path, app_state_lock.scan_root.as_ref())?;
            delete_one(&canonical, permanent)?;
            Ok::<(), String>(())
        })();

        if res.is_err() {
            failed.push(path);
        }
    }
    Ok(failed)
}
