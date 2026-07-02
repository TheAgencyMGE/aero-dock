//! App discovery, icon resolution, and launching.

use std::collections::HashMap;

use tauri::{AppHandle, Manager};

use crate::core::{AeroError, AeroResult};
use crate::platform::AppEntry;

/// Enumerate installed apps from the Start Menu and Desktop.
#[tauri::command]
pub async fn list_apps() -> AeroResult<Vec<AppEntry>> {
    tauri::async_runtime::spawn_blocking(crate::platform::windows::apps::enumerate_apps)
        .await
        .map_err(|e| AeroError::other(format!("app scan task failed: {e}")))?
}

/// Resolve icons for a batch of launch targets. Returns
/// `target -> absolute PNG path` for every target that yielded an icon;
/// targets that fail are simply absent (frontend falls back to a glyph).
#[tauri::command]
pub async fn resolve_icons(
    app: AppHandle,
    targets: Vec<String>,
) -> AeroResult<HashMap<String, String>> {
    let cache_dir = app.path().app_data_dir()?.join("icons");
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = HashMap::with_capacity(targets.len());
        for target in targets {
            match crate::platform::windows::icons::ensure_icon(&target, &cache_dir) {
                Ok(path) => {
                    out.insert(target, path.to_string_lossy().to_string());
                }
                Err(e) => log::debug!("no icon for {target}: {e}"),
            }
        }
        out
    })
    .await
    .map_err(|e| AeroError::other(format!("icon task failed: {e}")))
}

/// Launch an app (or open a file/folder) through the shell, detached from
/// our process, with optional arguments and working directory.
#[tauri::command]
pub async fn launch(target: String, args: Option<String>) -> AeroResult<()> {
    tauri::async_runtime::spawn_blocking(move || launch_blocking(&target, args.as_deref()))
        .await
        .map_err(|e| AeroError::other(format!("launch task failed: {e}")))?
}

fn launch_blocking(target: &str, args: Option<&str>) -> AeroResult<()> {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    use crate::platform::windows::util::to_wide;

    let _com = crate::platform::ComApartment::new();
    let target_w = to_wide(target);
    let args_w = args.map(to_wide);
    let verb = to_wide("open");
    let workdir = std::path::Path::new(target)
        .parent()
        .map(|p| to_wide(&p.to_string_lossy()));

    let hinst = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(verb.as_ptr()),
            PCWSTR(target_w.as_ptr()),
            args_w.as_ref().map_or(PCWSTR::null(), |a| PCWSTR(a.as_ptr())),
            workdir.as_ref().map_or(PCWSTR::null(), |w| PCWSTR(w.as_ptr())),
            SW_SHOWNORMAL,
        )
    };
    // ShellExecuteW returns a value > 32 on success (legacy contract).
    if hinst.0 as isize <= 32 {
        return Err(AeroError::other(format!(
            "failed to launch {target} (code {})",
            hinst.0 as isize
        )));
    }
    Ok(())
}
