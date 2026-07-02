//! Settings IPC surface. The frontend reads the full struct, sends whole-
//! struct updates, and listens for `settings://changed` to re-render.

use tauri::{AppHandle, State};

use crate::core::settings::{PinnedItem, Settings, SettingsStore};
use crate::core::AeroResult;

#[tauri::command]
pub fn get_settings(store: State<'_, SettingsStore>) -> Settings {
    store.get()
}

/// Replace the settings with a new struct (the frontend always sends the
/// complete state; sanitization clamps anything out of range).
#[tauri::command]
pub fn set_settings(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    settings: Settings,
) -> AeroResult<Settings> {
    store.replace(&app, settings)
}

#[tauri::command]
pub fn pin_item(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    item: PinnedItem,
    index: Option<usize>,
) -> AeroResult<Settings> {
    store.update(&app, |s| {
        s.pinned.retain(|p| p.id != item.id);
        let at = index.unwrap_or(s.pinned.len()).min(s.pinned.len());
        s.pinned.insert(at, item);
    })
}

#[tauri::command]
pub fn unpin_item(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    id: String,
) -> AeroResult<Settings> {
    store.update(&app, |s| {
        s.pinned.retain(|p| p.id != id);
        for p in &mut s.pinned {
            p.children.retain(|c| c.id != id);
        }
    })
}

/// Reorder pinned items to match the given id sequence (drag-and-drop).
#[tauri::command]
pub fn reorder_pinned(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    ids: Vec<String>,
) -> AeroResult<Settings> {
    store.update(&app, |s| {
        s.pinned.sort_by_key(|p| {
            ids.iter().position(|id| *id == p.id).unwrap_or(usize::MAX)
        });
    })
}

/// Atomic first-run import: pins the starter set and marks onboarding
/// complete in one settings transaction. Safe to call any number of
/// times (React StrictMode double-fires effects in dev) — only the
/// first call through the lock does anything.
#[tauri::command]
pub fn first_run_import(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    items: Vec<PinnedItem>,
) -> AeroResult<Settings> {
    store.update(&app, |s| {
        if !s.onboarding_complete && s.pinned.is_empty() {
            s.pinned = items;
            s.onboarding_complete = true;
        }
    })
}

#[tauri::command]
pub fn export_settings(store: State<'_, SettingsStore>) -> AeroResult<String> {
    store.export_json()
}

/// Write settings JSON to the user's Downloads folder; returns the path.
#[tauri::command]
pub fn export_settings_file(app: AppHandle, store: State<'_, SettingsStore>) -> AeroResult<String> {
    use tauri::Manager;
    let dir = app.path().download_dir()?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let path = dir.join(format!("aero-dock-settings-{stamp}.json"));
    std::fs::write(&path, store.export_json()?)?;
    Ok(path.to_string_lossy().to_string())
}

/// Open (or focus) the settings window. Async on purpose: building a
/// WebView2 inside a sync command deadlocks on Windows (the command
/// blocks the main thread the webview needs for creation).
#[tauri::command]
pub async fn open_settings(app: AppHandle) -> AeroResult<()> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("settings") {
        w.show()?;
        w.set_focus()?;
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        "settings",
        tauri::WebviewUrl::App("index.html?window=settings".into()),
    )
    .title("Aero Dock Settings")
    .inner_size(820.0, 640.0)
    .min_inner_size(660.0, 500.0)
    .build()?;
    Ok(())
}

#[tauri::command]
pub fn import_settings(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    json: String,
) -> AeroResult<Settings> {
    store.import_json(&app, &json)
}
