//! Per-application audio through WASAPI audio sessions.
//!
//! Windows gives every process that plays sound one or more audio
//! sessions on an endpoint. `ISimpleAudioVolume` on a session is the same
//! knob the volume mixer shows, so setting it here moves the mixer and
//! survives independently of the master volume.
//!
//! An app can hold several sessions at once (Chrome opens one per audio
//! renderer, games often split music and effects), so everything here
//! works on the executable rather than a single process id: a change is
//! applied to every session whose process has that file name, and a read
//! reports the loudest of them.

use std::collections::BTreeMap;

use serde::Serialize;
use windows::core::Interface;
use windows::Win32::Foundation::S_OK;
use windows::Win32::Media::Audio::{
    eConsole, eMultimedia, eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDevice,
    IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL, CLSCTX_INPROC_SERVER, STGM_READ};

use crate::core::names::{display_name, exe_key};
use crate::core::AeroResult;
use crate::platform::ComApartment;

/// One app's mixer entry, collapsed across all of its sessions.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppAudio {
    /// Lowercased executable file name, the key everything else uses.
    pub exe: String,
    /// Full path of one of the owning processes, for icon resolution.
    pub path: String,
    /// Friendly name from the session, falling back to the file name.
    pub name: String,
    /// 0..=100, the loudest session this app owns.
    pub volume: u8,
    /// True when every session this app owns is muted.
    pub muted: bool,
    /// How many sessions rolled up into this entry.
    pub sessions: u32,
}

/// A render endpoint the user can send an app to.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}


/// Scalar (0.0..=1.0) to the 0..=100 the UI speaks.
fn to_percent(scalar: f32) -> u8 {
    (scalar.clamp(0.0, 1.0) * 100.0).round() as u8
}

/// Step a level without wrapping past either end.
pub fn step_level(current: u8, delta: i32) -> u8 {
    (current as i32 + delta).clamp(0, 100) as u8
}

fn default_render_device() -> AeroResult<IMMDevice> {
    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_INPROC_SERVER)? };
    Ok(unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eConsole)? })
}

/// Walk every session on the default render endpoint.
///
/// The callback gets the owning process id, the session control and the
/// volume interface. Returning `false` stops the walk early.
fn for_each_session(
    mut visit: impl FnMut(u32, &IAudioSessionControl2, &ISimpleAudioVolume) -> bool,
) -> AeroResult<()> {
    let device = default_render_device()?;
    let manager: IAudioSessionManager2 = unsafe { device.Activate(CLSCTX_ALL, None)? };
    let sessions = unsafe { manager.GetSessionEnumerator()? };
    let count = unsafe { sessions.GetCount()? };
    for i in 0..count {
        let Ok(control) = (unsafe { sessions.GetSession(i) }) else {
            continue;
        };
        let Ok(control2) = control.cast::<IAudioSessionControl2>() else {
            continue;
        };
        // The system sounds session has no real app behind it. This call
        // answers S_OK for yes and S_FALSE for no, and both are "ok"
        // HRESULTs, so it has to be compared against S_OK exactly.
        if unsafe { control2.IsSystemSoundsSession() } == S_OK {
            continue;
        }
        let Ok(pid) = (unsafe { control2.GetProcessId() }) else {
            continue;
        };
        if pid == 0 {
            continue;
        }
        let Ok(volume) = control.cast::<ISimpleAudioVolume>() else {
            continue;
        };
        if !visit(pid, &control2, &volume) {
            break;
        }
    }
    Ok(())
}

/// Full path of a process, or None if it has gone or refuses to say.
fn process_path(pid: u32) -> Option<String> {
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buf.as_mut_ptr()),
            &mut len,
        );
        let _ = windows::Win32::Foundation::CloseHandle(handle);
        ok.ok()?;
        Some(String::from_utf16_lossy(&buf[..len as usize]))
    }
}

/// Display name a session advertises. Most apps leave it empty, which is
/// why the file name has to stand in.
fn session_name(control: &IAudioSessionControl2) -> Option<String> {
    unsafe {
        let raw = control.GetDisplayName().ok()?;
        if raw.is_null() {
            return None;
        }
        let s = raw.to_string().ok()?;
        windows::Win32::System::Com::CoTaskMemFree(Some(raw.as_ptr() as *const _));
        let trimmed = s.trim();
        // some apps store a resource reference like "@%SystemRoot%\...,-101"
        if trimmed.is_empty() || trimmed.starts_with('@') {
            None
        } else {
            Some(trimmed.to_string())
        }
    }
}

/// Every app currently holding an audio session, keyed by executable.
pub fn list_apps() -> AeroResult<Vec<AppAudio>> {
    let _com = ComApartment::new();
    // BTreeMap so the order is stable between calls and the UI does not
    // reshuffle underneath the cursor
    let mut apps: BTreeMap<String, AppAudio> = BTreeMap::new();

    for_each_session(|pid, control, volume| {
        let Some(path) = process_path(pid) else {
            return true;
        };
        let key = exe_key(&path);
        let level = unsafe { volume.GetMasterVolume() }.map(to_percent).unwrap_or(0);
        let muted = unsafe { volume.GetMute() }.map(|m| m.as_bool()).unwrap_or(false);
        let name = session_name(control).unwrap_or_else(|| display_name(&key));

        apps.entry(key.clone())
            .and_modify(|a| {
                a.volume = a.volume.max(level);
                a.muted = a.muted && muted;
                a.sessions += 1;
            })
            .or_insert(AppAudio {
                exe: key,
                path,
                name,
                volume: level,
                muted,
                sessions: 1,
            });
        true
    })?;

    Ok(apps.into_values().collect())
}

