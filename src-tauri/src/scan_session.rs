use crate::errors::AppError;
use crate::models::flat_scan::ScanArena;
use std::sync::{Arc, RwLock};

#[derive(Clone)]
pub struct ScanSession(Arc<RwLock<Option<ScanArena>>>);

impl Default for ScanSession {
    fn default() -> Self {
        Self::new()
    }
}

impl ScanSession {
    pub fn new() -> Self {
        Self(Arc::new(RwLock::new(None)))
    }

    pub fn replace(&self, arena: ScanArena) {
        let mut g = self.0.write().unwrap_or_else(|e| e.into_inner());
        *g = Some(arena);
    }

    #[allow(dead_code)]
    pub fn clear(&self) {
        let mut g = self.0.write().unwrap_or_else(|e| e.into_inner());
        *g = None;
    }

    pub fn with_arena<R>(&self, f: impl FnOnce(&ScanArena) -> Result<R, String>) -> Result<R, AppError> {
        let g = self.0.read().unwrap_or_else(|e| e.into_inner());
        let arena = g
            .as_ref()
            .ok_or_else(|| AppError::validation("No scan loaded"))?;
        f(arena).map_err(Into::into)
    }

    pub fn with_arena_mut<R>(&self, f: impl FnOnce(&mut ScanArena) -> Result<R, String>) -> Result<R, AppError> {
        let mut g = self.0.write().unwrap_or_else(|e| e.into_inner());
        let arena = g
            .as_mut()
            .ok_or_else(|| AppError::validation("No scan loaded"))?;
        f(arena).map_err(Into::into)
    }

    /// Runs `f` on the blocking pool with a shared lock, so commands never block the main thread.
    pub async fn read<R, F>(&self, f: F) -> Result<R, AppError>
    where
        R: Send + 'static,
        F: FnOnce(&ScanArena) -> Result<R, String> + Send + 'static,
    {
        let s = self.clone();
        tauri::async_runtime::spawn_blocking(move || s.with_arena(f))
            .await
            .map_err(|e| AppError::Internal { message: e.to_string() })?
    }

    /// Like [`read`](Self::read) but with an exclusive lock.
    pub async fn write<R, F>(&self, f: F) -> Result<R, AppError>
    where
        R: Send + 'static,
        F: FnOnce(&mut ScanArena) -> Result<R, String> + Send + 'static,
    {
        let s = self.clone();
        tauri::async_runtime::spawn_blocking(move || s.with_arena_mut(f))
            .await
            .map_err(|e| AppError::Internal { message: e.to_string() })?
    }
}
