use super::file::FileCategory;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ScanNode {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    pub children: Vec<ScanNode>,
    pub file_count: u64,
    pub category: FileCategory,
    pub last_modified: Option<u64>,
}
