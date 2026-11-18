use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ScanStreamMsg {
    Progress {
        files_scanned: u64,
        bytes_scanned: u64,
        current_path: String,
        percent: f32,
        elapsed_ms: u64,
        engine: String,
    },
}
