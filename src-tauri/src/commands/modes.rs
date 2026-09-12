//! Dock Modes: pins, window layout and per-app audio, switched together.
//!
//! A mode is stored whole in settings. Switching writes the outgoing
//! mode's pins back, loads the incoming ones into `Settings::pinned`
//! (which is what the dock renders and what every existing pin command
//! already edits), then applies the mode's audio and, optionally, its
//! window layout.

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::core::names::exe_key;
use crate::core::settings::{DockMode, Settings, SettingsStore};
use crate::core::workspace::WorkspaceSnapshot;
use crate::core::AeroResult;
use crate::platform::windows::{appaudio, workspace};

/// What a switch actually managed to do, so the dock can say so.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchReport {
    pub mode_id: String,
    pub mode_name: String,
    /// Apps whose volume/mute was put back.
    pub audio_applied: u32,
    /// Windows moved back into place.
    pub windows_moved: u32,
    /// Apps relaunched because they were closed.
    pub apps_launched: u32,
    pub settings: Settings,
}

fn new_id() -> String {
    // monotonic enough for an id nobody types: the clock plus a counter
    // that survives two modes being made inside the same millisecond
    use std::sync::atomic::{AtomicU32, Ordering};
    static SEQ: AtomicU32 = AtomicU32::new(0);
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("mode-{millis:x}-{:x}", SEQ.fetch_add(1, Ordering::Relaxed))
}

/// Push a mode's remembered audio onto the live sessions.
/// Apps that are closed or silent are skipped without complaint.
fn apply_audio(mode: &DockMode) -> u32 {
    let mut applied = 0;
    for pref in &mode.audio {
        match appaudio::set_app_audio(&pref.exe, Some(pref.volume), Some(pref.muted)) {
            Ok(Some(_)) => applied += 1,
            Ok(None) => {}
            Err(e) => log::warn!("mode audio for {} failed: {e}", pref.exe),
        }
    }
    applied
}

/// Turn Modes on, seeding the first mode from the dock as it stands.
#[tauri::command]
pub fn enable_modes(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    enabled: bool,
) -> AeroResult<Settings> {
    store.update(&app, |s| {
        if enabled {
            s.enable_modes_with_default(new_id(), "Everyday".into());
        } else {
            // keep the mode list, just stop using it, and leave the dock
            // showing whatever is pinned right now
            s.sync_pins_into_active_mode();
            s.modes.enabled = false;
        }
    })
}

/// Add a mode. It starts with the pins currently on the dock when
/// `copy_current_pins` is set, otherwise empty.
#[tauri::command]
pub fn create_mode(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    name: String,
    glyph: Option<String>,
    copy_current_pins: bool,
) -> AeroResult<Settings> {
    store.update(&app, |s| {
        let pinned = if copy_current_pins {
            s.pinned.clone()
        } else {
            Vec::new()
        };
        s.modes.modes.push(DockMode {
            id: new_id(),
            name: name.trim().to_string(),
            glyph: glyph.unwrap_or_default(),
            pinned,
            ..DockMode::default()
        });
        s.modes.enabled = true;
    })
}

#[tauri::command]
pub fn rename_mode(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    id: String,
    name: String,
    glyph: Option<String>,
) -> AeroResult<Settings> {
    store.update(&app, |s| {
        if let Some(mode) = s.modes.modes.iter_mut().find(|m| m.id == id) {
            mode.name = name.trim().to_string();
            if let Some(glyph) = glyph {
                mode.glyph = glyph;
            }
        }
    })
}

/// Remove a mode. Deleting the active one falls back to the first that
/// is left, and its pins become the dock so it never ends up empty.
#[tauri::command]
pub fn delete_mode(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    id: String,
) -> AeroResult<Settings> {
    store.update(&app, |s| {
        let was_active = s.modes.active_id == id;
        s.modes.modes.retain(|m| m.id != id);
        if was_active {
            if let Some(first) = s.modes.modes.first().cloned() {
                s.modes.active_id = first.id;
                s.pinned = first.pinned;
            } else {
                // nothing left to be in; sanitize turns Modes off and the
                // dock keeps the pins it is already showing
                s.modes.active_id.clear();
            }
        }
    })
}

/// Switch to a mode and put everything it remembers back.
#[tauri::command]
pub async fn switch_mode(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    id: String,
) -> AeroResult<SwitchReport> {
    let before = store.get();
    if !before.modes.modes.iter().any(|m| m.id == id) {
        return Err(crate::core::AeroError::other(format!("no mode {id}")));
    }

    let settings = store.update(&app, |s| {
        s.switch_mode(&id);
    })?;

    let Some(mode) = settings.active_mode().cloned() else {
        return Ok(SwitchReport {
            mode_id: id,
            settings,
            ..SwitchReport::default()
        });
    };

    let restore_windows = settings.modes.restore_workspace_on_switch && !mode.workspace.is_empty();
    let mode_for_task = mode.clone();
    let report = tauri::async_runtime::spawn_blocking(move || {
        let _com = crate::platform::ComApartment::new();
        let audio_applied = apply_audio(&mode_for_task);
        let (moved, launched) = if restore_windows {
            let r = workspace::restore(&mode_for_task.workspace, |target| {
                crate::commands::apps::launch_target(target)
            });
            (r.moved, r.launched)
        } else {
            (0, 0)
        };
        (audio_applied, moved, launched)
    })
    .await
    .map_err(|e| crate::core::AeroError::other(format!("mode switch task failed: {e}")))?;

    Ok(SwitchReport {
        mode_id: mode.id,
        mode_name: mode.name,
        audio_applied: report.0,
        windows_moved: report.1,
        apps_launched: report.2,
        settings,
    })
}

