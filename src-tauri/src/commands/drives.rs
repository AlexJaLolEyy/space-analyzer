use crate::models::drive::{DriveInfo, DriveType};
use sysinfo::Disks;

#[tauri::command]
pub fn list_drives() -> Vec<DriveInfo> {
    let disks = Disks::new_with_refreshed_list();
    let mut drives = Vec::new();

    for disk in disks.list() {
        let drive_type = match disk.kind() {
            sysinfo::DiskKind::HDD => DriveType::HDD,
            sysinfo::DiskKind::SSD => DriveType::SSD,
            _ => DriveType::Unknown,
        };

        drives.push(DriveInfo {
            name: String::from_utf8_lossy(disk.name().as_encoded_bytes()).into_owned(),
            mount_point: disk.mount_point().to_string_lossy().into_owned(),
            total_bytes: disk.total_space(),
            free_bytes: disk.available_space(),
            used_bytes: disk.total_space().saturating_sub(disk.available_space()),
            drive_type,
            file_system: String::from_utf8_lossy(disk.file_system().as_encoded_bytes())
                .into_owned(),
        });
    }

    drives
}
