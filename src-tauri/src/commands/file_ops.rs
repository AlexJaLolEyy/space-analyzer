use crate::errors::AppError;
use crate::scan_session::ScanSession;
use crate::utils::protected_path::is_protected_path;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;
use trash;

fn validate_delete_path(path: &str, scan_root: Option<&PathBuf>) -> Result<PathBuf, AppError> {
    let scan_root = scan_root.ok_or_else(|| {
        AppError::validation("No scan root set. Run a scan first.")
    })?;

    let original = Path::new(path);
    let original_meta = fs::symlink_metadata(original)?;
    if original_meta.file_type().is_symlink() {
        return Err(AppError::validation("Refusing to delete symlinks"));
    }

    let canonical = fs::canonicalize(original)?;
    let scan_root_canonical = fs::canonicalize(scan_root)?;

    if !canonical.starts_with(&scan_root_canonical) {
        return Err(AppError::PathTraversal {
            message: "Refusing to delete path outside scan root".to_string(),
        });
    }

    if is_protected_path(&canonical) {
        return Err(AppError::PathTraversal {
            message: "Refusing to delete system-protected paths".to_string(),
        });
    }

    Ok(canonical)
}

fn safe_remove_dir_all(path: &Path) -> Result<(), AppError> {
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let child = entry.path();
        let meta = fs::symlink_metadata(&child)?;
        let ft = meta.file_type();

        if ft.is_symlink() {
            if meta.is_dir() {
                fs::remove_dir(&child)?;
            } else {
                fs::remove_file(&child)?;
            }
            continue;
        }

        if meta.is_dir() {
            safe_remove_dir_all(&child)?;
        } else {
            fs::remove_file(&child)?;
        }
    }

    fs::remove_dir(path)?;
    Ok(())
}

fn delete_one(canonical: &Path, permanent: bool) -> Result<(), AppError> {
    let meta = fs::symlink_metadata(canonical)?;
    if meta.file_type().is_symlink() {
        return Err(AppError::validation("Cannot delete symlink targets"));
    }

    if permanent {
        if meta.is_dir() {
            safe_remove_dir_all(canonical)?;
        } else {
            fs::remove_file(canonical)?;
        }
    } else {
        trash::delete(canonical).map_err(|e| AppError::io(e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_item(
    app_state: State<'_, Mutex<crate::AppState>>,
    session: State<'_, ScanSession>,
    path: String,
    permanent: bool,
) -> Result<(), AppError> {
    let app_state_lock = app_state
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let _delete_guard = app_state_lock
        .delete_lock
        .lock()
        .unwrap_or_else(|e| e.into_inner());

    let canonical = validate_delete_path(&path, app_state_lock.scan_root.as_ref())?;
    delete_one(&canonical, permanent)?;
    let _ = session.with_arena_mut(|a| a.remove_path(&path));

    Ok(())
}

#[tauri::command]
pub fn delete_items(
    app_state: State<'_, Mutex<crate::AppState>>,
    session: State<'_, ScanSession>,
    paths: Vec<String>,
    permanent: bool,
) -> Result<Vec<String>, AppError> {
    let mut failed = Vec::new();
    let app_state_lock = app_state
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let _delete_guard = app_state_lock
        .delete_lock
        .lock()
        .unwrap_or_else(|e| e.into_inner());

    for path in paths {
        let res = (|| {
            let canonical = validate_delete_path(&path, app_state_lock.scan_root.as_ref())?;
            delete_one(&canonical, permanent)?;
            Ok::<(), AppError>(())
        })();

        if res.is_err() {
            failed.push(path);
        } else {
            let _ = session.with_arena_mut(|a| a.remove_path(&path));
        }
    }
    Ok(failed)
}
