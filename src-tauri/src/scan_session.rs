use crate::errors::AppError;
use crate::models::flat_scan::ScanArena;
use std::sync::RwLock;

pub struct ScanSession(RwLock<Option<ScanArena>>);

impl Default for ScanSession {
    fn default() -> Self {
        Self::new()
    }
}

impl ScanSession {
    pub fn new() -> Self {
        Self(RwLock::new(None))
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
}
