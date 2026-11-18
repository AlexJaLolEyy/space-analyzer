use super::file::FileCategory;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanNode {
    pub name: String,
    pub path: String,
    pub size: u64,
    /// Size on disk (allocated clusters).
    pub alloc: u64,
    pub is_dir: bool,
    pub children: Vec<ScanNode>,
    pub file_count: u64,
    pub category: FileCategory,
    pub last_modified: Option<u64>,
    #[serde(default)]
    pub protected: bool,
    /// Size change since the previous snapshot of this root.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delta: Option<i64>,
}
