pub mod commands;
pub mod models;
pub mod utils;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    println!("Space Analyzer Booting...");

    #[cfg(windows)]
    if !crate::utils::is_admin() {
        println!("[USER] Not running as admin. Relaunching with elevation...");
        crate::utils::relaunch_as_admin();
    }

    if crate::utils::is_admin() {
        println!("[ADMIN] Running with elevated privileges.");
    } else {
        println!("[USER] Running with normal user privileges. Turbo Mode will be disabled.");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(std::sync::Mutex::new(commands::scanner::ScanState {
            cancel_flag: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }))
        .invoke_handler(tauri::generate_handler![
            commands::drives::list_drives,
            commands::scanner::start_scan,
            commands::scanner::cancel_scan,
            commands::file_ops::delete_item,
            commands::file_ops::delete_items,
            commands::duplicates::find_duplicates,
            commands::history::save_scan,
            commands::history::list_scans,
            commands::history::load_scan,
            commands::history::delete_scan_history,
            commands::history::compare_scans
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