/// Save the current desktop into a mode (the active one by default).
#[tauri::command]
pub async fn capture_workspace(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    mode_id: Option<String>,
) -> AeroResult<Settings> {
    let snapshot: WorkspaceSnapshot =
        tauri::async_runtime::spawn_blocking(workspace::capture)
            .await
            .map_err(|e| crate::core::AeroError::other(format!("capture failed: {e}")))?;

    let target = mode_id.unwrap_or_else(|| store.get().modes.active_id.clone());
    store.update(&app, |s| {
        if let Some(mode) = s.modes.modes.iter_mut().find(|m| m.id == target) {
            mode.workspace = snapshot.clone();
        }
    })
}

/// Put a saved desktop back without switching modes.
#[tauri::command]
pub async fn restore_workspace(
    store: State<'_, SettingsStore>,
    mode_id: Option<String>,
) -> AeroResult<workspace::RestoreReport> {
    let settings = store.get();
    let target = mode_id.unwrap_or_else(|| settings.modes.active_id.clone());
    let Some(mode) = settings.modes.modes.iter().find(|m| m.id == target).cloned() else {
        return Err(crate::core::AeroError::other("that mode is gone"));
    };
    tauri::async_runtime::spawn_blocking(move || {
        let _com = crate::platform::ComApartment::new();
        workspace::restore(&mode.workspace, crate::commands::apps::launch_target)
    })
    .await
    .map_err(|e| crate::core::AeroError::other(format!("restore task failed: {e}")))
}

/// Forget a mode's saved desktop.
#[tauri::command]
pub fn clear_workspace(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    mode_id: String,
) -> AeroResult<Settings> {
    store.update(&app, |s| {
        if let Some(mode) = s.modes.modes.iter_mut().find(|m| m.id == mode_id) {
            mode.workspace = WorkspaceSnapshot::default();
        }
    })
}

/// Set which apps pull a mode to the front when they get focus.
#[tauri::command]
pub fn set_mode_apps(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    mode_id: String,
    apps: Vec<String>,
) -> AeroResult<Settings> {
    store.update(&app, |s| {
        if let Some(mode) = s.modes.modes.iter_mut().find(|m| m.id == mode_id) {
            mode.auto_switch_apps = apps.iter().map(|a| exe_key(a)).collect();
        }
    })
}

/// Master switch for following the foreground app.
#[tauri::command]
pub fn set_auto_switch(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    enabled: bool,
) -> AeroResult<Settings> {
    store.update(&app, |s| s.modes.auto_switch = enabled)
}

/// Whether switching also puts windows back.
#[tauri::command]
pub fn set_restore_workspace_on_switch(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    enabled: bool,
) -> AeroResult<Settings> {
    store.update(&app, |s| s.modes.restore_workspace_on_switch = enabled)
}

/// Called when the foreground app changes. Returns the mode it switched
/// to, or null when nothing needed to happen.
///
/// The decision lives in settings so the frontend never has to reproduce
/// the matching rules, and a switch is only reported when it changes the
/// active mode.
#[tauri::command]
pub async fn foreground_changed(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    exe: String,
) -> AeroResult<Option<SwitchReport>> {
    let Some(target) = store.get().mode_claiming(&exe).map(|m| m.id.clone()) else {
        return Ok(None);
    };
    // an auto switch never yanks windows around; that would fight the app
    // the user just clicked on
    let settings = store.update(&app, |s| {
        s.switch_mode(&target);
    })?;
    let Some(mode) = settings.active_mode().cloned() else {
        return Ok(None);
    };
    let mode_for_task = mode.clone();
    let audio_applied = tauri::async_runtime::spawn_blocking(move || {
        let _com = crate::platform::ComApartment::new();
        apply_audio(&mode_for_task)
    })
    .await
    .map_err(|e| crate::core::AeroError::other(format!("auto switch failed: {e}")))?;

    Ok(Some(SwitchReport {
        mode_id: mode.id,
        mode_name: mode.name,
        audio_applied,
        windows_moved: 0,
        apps_launched: 0,
        settings,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn generated_ids_are_unique_even_back_to_back() {
        let ids: HashSet<String> = (0..200).map(|_| new_id()).collect();
        assert_eq!(ids.len(), 200, "two modes made at once must not collide");
    }

    #[test]
    fn generated_ids_survive_sanitize_untouched() {
        let mut s = Settings::default();
        let id = new_id();
        s.modes.modes.push(DockMode {
            id: id.clone(),
            ..DockMode::default()
        });
        s.modes.enabled = true;
        s.modes.active_id = id.clone();
        let s: Settings = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert_eq!(s.modes.modes[0].id, id, "a valid id must not be rewritten");
        assert_eq!(s.modes.active_id, id);
    }
}
