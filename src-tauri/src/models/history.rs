use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScanHistoryEntry {
    pub id: String,
    pub label: String,
    pub timestamp: String,
    pub drive_path: String,
    pub total_size: u64,
    pub file_count: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScanDiff {
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub grown: Vec<(String, u64, u64)>, // path, old_size, new_size
    pub shrunk: Vec<(String, u64, u64)>, 
}
