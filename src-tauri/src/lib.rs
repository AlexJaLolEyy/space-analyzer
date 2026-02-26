pub mod commands;
pub mod models;
pub mod utils;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(std::sync::Mutex::new(commands::scanner::ScanState {
            cancel_flag: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }))
        .invoke_handler(tauri::generate_handler![
            commands::drives::list_drives,
            commands::scanner::start_scan,
            commands::scanner::cancel_scan
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
