pub mod categorizer;
pub mod fs_walker;
pub mod mft_scanner;

pub fn is_admin() -> bool {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
        use windows_sys::Win32::Security::{
            GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
        };
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

        unsafe {
            let mut token: HANDLE = 0;
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) != 0 {
                let mut elevation: TOKEN_ELEVATION = std::mem::zeroed();
                let mut size = std::mem::size_of::<TOKEN_ELEVATION>() as u32;
                if GetTokenInformation(
                    token,
                    TokenElevation,
                    &mut elevation as *mut _ as *mut _,
                    size,
                    &mut size,
                ) != 0
                {
                    CloseHandle(token);
                    return elevation.TokenIsElevated != 0;
                }
                CloseHandle(token);
            }
        }
        false
    }
    #[cfg(not(windows))]
    {
        true // Or appropriate check for Unix
    }
}

pub fn relaunch_as_admin() {
    #[cfg(windows)]
    {
        if is_admin() {
            return;
        }

        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOW;

        let exe_path = std::env::current_exe().expect("Failed to get current executable path");
        let exe_path_wide: Vec<u16> = exe_path.as_os_str().encode_wide().chain(Some(0)).collect();
        let verb_wide: Vec<u16> = "runas\0".encode_utf16().collect();

        unsafe {
            let result = ShellExecuteW(
                0,
                verb_wide.as_ptr(),
                exe_path_wide.as_ptr(),
                core::ptr::null(),
                core::ptr::null(),
                SW_SHOW,
            );

            // If ShellExecuteW fails (returns <= 32), we don't exit to avoid killing the app if user cancels UAC
            if result as usize > 32 {
                std::process::exit(0);
            }
        }
    }
}
