use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct DuplicateFile {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DuplicateGroup {
    pub hash: String,
    pub size: u64,
    pub files: Vec<DuplicateFile>,
    pub total_wasted: u64,
}
