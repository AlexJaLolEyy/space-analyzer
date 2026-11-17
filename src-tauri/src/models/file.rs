use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum FileCategory {
    Video,
    Image,
    Audio,
    Document,
    Archive,
    Code,
    Executable,
    System,
    Database,
    Font,
    Other,
}

impl FileCategory {
    pub const COUNT: usize = 11;
    pub const ALL: [FileCategory; Self::COUNT] = [
        FileCategory::Video,
        FileCategory::Image,
        FileCategory::Audio,
        FileCategory::Document,
        FileCategory::Archive,
        FileCategory::Code,
        FileCategory::Executable,
        FileCategory::System,
        FileCategory::Database,
        FileCategory::Font,
        FileCategory::Other,
    ];

    pub fn from_u8(v: u8) -> FileCategory {
        Self::ALL.get(v as usize).copied().unwrap_or(FileCategory::Other)
    }

    /// Name as serialized to the frontend (serde default: variant name).
    pub fn name(self) -> &'static str {
        match self {
            FileCategory::Video => "Video",
            FileCategory::Image => "Image",
            FileCategory::Audio => "Audio",
            FileCategory::Document => "Document",
            FileCategory::Archive => "Archive",
            FileCategory::Code => "Code",
            FileCategory::Executable => "Executable",
            FileCategory::System => "System",
            FileCategory::Database => "Database",
            FileCategory::Font => "Font",
            FileCategory::Other => "Other",
        }
    }
}
