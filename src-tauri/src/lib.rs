pub mod commands;
pub mod errors;
pub mod export;
pub mod headless;
pub mod models;
pub mod scan;
pub mod scan_session;
pub mod scan_stream;
pub mod search;
pub mod snapshot;
pub mod utils;

use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    pub scan_root: Option<PathBuf>,
    pub is_elevated: bool,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // --snapshot <path> runs without a window (scheduled snapshots)
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let headless::Launch::Snapshot { path, excluded } = headless::parse_launch(&args) {
        std::process::exit(headless::run_snapshot(&path, &excluded));
    }

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
            is_elevated: crate::utils::is_admin(),
        }))
        .manage(scan_session::ScanSession::new())
        .invoke_handler(tauri::generate_handler![
            commands::drives::list_drives,
            commands::scanner::start_scan,
            commands::tree_api::get_children,
            commands::tree_api::get_node_info,
            commands::tree_api::search_nodes,
            commands::tree_api::get_top_files,
            commands::tree_api::get_category_breakdown,
            commands::tree_api::get_top_folders,
            commands::tree_api::get_extension_stats,
            commands::tree_api::get_treemap,
            commands::tree_api::get_biggest_changes,
            commands::tree_api::get_changes_summary,
            commands::tree_api::get_dashboard_stats,
            commands::tree_api::get_export_subtree,
            commands::tree_api::export_scan,
            commands::tree_api::get_cleanup_candidates,
            commands::scanner::cancel_scan,
            commands::scanner::rescan_subtree,
            commands::scanner::get_privilege_status,
            commands::scanner::relaunch_as_admin,
            commands::file_ops::delete_item,
            commands::file_ops::delete_items,
            commands::duplicates::find_duplicates,
            commands::duplicates::cancel_duplicate_scan
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
