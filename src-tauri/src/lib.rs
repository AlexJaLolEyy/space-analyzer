pub mod commands;
pub mod models;
pub mod utils;

use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    pub scan_root: Option<PathBuf>,
    pub delete_lock: Mutex<()>,
    pub is_elevated: bool,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    println!("Space Analyzer Booting...");

    if crate::utils::is_admin() {
        println!("[ADMIN] Running with elevated privileges.");
    } else {
        println!("[USER] Running with normal user privileges. Turbo Mode will be disabled.");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Mutex::new(commands::scanner::ScanState {
            cancel_flag: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }))
        .manage(Mutex::new(commands::duplicates::DuplicateScanState {
            cancel_flag: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }))
        .manage(Mutex::new(AppState {
            scan_root: None,
            delete_lock: Mutex::new(()),
            is_elevated: crate::utils::is_admin(),
        }))
        .invoke_handler(tauri::generate_handler![
            commands::drives::list_drives,
            commands::scanner::start_scan,
            commands::scanner::cancel_scan,
            commands::scanner::get_privilege_status,
            commands::scanner::relaunch_as_admin,
            commands::file_ops::delete_item,
            commands::file_ops::delete_items,
            commands::duplicates::find_duplicates,
            commands::duplicates::cancel_duplicate_scan,
            commands::history::save_scan,
            commands::history::list_scans,
            commands::history::load_scan,
            commands::history::delete_scan_history,
            commands::history::compare_scans
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
