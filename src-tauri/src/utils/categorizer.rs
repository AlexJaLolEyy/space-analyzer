use crate::models::file::FileCategory;

pub fn categorize_file(extension: &str) -> FileCategory {
    match extension.to_lowercase().as_str() {
        // Video
        "mp4" | "mkv" | "avi" | "mov" | "wmv" | "flv" | "webm" | "m4v" => FileCategory::Video,
        // Image
        "jpg" | "jpeg" | "png" | "gif" | "bmp" | "webp" | "svg" | "tiff" | "ico" => FileCategory::Image,
        // Audio
        "mp3" | "wav" | "ogg" | "flac" | "aac" | "m4a" | "wma" => FileCategory::Audio,
        // Document
        "pdf" | "doc" | "docx" | "ppt" | "pptx" | "xls" | "xlsx" | "txt" | "rtf" | "csv" | "md" => FileCategory::Document,
        // Archive
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" | "iso" => FileCategory::Archive,
        // Code
        "json" | "js" | "ts" | "jsx" | "tsx" | "html" | "css" | "py" | "java" | "c" | "cpp" | "cs" | "go" | "rs" | "php" | "rb" | "sh" | "xml" | "yaml" | "yml" => FileCategory::Code,
        // Executable
        "exe" | "msi" | "bat" | "cmd" | "sh" | "app" | "apk" | "dmg" => FileCategory::Executable,
        // System
        "dll" | "sys" | "ini" | "cfg" | "log" => FileCategory::System,
        // Database
        "db" | "sqlite" | "sql" | "mdb" | "accdb" => FileCategory::Database,
        // Font
        "ttf" | "otf" | "woff" | "woff2" | "eot" => FileCategory::Font,
        // Other
        _ => FileCategory::Other,
    }
}
