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

#[tauri::command]
pub fn export_settings(store: State<'_, SettingsStore>) -> AeroResult<String> {
    store.export_json()
}

#[tauri::command]
pub fn import_settings(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    json: String,
) -> AeroResult<Settings> {
    store.import_json(&app, &json)
}
