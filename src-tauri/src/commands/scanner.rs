use crate::errors::AppError;
use crate::models::scan::ScanNode;
use crate::scan::{scan_path, Progress};
use crate::scan_session::ScanSession;
use crate::scan_stream::ScanStreamMsg;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::ipc::Channel;
use tauri::{command, AppHandle, Emitter, State};

pub struct ScanState {
    pub cancel_flag: Arc<AtomicBool>,
}

#[derive(serde::Serialize)]
pub struct ScanResult {
    pub root: ScanNode,
    pub engine: String,
    pub elapsed_ms: u64,
}

#[derive(serde::Serialize)]
pub struct PrivilegeStatus {
    pub is_elevated: bool,
}

pub fn validate_scan_path(path: &str) -> Result<PathBuf, AppError> {
    let p = Path::new(path);
    let canonical = std::fs::canonicalize(p).map_err(|e| AppError::validation(format!("Invalid scan path: {e}")))?;
    if !canonical.is_dir() {
        return Err(AppError::validation("Scan path must be a directory"));
    }
    Ok(canonical)
}

#[command]
pub async fn start_scan(
    app: AppHandle,
    state: State<'_, Mutex<ScanState>>,
    app_state: State<'_, Mutex<crate::AppState>>,
    session: State<'_, ScanSession>,
    path: String,
    excluded: Option<Vec<String>>,
    stream: Channel<ScanStreamMsg>,
) -> Result<ScanResult, AppError> {
    let excluded = excluded.unwrap_or_default();
    let canonical = validate_scan_path(&path)?;
    {
        let mut app_state_lock = app_state.lock().unwrap_or_else(|e| e.into_inner());
        app_state_lock.scan_root = Some(canonical.clone());
        app_state_lock.is_elevated = crate::utils::is_admin();
    }

    let cancel_flag = {
        let mut state_lock = state.lock().unwrap_or_else(|e| e.into_inner());
        state_lock.cancel_flag = Arc::new(AtomicBool::new(false));
        Arc::clone(&state_lock.cancel_flag)
    };

    let scan_path_str = crate::scan::clean_path(&canonical.to_string_lossy());

    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let ch = Mutex::new(stream);
        let progress = move |p: Progress| {
            let guard = ch.lock().unwrap_or_else(|e| e.into_inner());
            let _ = guard.send(ScanStreamMsg::Progress {
                files_scanned: p.files,
                bytes_scanned: p.bytes,
                current_path: p.phase.to_string(),
                percent: p.percent,
                elapsed_ms: p.elapsed_ms,
                engine: p.engine.to_string(),
            });
        };
        scan_path(&scan_path_str, None, &cancel_flag, &progress, &excluded)
    })
    .await
    .map_err(|e| AppError::Internal {
        message: e.to_string(),
    })?
    .map_err(|e| {
        if e == "Scan cancelled" {
            AppError::Cancelled
        } else {
            AppError::Internal { message: e }
        }
    })?;

    let engine = outcome.engine.label().to_string();
    let elapsed_ms = outcome.elapsed_ms;
    session.replace(outcome.arena);
    let root = session.with_arena(|a| Ok(a.root_shallow(2)))?;

    // compare with the previous snapshot of this root, then save the new one
    let bg_session = session.inner().clone();
    std::thread::spawn(move || {
        crate::snapshot::update_deltas_and_save(&bg_session, crate::snapshot::ORIGIN_APP, true);
        let _ = app.emit("deltas-ready", ());
    });

    Ok(ScanResult { root, engine, elapsed_ms })
}

