//! Small shared helpers for the Win32 layer.

use std::hash::{Hash, Hasher};

/// Null-terminated UTF-16 buffer for passing strings to Win32.
pub fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// UTF-16 buffer (fixed size, e.g. MAX_PATH) back to a trimmed String.
pub fn from_wide(buf: &[u16]) -> String {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len])
}

/// Stable cache key for a path (case-insensitive on Windows).
pub fn path_key(path: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.to_lowercase().hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}
