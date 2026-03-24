use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
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