/// Re-reads one folder from disk and splices the result into the loaded scan. Files resolve to
/// their parent folder; a folder that no longer exists is removed from the scan.
#[command]
pub async fn rescan_subtree(
    app: AppHandle,
    session: State<'_, ScanSession>,
    path: String,
) -> Result<ScanNode, AppError> {
    let (target, generation, full_path, excluded, is_root) = session
        .read(move |a| {
            let mut id = a.resolve_path(&path)?;
            if !a.is_dir(id) {
                id = a.parent_of(id);
            }
            Ok((id, a.generation(), a.full_path(id), a.excluded().clone(), id == a.root_id()))
        })
        .await?;

    if !Path::new(&full_path).is_dir() {
        if is_root {
            return Err(AppError::validation("The scanned folder no longer exists"));
        }
        let node = session
            .write(move |a| {
                if a.generation() != generation {
                    return Err("The scan changed while refreshing; try again".to_string());
                }
                let parent = a.parent_of(target);
                a.remove_node(target)?;
                Ok(a.node_to_scan(parent, 0))
            })
            .await?;
        spawn_deltas(app, session.inner().clone());
        return Ok(node);
    }

    // walk outside the lock so the UI stays responsive while the disk is read
    let cancel = Arc::new(AtomicBool::new(false));
    let scan_dir = full_path.clone();
    let raw = tauri::async_runtime::spawn_blocking(move || {
        let progress = |_p: Progress| {};
        crate::scan::walker::scan(&scan_dir, &cancel, &progress, std::time::Instant::now(), &excluded)
    })
    .await
    .map_err(|e| AppError::Internal { message: e.to_string() })?
    .map_err(|e| AppError::Internal { message: e })?;

    let node = session
        .write(move |a| {
            if a.generation() != generation {
                return Err("The scan changed while refreshing; try again".to_string());
            }
            a.replace_subtree(target, raw, &AtomicBool::new(false))?;
            Ok(a.node_to_scan(target, 0))
        })
        .await?;
    spawn_deltas(app, session.inner().clone());
    Ok(node)
}

#[derive(serde::Serialize)]
pub struct QuickRefresh {
    /// "refreshed", "unsupported" (not a Turbo drive-root scan) or "needs_rescan" (journal can't be replayed).
    pub status: &'static str,
    pub changed: usize,
    pub message: Option<String>,
}

/// Brings a Turbo drive-root scan up to date from the NTFS change journal in a second or two,
/// without walking the disk.
#[command]
pub async fn quick_refresh(app: AppHandle, session: State<'_, ScanSession>) -> Result<QuickRefresh, AppError> {
    let result = session
        .write(move |a| {
            const ROOT_RECORD: u32 = 5;
            if a.root_id() != ROOT_RECORD || a.mft_meta().is_none() {
                return Ok(QuickRefresh { status: "unsupported", changed: 0, message: None });
            }
            let cancel = AtomicBool::new(false);
            let this = std::mem::take(a);
            let (mut raw, meta) = this.into_raw();
            let outcome = crate::scan::ntfs::quick_refresh(&mut raw);
            // `quick_refresh` only touches `raw` after every read succeeded, so rebuilding is
            // correct for both outcomes.
            *a = crate::models::flat_scan::ScanArena::from_raw_with_meta(raw, meta, &cancel)?;
            Ok(match outcome {
                Ok(changed) => QuickRefresh { status: "refreshed", changed, message: None },
                Err(e) => QuickRefresh { status: "needs_rescan", changed: 0, message: Some(e) },
            })
        })
        .await?;
    if result.status == "refreshed" {
        spawn_deltas(app, session.inner().clone());
    }
    Ok(result)
}

/// Recomputes "changes since last scan" in the background after the tree was patched.
fn spawn_deltas(app: AppHandle, session: ScanSession) {
    std::thread::spawn(move || {
        crate::snapshot::update_deltas_and_save(&session, crate::snapshot::ORIGIN_APP, false);
        let _ = app.emit("deltas-ready", ());
    });
}

/// Starts or stops watching the scanned folder for changes (`tree-changed` events).
#[command]
pub fn set_live_watch(
    app: AppHandle,
    session: State<'_, ScanSession>,
    watch: State<'_, crate::watcher::WatchState>,
    enabled: bool,
) -> Result<(), AppError> {
    let mut slot = watch.0.lock().unwrap_or_else(|e| e.into_inner());
    *slot = None; // dropping the old watcher stops it
    if !enabled {
        return Ok(());
    }
    let root = session.with_arena(|a| Ok(a.root_path().to_string()))?;
    let w = crate::watcher::start(app, session.inner().clone(), &root).map_err(|e| AppError::Internal { message: e })?;
    *slot = Some(w);
    Ok(())
}

#[command]
pub fn cancel_scan(state: State<'_, Mutex<ScanState>>) {
    let state_lock = state.lock().unwrap_or_else(|e| e.into_inner());
    state_lock.cancel_flag.store(true, Ordering::Relaxed);
}

#[command]
pub fn get_privilege_status(app_state: State<'_, Mutex<crate::AppState>>) -> Result<PrivilegeStatus, AppError> {
    let lock = app_state.lock().unwrap_or_else(|e| e.into_inner());
    Ok(PrivilegeStatus {
        is_elevated: lock.is_elevated,
    })
}

#[command]
pub fn relaunch_as_admin(path: Option<String>) -> Result<(), AppError> {
    crate::utils::relaunch_as_admin(path.as_deref());
    Ok(())
}
