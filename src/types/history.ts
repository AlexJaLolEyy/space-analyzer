

export interface ScanHistoryEntry {
    id: string;
    label: string;
    timestamp: string;
    drive_path: string;
    total_size: number;
    file_count: number;
}

export interface ScanDiff {
    added: string[];
    removed: string[];
    grown: [string, number, number][]; // path, old_size, new_size
    shrunk: [string, number, number][];
}
