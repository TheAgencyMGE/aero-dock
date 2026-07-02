//! System status for the dock widgets: battery, network connectivity,
//! master volume (WASAPI), and Recycle Bin. Read in one call; a small
//! poller thread pushes changes to the frontend every 20s (plus an
//! immediate push after volume changes made through us).

use serde::Serialize;
use windows::core::PCWSTR;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::Networking::NetworkListManager::{
    INetworkListManager, NetworkListManager, NLM_CONNECTIVITY_IPV4_INTERNET,
    NLM_CONNECTIVITY_IPV6_INTERNET,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL, CLSCTX_INPROC_SERVER};
use windows::Win32::System::Power::GetSystemPowerStatus;
use windows::Win32::UI::Shell::{SHEmptyRecycleBinW, SHQueryRecycleBinW, SHQUERYRBINFO};

use crate::core::AeroResult;
use crate::platform::ComApartment;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BatteryStatus {
    pub present: bool,
    pub percent: u8,
    pub charging: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VolumeStatus {
    pub available: bool,
    /// 0..=100
    pub level: u8,
    pub muted: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecycleBinStatus {
    pub items: u64,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatus {
    pub battery: BatteryStatus,
    pub internet: bool,
    pub volume: VolumeStatus,
    pub recycle_bin: RecycleBinStatus,
}

pub fn read_status() -> SystemStatus {
    let _com = ComApartment::new();
    SystemStatus {
        battery: read_battery(),
        internet: read_internet().unwrap_or(false),
        volume: read_volume().unwrap_or_default(),
        recycle_bin: read_recycle_bin().unwrap_or_default(),
    }
}

fn read_battery() -> BatteryStatus {
    let mut status = Default::default();
    if unsafe { GetSystemPowerStatus(&mut status) }.is_err() {
        return BatteryStatus::default();
    }
    // 128 = no system battery, 255 = unknown
    let present = status.BatteryFlag != 128 && status.BatteryLifePercent != 255;
    BatteryStatus {
        present,
        percent: if present { status.BatteryLifePercent } else { 0 },
        charging: status.ACLineStatus == 1,
    }
}

fn read_internet() -> AeroResult<bool> {
    let manager: INetworkListManager =
        unsafe { CoCreateInstance(&NetworkListManager, None, CLSCTX_ALL)? };
    let connectivity = unsafe { manager.GetConnectivity()? };
    let internet =
        (connectivity.0 & (NLM_CONNECTIVITY_IPV4_INTERNET.0 | NLM_CONNECTIVITY_IPV6_INTERNET.0))
            != 0;
    Ok(internet)
}

fn endpoint_volume() -> AeroResult<IAudioEndpointVolume> {
    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_INPROC_SERVER)? };
    let device = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eConsole)? };
    let volume: IAudioEndpointVolume = unsafe { device.Activate(CLSCTX_INPROC_SERVER, None)? };
    Ok(volume)
}

fn read_volume() -> AeroResult<VolumeStatus> {
    let volume = endpoint_volume()?;
    let level = unsafe { volume.GetMasterVolumeLevelScalar()? };
    let muted = unsafe { volume.GetMute()? }.as_bool();
    Ok(VolumeStatus {
        available: true,
        level: (level * 100.0).round() as u8,
        muted,
    })
}

/// Set master volume 0..=100; `mute` of None leaves mute state alone.
pub fn set_volume(level: Option<u8>, mute: Option<bool>) -> AeroResult<()> {
    let _com = ComApartment::new();
    let volume = endpoint_volume()?;
    if let Some(level) = level {
        let scalar = (level.min(100) as f32) / 100.0;
        unsafe { volume.SetMasterVolumeLevelScalar(scalar, std::ptr::null())? };
    }
    if let Some(mute) = mute {
        unsafe { volume.SetMute(mute, std::ptr::null())? };
    }
    Ok(())
}

fn read_recycle_bin() -> AeroResult<RecycleBinStatus> {
    let mut info = SHQUERYRBINFO {
        cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32,
        ..Default::default()
    };
    unsafe { SHQueryRecycleBinW(PCWSTR::null(), &mut info)? };
    Ok(RecycleBinStatus {
        items: info.i64NumItems as u64,
        bytes: info.i64Size as u64,
    })
}

/// Empty the bin with the standard system confirmation dialog.
pub fn empty_recycle_bin() -> AeroResult<()> {
    let _com = ComApartment::new();
    unsafe { SHEmptyRecycleBinW(None, PCWSTR::null(), 0)? };
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_reads_without_error() {
        let s = read_status();
        // machine-agnostic invariants only
        assert!(s.volume.level <= 100);
        assert!(!s.battery.present || s.battery.percent <= 100);
    }
}
