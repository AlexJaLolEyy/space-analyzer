//! Windows Explorer integration: context-menu entries, launch path, properties dialog.

use crate::errors::AppError;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::process::CommandExt;
use std::process::Command;
use std::sync::Mutex;
use tauri::State;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const MENU_TEXT: &str = "Analyze with Space Analyzer";

/// Folder passed on the command line (Explorer context menu), picked up once by the frontend.
pub struct LaunchPath(pub Mutex<Option<String>>);

/// `(registry key under HKCU\Software\Classes, argument Explorer substitutes)`.
/// `%V` is the folder itself for the background menu; `%1` the clicked item otherwise.
const KEYS: [(&str, &str); 3] = [
    (r"Directory\shell\SpaceAnalyzer", "%1"),
    (r"Directory\Background\shell\SpaceAnalyzer", "%V"),
    (r"Drive\shell\SpaceAnalyzer", "%1"),
];

fn reg(args: &[&str]) -> bool {
    Command::new("reg.exe")
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn full_key(k: &str) -> String {
    format!(r"HKCU\Software\Classes\{k}")
}

#[tauri::command]
pub async fn get_explorer_integration() -> Result<bool, AppError> {
    tauri::async_runtime::spawn_blocking(|| reg(&["query", &full_key(KEYS[0].0)]))
        .await
        .map_err(|e| AppError::Internal { message: e.to_string() })
}

/// Adds or removes the "Analyze with Space Analyzer" entries for the current user (no admin needed).
#[tauri::command]
pub async fn set_explorer_integration(enabled: bool) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        if !enabled {
            for (k, _) in KEYS {
                reg(&["delete", &full_key(k), "/f"]);
            }
            return Ok(());
        }
        let exe = std::env::current_exe()
            .map_err(|e| AppError::io(e.to_string()))?
            .to_string_lossy()
            .trim_start_matches(r"\\?\")
            .to_string();
        for (k, arg) in KEYS {
            let key = full_key(k);
            let command = format!("\"{exe}\" \"{arg}\"");
            let ok = reg(&["add", &key, "/ve", "/d", MENU_TEXT, "/f"])
                && reg(&["add", &key, "/v", "Icon", "/d", &format!("\"{exe}\",0"), "/f"])
                && reg(&["add", &format!(r"{key}\command"), "/ve", "/d", &command, "/f"]);
            if !ok {
                return Err(AppError::io("Could not write the Explorer context menu entries"));
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Internal { message: e.to_string() })?
}

/// Returns (and clears) the folder this process was started with, if any.
#[tauri::command]
pub fn take_launch_path(state: State<'_, LaunchPath>) -> Option<String> {
    state.0.lock().unwrap_or_else(|e| e.into_inner()).take()
}

/// Opens the Explorer "Properties" dialog for a file or folder.
#[tauri::command]
pub fn show_properties(path: String) -> Result<(), AppError> {
    use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_INVOKEIDLIST, SHELLEXECUTEINFOW};
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOW;

    let wide = |s: &str| -> Vec<u16> { std::ffi::OsStr::new(s).encode_wide().chain(Some(0)).collect() };
    let file = wide(path.trim_start_matches(r"\\?\"));
    let verb = wide("properties");
    unsafe {
        let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_INVOKEIDLIST;
        info.lpVerb = verb.as_ptr();
        info.lpFile = file.as_ptr();
        info.nShow = SW_SHOW as i32;
        if ShellExecuteExW(&mut info) == 0 {
            return Err(AppError::io("Could not open the properties dialog"));
        }
    }
    Ok(())
}
