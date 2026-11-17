use crate::errors::AppError;
use crate::models::scan::ScanNode;
use crate::scan::{scan_path, Progress};
use crate::scan_session::ScanSession;
use crate::scan_stream::ScanStreamMsg;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::ipc::Channel;
use tauri::{command, State};

pub struct ScanState {
    pub cancel_flag: Arc<AtomicBool>,
}

#[derive(serde::Serialize)]
pub struct PrivilegeStatus {
    pub is_elevated: bool,
}

pub fn validate_scan_path(path: &str) -> Result<PathBuf, AppError> {
    let p = Path::new(path);
    let canonical = std::fs::canonicalize(p).map_err(|e| AppError::validation(format!("Invalid scan path: {e}")))?;
    if !canonical.is_dir() {
        return Err(AppError::validation("Scan path must be a directory"));
    }
    Ok(canonical)
}

#[command]
pub async fn start_scan(
    state: State<'_, Mutex<ScanState>>,
    app_state: State<'_, Mutex<crate::AppState>>,
    session: State<'_, ScanSession>,
    path: String,
    stream: Channel<ScanStreamMsg>,
) -> Result<ScanNode, AppError> {
    let canonical = validate_scan_path(&path)?;
    {
        let mut app_state_lock = app_state.lock().unwrap_or_else(|e| e.into_inner());
        app_state_lock.scan_root = Some(canonical.clone());
        app_state_lock.is_elevated = crate::utils::is_admin();
    }

    let cancel_flag = {
        let mut state_lock = state.lock().unwrap_or_else(|e| e.into_inner());
        state_lock.cancel_flag = Arc::new(AtomicBool::new(false));
        Arc::clone(&state_lock.cancel_flag)
    };

    let scan_path_str = crate::scan::clean_path(&canonical.to_string_lossy());

    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let ch = Mutex::new(stream);
        let progress = move |p: Progress| {
            let guard = ch.lock().unwrap_or_else(|e| e.into_inner());
            let _ = guard.send(ScanStreamMsg::Progress {
                files_scanned: p.files,
                bytes_scanned: p.bytes,
                current_path: p.phase.to_string(),
                percent: p.percent,
                elapsed_ms: p.elapsed_ms,
            });
        };
        scan_path(&scan_path_str, None, &cancel_flag, &progress)
    })
    .await
    .map_err(|e| AppError::Internal {
        message: e.to_string(),
    })?
    .map_err(|e| {
        if e == "Scan cancelled" {
            AppError::Cancelled
        } else {
            AppError::Internal { message: e }
        }
    })?;

    session.replace(outcome.arena);
    session.with_arena(|a| Ok(a.root_shallow(2)))
}

#[command]
pub fn cancel_scan(state: State<'_, Mutex<ScanState>>) {
    let state_lock = state.lock().unwrap_or_else(|e| e.into_inner());
    state_lock.cancel_flag.store(true, Ordering::Relaxed);
}

#[command]
pub fn get_privilege_status(app_state: State<'_, Mutex<crate::AppState>>) -> Result<PrivilegeStatus, AppError> {
    let lock = app_state.lock().unwrap_or_else(|e| e.into_inner());
    Ok(PrivilegeStatus {
        is_elevated: lock.is_elevated,
    })
}

#[command]
pub fn relaunch_as_admin() -> Result<(), AppError> {
    crate::utils::relaunch_as_admin();
    Ok(())
}
