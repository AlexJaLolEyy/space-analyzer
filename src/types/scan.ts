export type FileCategory =
    | "Video"
    | "Image"
    | "Audio"
    | "Document"
    | "Archive"
    | "Code"
    | "Executable"
    | "System"
    | "Database"
    | "Font"
    | "Other";

export interface ScanNode {
    name: string;
    path: string;
    size: number;
    is_dir: boolean;
    children: ScanNode[];
    file_count: number;
    category: FileCategory;
    last_modified: number | null;
    /** System-protected path; UI must not offer deletion. */
    protected?: boolean;
}

export interface ScanProgress {
    files_scanned: number;
    bytes_scanned: number;
    current_path: string;
    percent: number;
    elapsed_ms: number;
}

export type ScanStreamMsg = {
    type: "progress";
    files_scanned: number;
    bytes_scanned: number;
    current_path: string;
    percent: number;
    elapsed_ms: number;
};

export interface SearchHit {
    name: string;
    path: string;
    size: number;
    is_dir: boolean;
    category: FileCategory;
    file_count: number;
    last_modified: number | null;
    protected?: boolean;
}
