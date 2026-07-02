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
                Err(e) => eprintln!("[icons] no icon for {target}: {e}"),
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

fn shell_execute(verb: &str, target: &str, args: Option<&str>) -> AeroResult<()> {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    use crate::platform::windows::util::to_wide;

    let _com = crate::platform::ComApartment::new();
    let target_w = to_wide(target);
    let args_w = args.map(to_wide);
    let verb_w = to_wide(verb);
    let workdir = std::path::Path::new(target)
        .parent()
        .map(|p| to_wide(&p.to_string_lossy()));

    let hinst = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(verb_w.as_ptr()),
            PCWSTR(target_w.as_ptr()),
            args_w.as_ref().map_or(PCWSTR::null(), |a| PCWSTR(a.as_ptr())),
            workdir.as_ref().map_or(PCWSTR::null(), |w| PCWSTR(w.as_ptr())),
            SW_SHOWNORMAL,
        )
    };
    // ShellExecuteW returns a value > 32 on success (legacy contract).
    if hinst.0 as isize <= 32 {
        return Err(AeroError::other(format!(
            "shell {verb} failed for {target} (code {})",
            hinst.0 as isize
        )));
    }
    Ok(())
}

fn launch_blocking(target: &str, args: Option<&str>) -> AeroResult<()> {
    shell_execute("open", target, args)
}

/// Launch elevated (UAC prompt) — the "Run as administrator" menu action.
#[tauri::command]
pub async fn launch_as_admin(target: String, args: Option<String>) -> AeroResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        shell_execute("runas", &target, args.as_deref())
    })
    .await
    .map_err(|e| AeroError::other(format!("launch task failed: {e}")))?
}

/// Open Explorer with the target file selected.
#[tauri::command]
pub async fn open_file_location(target: String) -> AeroResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        if !std::path::Path::new(&target).exists() {
            return Err(AeroError::other(format!("path not found: {target}")));
        }
        std::process::Command::new("explorer.exe")
            .arg(format!("/select,{target}"))
            .spawn()
            .map_err(AeroError::Io)?;
        Ok(())
    })
    .await
    .map_err(|e| AeroError::other(format!("explorer task failed: {e}")))?
}

/// Resolve a dropped file into a pinnable (name, target) pair.
/// `.lnk` shortcuts are dereferenced; anything else pins as itself.
#[tauri::command]
pub async fn resolve_drop(path: String) -> AeroResult<AppEntry> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::platform::windows::apps::resolve_single(&path)
    })
    .await
    .map_err(|e| AeroError::other(format!("resolve task failed: {e}")))?
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// List a pinned folder's contents for the flyout grid: directories
/// first, then files, alphabetical, hidden/system files skipped.
#[tauri::command]
pub async fn list_folder(path: String, limit: Option<usize>) -> AeroResult<Vec<FolderEntry>> {
    tauri::async_runtime::spawn_blocking(move || {
        let limit = limit.unwrap_or(30);
        let mut entries: Vec<FolderEntry> = Vec::new();
        for entry in std::fs::read_dir(&path)?.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name.eq_ignore_ascii_case("desktop.ini") {
                continue;
            }
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            entries.push(FolderEntry {
                name,
                path: entry.path().to_string_lossy().to_string(),
                is_dir,
            });
        }
        entries.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        entries.truncate(limit);
        Ok(entries)
    })
    .await
    .map_err(|e| AeroError::other(format!("folder list task failed: {e}")))?
}
