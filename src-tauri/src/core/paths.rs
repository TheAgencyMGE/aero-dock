//! Where Aero Dock keeps its files.
//!
//! Installed, that is the usual per-user config directory under `%APPDATA%`.
//! Portable, everything goes in a `data` folder beside the executable, so the
//! whole thing can live on a USB stick and leave nothing behind on the host.
//!
//! Portable mode is switched on by a `portable.txt` file next to the
//! executable. The zip ships with one, the installer does not, so the same
//! binary covers both without a separate build.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::{AppHandle, Manager};

use crate::core::AeroResult;

/// Drop this next to the executable to make the app portable.
pub const MARKER: &str = "portable.txt";

/// Everything a portable install writes goes under here.
const PORTABLE_DIR: &str = "data";

/// The folder holding the running executable.
fn exe_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.parent().map(Path::to_path_buf)
}

/// True when a `portable.txt` sits next to the executable.
///
/// Resolved once per process. A marker dropped in while the app is running
/// will not move the files out from under it mid-session.
pub fn is_portable() -> bool {
    static PORTABLE: OnceLock<bool> = OnceLock::new();
    *PORTABLE.get_or_init(|| exe_dir().is_some_and(|dir| dir.join(MARKER).is_file()))
}

/// Pick between the folder beside the executable and the installed one.
///
/// Split out from [`is_portable`] so the choice itself is testable without
/// touching the filesystem or the real executable path.
fn root_for(exe_dir: &Path, portable: bool, installed: &Path) -> PathBuf {
    if portable {
        exe_dir.join(PORTABLE_DIR)
    } else {
        installed.to_path_buf()
    }
}

/// Resolve a root, falling back to the installed location if the executable
/// path cannot be read for some reason.
fn resolve(installed: PathBuf) -> PathBuf {
    match (is_portable(), exe_dir()) {
        (true, Some(dir)) => root_for(&dir, true, &installed),
        _ => installed,
    }
}

/// Where `settings.json` lives.
pub fn config_dir(app: &AppHandle) -> AeroResult<PathBuf> {
    Ok(resolve(app.path().app_config_dir()?))
}

/// Where the icon cache lives.
pub fn data_dir(app: &AppHandle) -> AeroResult<PathBuf> {
    Ok(resolve(app.path().app_data_dir()?))
}

/// WebView2 writes its own profile somewhere too, and by default that is
/// under `%LOCALAPPDATA%`. Portable runs point it inside the data folder so
/// the host machine keeps nothing.
///
/// Returns `None` when not portable, meaning leave WebView2 alone.
pub fn webview_dir() -> Option<PathBuf> {
    if !is_portable() {
        return None;
    }
    exe_dir().map(|dir| dir.join(PORTABLE_DIR).join("webview"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portable_writes_beside_the_executable() {
        let exe = Path::new(r"D:\Apps\AeroDock");
        let installed = Path::new(r"C:\Users\a\AppData\Roaming\com.aerodock.desktop");
        assert_eq!(
            root_for(exe, true, installed),
            PathBuf::from(r"D:\Apps\AeroDock\data")
        );
    }

    #[test]
    fn installed_writes_to_the_user_profile() {
        let exe = Path::new(r"C:\Program Files\Aero Dock");
        let installed = Path::new(r"C:\Users\a\AppData\Roaming\com.aerodock.desktop");
        assert_eq!(root_for(exe, false, installed), installed.to_path_buf());
    }

    #[test]
    fn a_moved_portable_folder_follows_the_executable() {
        let installed = Path::new(r"C:\Users\a\AppData\Roaming\com.aerodock.desktop");
        let before = root_for(Path::new(r"E:\AeroDock"), true, installed);
        let after = root_for(Path::new(r"F:\Tools\AeroDock"), true, installed);
        assert_ne!(before, after);
        assert!(after.ends_with(PORTABLE_DIR));
    }
}
