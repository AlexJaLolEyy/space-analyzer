export type DriveType = "SSD" | "HDD" | "Removable" | "Network" | "Unknown";

export interface DriveInfo {
    name: string;
    mount_point: string;
    total_bytes: number;
    free_bytes: number;
    used_bytes: number;
    drive_type: DriveType;
    file_system: string;
}
