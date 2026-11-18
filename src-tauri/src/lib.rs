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
    let launch_path = match headless::parse_launch(&args) {
        headless::Launch::Snapshot { path, excluded } => std::process::exit(headless::run_snapshot(&path, &excluded)),
        headless::Launch::Gui(p) => p,
    };
    // An elevated relaunch starts while the old process is still exiting; let it finish first so
    // the single-instance guard doesn't mistake it for a second window.
    if args.iter().any(|a| a == "--relaunched") {
        std::thread::sleep(std::time::Duration::from_millis(1500));
    }

    println!("Space Analyzer Booting...");

    if crate::utils::is_admin() {
        println!("[ADMIN] Running with elevated privileges.");
    } else {
        println!("[USER] Running with normal user privileges. Turbo Mode will be disabled.");
    }

    tauri::Builder::default()
        // must be registered first: a second launch (Explorer menu) hands its folder to this window
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            use tauri::{Emitter, Manager};
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            if let headless::Launch::Gui(Some(p)) = headless::parse_launch(&argv[argv.len().min(1)..]) {
                let _ = app.emit("launch-path", p);
            }
        }))
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
        .manage(commands::shell::LaunchPath(Mutex::new(launch_path)))
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
            commands::scanner::quick_refresh,
            commands::schedule::get_schedule,
            commands::schedule::set_schedule,
            commands::schedule::remove_schedule,
            commands::scanner::get_privilege_status,
            commands::scanner::relaunch_as_admin,
            commands::shell::get_explorer_integration,
            commands::shell::set_explorer_integration,
            commands::shell::take_launch_path,
            commands::shell::show_properties,
            commands::file_ops::delete_item,
            commands::file_ops::delete_items,
            commands::duplicates::find_duplicates,
            commands::duplicates::cancel_duplicate_scan
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
