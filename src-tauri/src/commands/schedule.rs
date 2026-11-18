//! Scheduled background snapshots, registered with the Windows Task Scheduler (`schtasks.exe`).
//! The task runs this executable with `--snapshot <path>`; the saved snapshot then feeds the
//! "changes since last scan" comparison.

use crate::errors::AppError;
use serde::{Deserialize, Serialize};
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;

const TASK_NAME: &str = "SpaceAnalyzerSnapshot";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize, Deserialize, Clone)]
pub struct Schedule {
    pub path: String,
    /// "daily" or "weekly"
    pub frequency: String,
    /// "HH:MM", 24h
    pub time: String,
    /// Weekly only: MON..SUN
    pub day: String,
    pub excluded: Vec<String>,
}

fn config_path() -> std::path::PathBuf {
    crate::snapshot::snapshot_dir().join("schedule.json")
}

fn schtasks(args: &[String]) -> Result<std::process::Output, AppError> {
    Command::new("schtasks.exe")
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| AppError::io(format!("Could not run schtasks: {e}")))
}

fn task_exists() -> bool {
    schtasks(&["/Query".into(), "/TN".into(), TASK_NAME.into()])
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn valid_time(t: &str) -> bool {
    let Some((h, m)) = t.split_once(':') else { return false };
    matches!((h.parse::<u32>(), m.parse::<u32>()), (Ok(h), Ok(m)) if h < 24 && m < 60 && m.to_string().len() <= 2)
        && h.len() == 2
        && m.len() == 2
}

/// Builds the `/TR` command line. A trailing backslash would escape the closing quote, so
/// drive roots become `D:\.`.
pub fn task_command(exe: &str, s: &Schedule) -> String {
    let mut path = s.path.trim().trim_end_matches('"').to_string();
    if path.ends_with('\\') {
        path.push('.');
    }
    let mut cmd = format!("\"{exe}\" --snapshot \"{path}\"");
    for x in &s.excluded {
        cmd.push_str(&format!(" --exclude \"{x}\""));
    }
    cmd
}

#[tauri::command]
pub async fn get_schedule() -> Result<Option<Schedule>, AppError> {
    tauri::async_runtime::spawn_blocking(|| {
        if !task_exists() {
            return Ok(None);
        }
        let s = std::fs::read_to_string(config_path())
            .ok()
            .and_then(|t| serde_json::from_str::<Schedule>(&t).ok());
        Ok(s)
    })
    .await
    .map_err(|e| AppError::Internal { message: e.to_string() })?
}

#[tauri::command]
pub async fn set_schedule(schedule: Schedule) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        if !matches!(schedule.frequency.as_str(), "daily" | "weekly") {
            return Err(AppError::validation("Frequency must be daily or weekly"));
        }
        if !valid_time(&schedule.time) {
            return Err(AppError::validation("Time must be HH:MM"));
        }
        if !matches!(schedule.day.as_str(), "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN") {
            return Err(AppError::validation("Invalid weekday"));
        }
        if schedule.excluded.iter().any(|x| x.contains('"')) {
            return Err(AppError::validation("Exclusions cannot contain quotes"));
        }
        if !Path::new(schedule.path.trim()).is_dir() {
            return Err(AppError::validation("Choose an existing folder to snapshot"));
        }
        let exe = std::env::current_exe()
            .map_err(|e| AppError::io(e.to_string()))?
            .to_string_lossy()
            .trim_start_matches(r"\\?\")
            .to_string();
        let tr = task_command(&exe, &schedule);
        if tr.len() > 255 {
            return Err(AppError::validation("The path and exclusions are too long for a scheduled task"));
        }
        let mut args: Vec<String> = vec![
            "/Create".into(),
            "/F".into(),
            "/TN".into(),
            TASK_NAME.into(),
            "/SC".into(),
            if schedule.frequency == "daily" { "DAILY".into() } else { "WEEKLY".into() },
            "/ST".into(),
            schedule.time.clone(),
            "/TR".into(),
            tr,
        ];
        if schedule.frequency == "weekly" {
            args.push("/D".into());
            args.push(schedule.day.clone());
        }
        // Elevated tasks can use the fast MFT engine.
        if crate::utils::is_admin() {
            args.push("/RL".into());
            args.push("HIGHEST".into());
        }
        let out = schtasks(&args)?;
        if !out.status.success() {
            let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(AppError::io(if msg.is_empty() { "schtasks failed".to_string() } else { msg }));
        }
        let dir = crate::snapshot::snapshot_dir();
        let _ = std::fs::create_dir_all(&dir);
        let json = serde_json::to_string_pretty(&schedule).map_err(|e| AppError::io(e.to_string()))?;
        std::fs::write(config_path(), json).map_err(|e| AppError::io(e.to_string()))?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::Internal { message: e.to_string() })?
}

#[tauri::command]
pub async fn remove_schedule() -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(|| {
        if task_exists() {
            let out = schtasks(&["/Delete".into(), "/TN".into(), TASK_NAME.into(), "/F".into()])?;
            if !out.status.success() {
                return Err(AppError::io(String::from_utf8_lossy(&out.stderr).trim().to_string()));
            }
        }
        let _ = std::fs::remove_file(config_path());
        Ok(())
    })
    .await
    .map_err(|e| AppError::Internal { message: e.to_string() })?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sched(path: &str) -> Schedule {
        Schedule {
            path: path.into(),
            frequency: "daily".into(),
            time: "03:00".into(),
            day: "MON".into(),
            excluded: vec!["node_modules".into()],
        }
    }

    #[test]
    fn builds_task_command() {
        assert_eq!(
            task_command(r"C:\app\sa.exe", &sched(r"D:\")),
            r#""C:\app\sa.exe" --snapshot "D:\." --exclude "node_modules""#
        );
        assert!(task_command("x.exe", &sched(r"C:\Users\me")).contains(r#"--snapshot "C:\Users\me""#));
    }

    #[test]
    fn validates_time() {
        assert!(valid_time("03:00"));
        assert!(valid_time("23:59"));
        assert!(!valid_time("24:00"));
        assert!(!valid_time("3:00"));
        assert!(!valid_time("abc"));
    }
}
