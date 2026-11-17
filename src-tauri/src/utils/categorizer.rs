use crate::models::file::FileCategory;

/// Allocation-free categorization from a file name (uses the text after the last '.').
pub fn categorize_name(name: &str) -> FileCategory {
    let Some(dot) = name.rfind('.') else {
        return FileCategory::Other;
    };
    let ext = &name.as_bytes()[dot + 1..];
    if ext.is_empty() || ext.len() > 8 {
        return FileCategory::Other;
    }
    let mut buf = [0u8; 8];
    for (i, b) in ext.iter().enumerate() {
        buf[i] = b.to_ascii_lowercase();
    }
    match std::str::from_utf8(&buf[..ext.len()]) {
        Ok(s) => categorize_lower(s),
        Err(_) => FileCategory::Other,
    }
}

#[allow(dead_code)]
pub fn categorize_file(extension: &str) -> FileCategory {
    categorize_lower(&extension.to_lowercase())
}

fn categorize_lower(ext: &str) -> FileCategory {
    match ext {
        "mp4" | "mkv" | "avi" | "mov" | "wmv" | "flv" | "webm" | "m4v" => FileCategory::Video,
        "jpg" | "jpeg" | "png" | "gif" | "bmp" | "webp" | "svg" | "tiff" | "ico" => {
            FileCategory::Image
        }
        "mp3" | "wav" | "ogg" | "flac" | "aac" | "m4a" | "wma" => FileCategory::Audio,
        "pdf" | "doc" | "docx" | "ppt" | "pptx" | "xls" | "xlsx" | "txt" | "rtf" | "csv" | "md" => {
            FileCategory::Document
        }
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" | "iso" => FileCategory::Archive,
        "json" | "js" | "ts" | "jsx" | "tsx" | "html" | "css" | "py" | "java" | "c" | "cpp"
        | "cs" | "go" | "rs" | "php" | "rb" | "sh" | "xml" | "yaml" | "yml" => FileCategory::Code,
        "exe" | "msi" | "bat" | "cmd" | "app" | "apk" | "dmg" => FileCategory::Executable,
        "dll" | "sys" | "ini" | "cfg" | "log" => FileCategory::System,
        "db" | "sqlite" | "sql" | "mdb" | "accdb" => FileCategory::Database,
        "ttf" | "otf" | "woff" | "woff2" | "eot" => FileCategory::Font,
        _ => FileCategory::Other,
    }
}
