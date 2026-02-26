use crate::models::scan::ScanNode;
use crate::utils::fs_walker::scan_directory;
use std::sync::Mutex;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{command, AppHandle, State};

pub struct ScanState {
    pub cancel_flag: Arc<AtomicBool>,
}

#[command]
pub async fn start_scan(
    app: AppHandle,
    state: State<'_, Mutex<ScanState>>,
    path: String,
) -> Result<ScanNode, String> {
    let cancel_flag = {
        let mut state_lock = state.lock().unwrap();
        state_lock.cancel_flag = Arc::new(AtomicBool::new(false));
        Arc::clone(&state_lock.cancel_flag)
    };

    // Run in blocking thread so we don't block the async runtime
    let result =
        tauri::async_runtime::spawn_blocking(move || scan_directory(&app, path, cancel_flag))
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
