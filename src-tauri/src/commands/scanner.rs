use crate::models::scan::ScanNode;
use crate::utils::fs_walker::scan_directory;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{command, AppHandle, State};

pub struct ScanState {
    pub cancel_flag: Arc<AtomicBool>,
}

#[derive(serde::Serialize)]
pub struct PrivilegeStatus {
    pub is_elevated: bool,
}

pub fn validate_scan_path(path: &str) -> Result<PathBuf, String> {
    let p = Path::new(path);
    let canonical = std::fs::canonicalize(p).map_err(|e| format!("Invalid scan path: {e}"))?;
    if !canonical.is_dir() {
        return Err("Scan path must be a directory".to_string());
    }
    Ok(canonical)
}

#[command]
pub async fn start_scan(
    app: AppHandle,
    state: State<'_, Mutex<ScanState>>,
    app_state: State<'_, Mutex<crate::AppState>>,
    path: String,
) -> Result<ScanNode, String> {
    let canonical = validate_scan_path(&path)?;
    {
        let mut app_state_lock = app_state.lock().map_err(|_| "State lock poisoned".to_string())?;
        app_state_lock.scan_root = Some(canonical.clone());
        app_state_lock.is_elevated = crate::utils::is_admin();
    }

    let cancel_flag = {
        let mut state_lock = state.lock().unwrap();
        state_lock.cancel_flag = Arc::new(AtomicBool::new(false));
        Arc::clone(&state_lock.cancel_flag)
    };

    // Run in blocking thread so we don't block the async runtime
    let canonical_str = canonical.to_string_lossy().to_string();
    // Windows canonicalize yields \\?\C:\ — strip for drive-root check and MFT volume path
    let scan_path = if canonical_str.starts_with(r"\\?\") {
        canonical_str[4..].to_string()
    } else {
        canonical_str
    };
    let is_elevated = crate::utils::is_admin();
    let result = tauri::async_runtime::spawn_blocking(move || {
        // Attempt NTFS MFT scan if it's a root drive and we're on Windows
        #[cfg(target_os = "windows")]
        if scan_path.len() <= 3 && scan_path.contains(':') {
            if is_elevated {
                println!("Attempting high-speed MFT scan for {}", scan_path);
                if let Ok(res) =
                    crate::utils::mft_scanner::scan_ntfs_mft(&app, &scan_path, cancel_flag.clone())
                {
                    return res;
                }
                println!("MFT scan failed, falling back to standard walker");
            } else {
                println!("[WARNING] Not running as administrator. MFT Turbo Mode is disabled. Speed will be limited.");
            }
        }

        scan_directory(&app, scan_path, cancel_flag)
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(result)
}

#[command]
pub fn cancel_scan(state: State<'_, Mutex<ScanState>>) {
    if let Ok(state_lock) = state.lock() {
        state_lock.cancel_flag.store(true, Ordering::Relaxed);
    }
}

#[command]
pub fn get_privilege_status(app_state: State<'_, Mutex<crate::AppState>>) -> Result<PrivilegeStatus, String> {
    let lock = app_state.lock().map_err(|_| "State lock poisoned".to_string())?;
    Ok(PrivilegeStatus {
        is_elevated: lock.is_elevated,
    })
}

#[command]
pub fn relaunch_as_admin() -> Result<(), String> {
    crate::utils::relaunch_as_admin();
    Ok(())
}
