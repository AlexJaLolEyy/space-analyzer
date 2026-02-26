use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct DriveInfo {
    pub name: String,
    pub mount_point: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub used_bytes: u64,
    pub drive_type: DriveType,
    pub file_system: String,
}

#[derive(Debug, Clone, Serialize)]
pub enum DriveType {
    SSD,
    HDD,
    Removable,
    Network,
    Unknown,
}
