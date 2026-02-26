use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
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
