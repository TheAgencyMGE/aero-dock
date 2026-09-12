//! Per-application audio IPC.
//!
//! Every write goes two places: the live WASAPI session, so it takes
//! effect immediately, and the active mode, so it comes back the next
//! time that mode is switched on. Reads come from the session, because
//! the user can always move the same slider in the Windows mixer and the
//! dock should show the truth rather than its own last opinion.

use tauri::{AppHandle, State};

use crate::core::names::exe_key;
use crate::core::settings::{AppAudioPref, SettingsStore};
use crate::core::AeroResult;
use crate::platform::windows::appaudio::{self, AppAudio, AudioDevice};

/// How far one wheel notch moves an app's volume.
pub const SCROLL_STEP: i32 = 4;

/// Everything currently holding an audio session.
#[tauri::command]
pub async fn list_app_audio() -> AeroResult<Vec<AppAudio>> {
    tauri::async_runtime::spawn_blocking(appaudio::list_apps)
        .await
        .map_err(|e| crate::core::AeroError::other(format!("audio task failed: {e}")))?
}

/// One app's mixer entry, or null when it is not playing anything.
#[tauri::command]
pub async fn get_app_audio(exe: String) -> AeroResult<Option<AppAudio>> {
    tauri::async_runtime::spawn_blocking(move || appaudio::app_audio(&exe))
        .await
        .map_err(|e| crate::core::AeroError::other(format!("audio task failed: {e}")))?
}

/// Write the state we just applied into the active mode so it survives a
/// switch. Silently does nothing when Modes is off, which is the whole
/// point: per-app volume still works without ever touching Modes.
fn remember(
    app: &AppHandle,
    store: &SettingsStore,
    exe: &str,
    state: &AppAudio,
) -> AeroResult<()> {
    let has_active = store.get().active_mode().is_some();
    if !has_active {
        return Ok(());
    }
    let key = exe_key(exe);
    store.update(app, |s| {
        // carry any device choice already recorded for this app
        let device_id = s
            .active_mode()
            .and_then(|m| m.audio_for(&key))
            .and_then(|p| p.device_id.clone());
        if let Some(mode) = s.modes.modes.iter_mut().find(|m| m.id == s.modes.active_id) {
            mode.set_audio(AppAudioPref {
                exe: key.clone(),
                volume: state.volume,
                muted: state.muted,
                device_id,
            });
        }
    })?;
    Ok(())
}

/// Set an app's volume and/or mute outright.
#[tauri::command]
pub async fn set_app_audio(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    exe: String,
    level: Option<u8>,
    mute: Option<bool>,
) -> AeroResult<Option<AppAudio>> {
    let target = exe.clone();
    let applied = tauri::async_runtime::spawn_blocking(move || {
        appaudio::set_app_audio(&target, level, mute)
    })
    .await
    .map_err(|e| crate::core::AeroError::other(format!("audio task failed: {e}")))??;

    if let Some(state) = &applied {
        remember(&app, &store, &exe, state)?;
    }
    Ok(applied)
}

/// Move an app's volume by whole wheel notches. Positive scrolls up.
///
/// The step is applied here rather than in the frontend so a burst of
/// wheel events cannot race each other into a stale starting value.
#[tauri::command]
pub async fn nudge_app_volume(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    exe: String,
    notches: i32,
) -> AeroResult<Option<AppAudio>> {
    let target = exe.clone();
    let applied = tauri::async_runtime::spawn_blocking(move || {
        let Some(current) = appaudio::app_audio(&target)? else {
            return Ok(None);
        };
        let next = appaudio::step_level(current.volume, notches * SCROLL_STEP);
        // scrolling up off a muted app is meant to bring it back
        let unmute = (notches > 0 && current.muted).then_some(false);
        appaudio::set_app_audio(&target, Some(next), unmute)
    })
    .await
    .map_err(|e| crate::core::AeroError::other(format!("audio task failed: {e}")))??;

    if let Some(state) = &applied {
        remember(&app, &store, &exe, state)?;
    }
    Ok(applied)
}

/// Flip an app between muted and not.
#[tauri::command]
pub async fn toggle_app_mute(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    exe: String,
) -> AeroResult<Option<AppAudio>> {
    let target = exe.clone();
    let applied = tauri::async_runtime::spawn_blocking(move || appaudio::toggle_app_mute(&target))
        .await
        .map_err(|e| crate::core::AeroError::other(format!("audio task failed: {e}")))??;

    if let Some(state) = &applied {
        remember(&app, &store, &exe, state)?;
    }
    Ok(applied)
}

/// Output endpoints an app can be sent to.
#[tauri::command]
pub async fn list_audio_devices() -> AeroResult<Vec<AudioDevice>> {
    tauri::async_runtime::spawn_blocking(appaudio::list_output_devices)
        .await
        .map_err(|e| crate::core::AeroError::other(format!("audio task failed: {e}")))?
}

/// Record which output an app should use, and hand the user off to the
/// Windows page that actually performs the routing.
///
/// Windows has no public API for per-application endpoint routing. The
/// choice is stored on the mode so the dock can show it and carry it
/// between modes, and `opened_settings` tells the caller whether it also
/// opened the system page where the switch is made.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputChoice {
    pub exe: String,
    pub device_id: Option<String>,
    pub opened_settings: bool,
}

#[tauri::command]
pub async fn set_app_output_device(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    exe: String,
    device_id: Option<String>,
    open_settings: bool,
) -> AeroResult<OutputChoice> {
    let key = exe_key(&exe);

    if store.get().active_mode().is_some() {
        let live = {
            let target = key.clone();
            tauri::async_runtime::spawn_blocking(move || appaudio::app_audio(&target))
                .await
                .map_err(|e| crate::core::AeroError::other(format!("audio task failed: {e}")))??
        };
        let device = device_id.clone();
        store.update(&app, |s| {
            let previous = s.active_mode().and_then(|m| m.audio_for(&key)).cloned();
            let volume = live
                .as_ref()
                .map(|a| a.volume)
                .or_else(|| previous.as_ref().map(|p| p.volume))
                .unwrap_or(100);
            let muted = live
                .as_ref()
                .map(|a| a.muted)
                .or_else(|| previous.as_ref().map(|p| p.muted))
                .unwrap_or(false);
            if let Some(mode) = s.modes.modes.iter_mut().find(|m| m.id == s.modes.active_id) {
                mode.set_audio(AppAudioPref {
                    exe: key.clone(),
                    volume,
                    muted,
                    device_id: device.clone(),
                });
            }
        })?;
    }

    let mut opened = false;
    if open_settings {
        // the per-app output picker lives here, and this is the only
        // supported way to reach it
        opened = crate::commands::apps::open_shell_uri("ms-settings:apps-volume").is_ok();
    }

    Ok(OutputChoice {
        exe: exe_key(&exe),
        device_id,
        opened_settings: opened,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_notch_moves_the_volume_by_the_documented_step() {
        assert_eq!(appaudio::step_level(50, SCROLL_STEP), 54);
        assert_eq!(appaudio::step_level(50, -SCROLL_STEP), 46);
    }

    #[test]
    fn several_notches_in_one_event_scale_together() {
        assert_eq!(appaudio::step_level(50, 3 * SCROLL_STEP), 62);
    }

    #[test]
    fn scrolling_never_leaves_the_zero_to_hundred_range() {
        assert_eq!(appaudio::step_level(1, -10 * SCROLL_STEP), 0);
        assert_eq!(appaudio::step_level(99, 10 * SCROLL_STEP), 100);
    }
}
