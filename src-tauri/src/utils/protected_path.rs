use std::path::Path;

/// Same rules as delete safety: system locations that must not be treated as user cleanup targets
/// and must be marked protected on scan nodes.
pub fn is_protected_path(path: &Path) -> bool {
    #[cfg(windows)]
    {
        let protected_components = [
            "windows",
            "program files",
            "program files (x86)",
            "programdata",
            "system volume information",
            "boot",
            "recovery",
            "$recycle.bin",
        ];
        let protected_filenames = [
            "pagefile.sys",
            "hiberfil.sys",
            "swapfile.sys",
            "ntldr",
            "bootmgr",
        ];

        if let Some(name) = path
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
        {
            if protected_filenames.iter().any(|p| p == &name) {
                return true;
            }
        }

        for c in path.components() {
            if let std::path::Component::Normal(os) = c {
                if let Some(s) = os.to_str() {
                    let lower = s.to_ascii_lowercase();
                    if protected_components.iter().any(|p| p == &lower) {
                        return true;
                    }
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        let _ = path;
    }

    false
}
