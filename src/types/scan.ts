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
    /** Size on disk (allocated clusters). */
    alloc: number;
    is_dir: boolean;
    children: ScanNode[];
    file_count: number;
    category: FileCategory;
    last_modified: number | null;
    /** System-protected path; UI must not offer deletion. */
    protected?: boolean;
    /** Size change since the previous snapshot of this root. */
    delta?: number;
}

export interface ScanResult {
    root: ScanNode;
    engine: string;
    elapsed_ms: number;
}

export interface ScanProgress {
    files_scanned: number;
    bytes_scanned: number;
    current_path: string;
    percent: number;
    elapsed_ms: number;
    engine: string;
}

export type ScanStreamMsg = {
    type: "progress";
    files_scanned: number;
    bytes_scanned: number;
    current_path: string;
    percent: number;
    elapsed_ms: number;
    engine: string;
};

export interface SearchHit {
    name: string;
    path: string;
    size: number;
    alloc: number;
    is_dir: boolean;
    category: FileCategory;
    file_count: number;
    last_modified: number | null;
    protected?: boolean;
}

export interface ChangesSummary {
    since: number | null;
    /** 0 = saved by the app, 1 = background snapshot. */
    origin: number;
    total_delta: number;
    top: ScanNode[];
}

export interface ExtStat {
    /** Lowercase extension without the dot; empty for files without one. */
    ext: string;
    count: number;
    size: number;
    alloc: number;
    category: FileCategory;
}
