//! Native platform abstraction. Everything OS-specific lives below this
//! module; the rest of the app only sees the types re-exported here.
//! A future macOS/Linux port implements the same surface.

#[cfg(windows)]
pub mod windows;

use serde::{Deserialize, Serialize};

/// An installed application discovered on the system.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEntry {
    /// Display name (shortcut name without extension).
    pub name: String,
    /// The shortcut file that produced this entry (.lnk), if any.
    pub shortcut_path: Option<String>,
    /// Resolved launch target (exe or document path).
    pub target_path: String,
    /// Arguments baked into the shortcut.
    pub args: String,
    /// Icon cache key; resolve to a file via the icons module.
    pub icon: Option<String>,
    /// Where the entry came from: "start-menu" | "desktop".
    pub source: String,
}

/// COM apartment guard: initializes COM on the current thread and
/// uninitializes on drop. Platform modules that touch COM create one
/// at the top of their blocking task.
#[cfg(windows)]
pub struct ComApartment {
    initialized: bool,
}

#[cfg(windows)]
impl ComApartment {
    pub fn new() -> Self {
        use ::windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
        // S_FALSE (already initialized) still requires a matching uninit;
        // only a real failure (e.g. wrong apartment mode) skips the drop.
        let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        Self {
            initialized: hr.is_ok(),
        }
    }
}

#[cfg(windows)]
impl Drop for ComApartment {
    fn drop(&mut self) {
        if self.initialized {
            unsafe { ::windows::Win32::System::Com::CoUninitialize() };
        }
    }
}
