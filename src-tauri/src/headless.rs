//! Command-line entry points shared by the app (`--snapshot`, launch path) and the CLI binary.

use crate::scan::scan_path;
use crate::snapshot::{snapshot_dir, write_snapshot, ORIGIN_HEADLESS};
use std::io::Write;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

/// What the process was asked to do.
#[derive(Debug, PartialEq, Eq)]
pub enum Launch {
    /// Open the window; optionally scan this folder right away (Explorer context menu).
    Gui(Option<String>),
    /// Scan, save a snapshot and exit (scheduled task).
    Snapshot { path: String, excluded: Vec<String> },
}

/// Parses the arguments after the executable name.
pub fn parse_launch(args: &[String]) -> Launch {
    let mut snapshot: Option<String> = None;
    let mut excluded: Vec<String> = Vec::new();
    let mut gui_path: Option<String> = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--snapshot" => {
                if let Some(p) = args.get(i + 1) {
                    snapshot = Some(p.clone());
                    i += 1;
                }
            }
            "--exclude" => {
                if let Some(x) = args.get(i + 1) {
                    excluded.push(x.clone());
                    i += 1;
                }
            }
            a if a.starts_with("--") => {}
            a => {
                if gui_path.is_none() {
                    gui_path = Some(a.trim_matches('"').to_string());
                }
            }
        }
        i += 1;
    }
    match snapshot {
        Some(path) => Launch::Snapshot { path, excluded },
        None => Launch::Gui(gui_path),
    }
}

fn log(line: &str) {
    let dir = snapshot_dir();
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("headless.log")) {
        let _ = writeln!(f, "{} {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"), line);
    }
}

#[cfg(windows)]
fn lower_priority() {
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, SetPriorityClass, PROCESS_MODE_BACKGROUND_BEGIN};
    unsafe {
        SetPriorityClass(GetCurrentProcess(), PROCESS_MODE_BACKGROUND_BEGIN);
    }
}

#[cfg(not(windows))]
fn lower_priority() {}

/// Scans `path`, saves a snapshot (origin: headless) and returns the process exit code
/// (0 = saved, 1 = failed). Everything is logged to `headless.log` in the snapshot folder.
pub fn run_snapshot(path: &str, excluded: &[String]) -> i32 {
    lower_priority();
    log(&format!("snapshot start: {path}"));
    let canonical = match std::fs::canonicalize(Path::new(path)) {
        Ok(p) if p.is_dir() => crate::scan::clean_path(&p.to_string_lossy()),
        Ok(_) => {
            log("failed: not a directory");
            return 1;
        }
        Err(e) => {
            log(&format!("failed: {e}"));
            return 1;
        }
    };
    let cancel = Arc::new(AtomicBool::new(false));
    let noop = |_p: crate::scan::Progress| {};
    match scan_path(&canonical, None, &cancel, &noop, excluded) {
        Ok(outcome) => match write_snapshot(&outcome.arena, ORIGIN_HEADLESS) {
            Ok(file) => {
                log(&format!(
                    "snapshot saved: {} ({} files, {} bytes, {}, {} ms)",
                    file.display(),
                    outcome.arena.total_files(),
                    outcome.arena.total_size(),
                    outcome.engine.label(),
                    outcome.elapsed_ms
                ));
                0
            }
            Err(e) => {
                log(&format!("failed to save snapshot: {e}"));
                1
            }
        },
        Err(e) => {
            log(&format!("scan failed: {e}"));
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn parses_launch_modes() {
        assert_eq!(parse_launch(&s(&[])), Launch::Gui(None));
        assert_eq!(parse_launch(&s(&[r"C:\Users\me\Videos"])), Launch::Gui(Some(r"C:\Users\me\Videos".into())));
        assert_eq!(
            parse_launch(&s(&["--snapshot", r"D:\", "--exclude", "node_modules"])),
            Launch::Snapshot { path: r"D:\".into(), excluded: s(&["node_modules"]) }
        );
    }
}