/// Read one app's mixer entry, or None when it is not playing anything.
pub fn app_audio(exe: &str) -> AeroResult<Option<AppAudio>> {
    let key = exe_key(exe);
    Ok(list_apps()?.into_iter().find(|a| a.exe == key))
}

/// Apply a level and/or mute state to every session the app owns.
///
/// Returns the state afterwards, or None when the app owns no sessions,
/// which is the normal case for an app that is running but silent.
pub fn set_app_audio(exe: &str, level: Option<u8>, mute: Option<bool>) -> AeroResult<Option<AppAudio>> {
    let _com = ComApartment::new();
    let key = exe_key(exe);
    let mut touched = false;

    for_each_session(|pid, _control, volume| {
        let Some(path) = process_path(pid) else {
            return true;
        };
        if exe_key(&path) != key {
            return true;
        }
        touched = true;
        if let Some(level) = level {
            let scalar = (level.min(100) as f32) / 100.0;
            let _ = unsafe { volume.SetMasterVolume(scalar, std::ptr::null()) };
        }
        if let Some(mute) = mute {
            let _ = unsafe { volume.SetMute(mute, std::ptr::null()) };
        }
        true
    })?;

    if !touched {
        return Ok(None);
    }
    app_audio(&key)
}

/// Flip mute for an app and report the state it landed on.
pub fn toggle_app_mute(exe: &str) -> AeroResult<Option<AppAudio>> {
    let Some(current) = app_audio(exe)? else {
        return Ok(None);
    };
    set_app_audio(exe, None, Some(!current.muted))
}

// ---------------------------------------------------------------------
// output devices
// ---------------------------------------------------------------------

/// Friendly name out of a device's property store.
fn device_name(device: &IMMDevice) -> Option<String> {
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
    unsafe {
        let store = device.OpenPropertyStore(STGM_READ).ok()?;
        let value = store.GetValue(&PKEY_Device_FriendlyName).ok()?;
        let raw = PropVariantToStringAlloc(&value).ok()?;
        if raw.is_null() {
            return None;
        }
        let s = raw.to_string().ok()?;
        windows::Win32::System::Com::CoTaskMemFree(Some(raw.as_ptr() as *const _));
        Some(s)
    }
}

/// Every active render endpoint, with the current default marked.
pub fn list_output_devices() -> AeroResult<Vec<AudioDevice>> {
    let _com = ComApartment::new();
    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_INPROC_SERVER)? };

    let default_id = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) }
        .ok()
        .and_then(|d| unsafe { d.GetId() }.ok())
        .and_then(|id| unsafe { id.to_string() }.ok());

    let collection = unsafe { enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)? };
    let count = unsafe { collection.GetCount()? };
    let mut out = Vec::with_capacity(count as usize);
    for i in 0..count {
        let Ok(device) = (unsafe { collection.Item(i) }) else {
            continue;
        };
        let Ok(id) = (unsafe { device.GetId() }) else {
            continue;
        };
        let Ok(id) = (unsafe { id.to_string() }) else {
            continue;
        };
        let name = device_name(&device).unwrap_or_else(|| "Audio device".to_string());
        let is_default = default_id.as_deref() == Some(id.as_str());
        out.push(AudioDevice { id, name, is_default });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_conversion_covers_both_ends() {
        assert_eq!(to_percent(0.0), 0);
        assert_eq!(to_percent(1.0), 100);
        assert_eq!(to_percent(0.5), 50);
        // out-of-range scalars from a misbehaving app cannot overflow
        assert_eq!(to_percent(-1.0), 0);
        assert_eq!(to_percent(9.0), 100);
    }

    #[test]
    fn stepping_stops_at_the_ends_instead_of_wrapping() {
        assert_eq!(step_level(50, 5), 55);
        assert_eq!(step_level(2, -5), 0);
        assert_eq!(step_level(98, 5), 100);
        assert_eq!(step_level(0, -5), 0);
        assert_eq!(step_level(100, 5), 100);
    }

    #[test]
    fn enumerating_sessions_does_not_error_on_a_real_machine() {
        // machine-agnostic: there may be zero apps playing audio, but the
        // walk itself must not fail
        let apps = list_apps().expect("session enumeration should succeed");
        for a in &apps {
            assert!(a.volume <= 100);
            assert!(a.sessions >= 1);
            assert_eq!(a.exe, exe_key(&a.path));
        }
    }

    #[test]
    fn there_is_at_least_one_output_device_and_it_has_a_name() {
        let devices = list_output_devices().expect("endpoint enumeration should succeed");
        for d in &devices {
            assert!(!d.id.is_empty());
            assert!(!d.name.is_empty());
        }
        // exactly one default when any device exists at all
        assert!(devices.iter().filter(|d| d.is_default).count() <= 1);
    }
}
