//! System widgets IPC + the status poller thread.

use tauri::{AppHandle, Emitter};

use crate::core::{AeroError, AeroResult};
use crate::platform::windows::system;

pub const SYSTEM_EVENT: &str = "system://status";
const POLL_SECS: u64 = 20;

#[tauri::command]
pub async fn get_system_status() -> AeroResult<system::SystemStatus> {
    tauri::async_runtime::spawn_blocking(system::read_status)
        .await
        .map_err(|e| AeroError::other(format!("status task failed: {e}")))
}

#[tauri::command]
pub async fn set_volume(
    app: AppHandle,
    level: Option<u8>,
    mute: Option<bool>,
) -> AeroResult<()> {
    tauri::async_runtime::spawn_blocking(move || -> AeroResult<()> {
        system::set_volume(level, mute)?;
        // push the fresh state right away so the widget doesn't lag
        let status = system::read_status();
        let _ = app.emit(SYSTEM_EVENT, &status);
        Ok(())
    })
    .await
    .map_err(|e| AeroError::other(format!("volume task failed: {e}")))?
}

#[tauri::command]
pub async fn open_recycle_bin() -> AeroResult<()> {
    tauri::async_runtime::spawn_blocking(|| {
        std::process::Command::new("explorer.exe")
            .arg("shell:RecycleBinFolder")
            .spawn()
            .map(|_| ())
            .map_err(AeroError::Io)
    })
    .await
    .map_err(|e| AeroError::other(format!("open bin task failed: {e}")))?
}

#[tauri::command]
pub async fn empty_recycle_bin(app: AppHandle) -> AeroResult<()> {
    tauri::async_runtime::spawn_blocking(move || -> AeroResult<()> {
        system::empty_recycle_bin()?;
        let status = system::read_status();
        let _ = app.emit(SYSTEM_EVENT, &status);
        Ok(())
    })
    .await
    .map_err(|e| AeroError::other(format!("empty bin task failed: {e}")))?
}

/// Current wallpaper's dominant vibrant color as `#rrggbb`.
#[tauri::command]
pub async fn get_wallpaper_accent() -> AeroResult<String> {
    tauri::async_runtime::spawn_blocking(crate::platform::windows::wallpaper::wallpaper_accent)
        .await
        .map_err(|e| AeroError::other(format!("wallpaper task failed: {e}")))?
}

/// Background poller: pushes system status every POLL_SECS while the
/// app runs. Cheap reads; skipped entirely when the dock is hidden
/// would be an over-optimization at this cadence.
pub fn start_poller(app: AppHandle) {
    std::thread::Builder::new()
        .name("aero-system-poll".into())
        .spawn(move || loop {
            let status = system::read_status();
            if app.emit(SYSTEM_EVENT, &status).is_err() {
                return; // app shutting down
            }
            std::thread::sleep(std::time::Duration::from_secs(POLL_SECS));
        })
        .expect("spawn system poller");
}
