use serde::Serialize;

/// Unified error type crossing the IPC boundary. Serialized as a plain
/// message string so the frontend can surface it without knowing variants.
#[derive(Debug, thiserror::Error)]
pub enum AeroError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("tauri error: {0}")]
    Tauri(#[from] tauri::Error),

    #[cfg(windows)]
    #[error("windows api error: {0}")]
    Windows(#[from] windows::core::Error),

    #[error("image error: {0}")]
    Image(#[from] image::ImageError),

    #[error("{0}")]
    Other(String),
}

impl AeroError {
    pub fn other(msg: impl Into<String>) -> Self {
        Self::Other(msg.into())
    }
}

impl Serialize for AeroError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AeroResult<T> = Result<T, AeroError>;
