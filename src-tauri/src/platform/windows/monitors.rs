//! Monitor enumeration with work areas (the taskbar-free region) and
//! per-monitor DPI — the inputs dock positioning actually needs.

use serde::Serialize;
use windows::core::BOOL;
use windows::Win32::Foundation::{LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW,
};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};

use super::util::from_wide;
use crate::core::AeroResult;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl From<RECT> for Rect {
    fn from(r: RECT) -> Self {
        Self {
            x: r.left,
            y: r.top,
            width: r.right - r.left,
            height: r.bottom - r.top,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfoEx {
    /// Device name, e.g. `\\.\DISPLAY1`. Stable enough for settings.
    pub name: String,
    /// Full monitor bounds in physical pixels (virtual-desktop coords).
    pub bounds: Rect,
    /// Bounds minus taskbar/app bars, physical pixels.
    pub work_area: Rect,
    /// Effective scale factor (1.0 = 96 DPI).
    pub scale: f64,
    pub is_primary: bool,
}

/// Enumerate all monitors with their work areas and DPI.
pub fn enumerate_monitors() -> AeroResult<Vec<MonitorInfoEx>> {
    unsafe extern "system" fn callback(
        hmon: HMONITOR,
        _hdc: HDC,
        _rect: *mut RECT,
        lparam: LPARAM,
    ) -> BOOL {
        let monitors = unsafe { &mut *(lparam.0 as *mut Vec<MonitorInfoEx>) };
        let mut info = MONITORINFOEXW {
            monitorInfo: MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFOEXW>() as u32,
                ..Default::default()
            },
            ..Default::default()
        };
        if unsafe { GetMonitorInfoW(hmon, &mut info.monitorInfo) }.as_bool() {
            let mut dpi_x = 96u32;
            let mut dpi_y = 96u32;
            let _ = unsafe { GetDpiForMonitor(hmon, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) };
            monitors.push(MonitorInfoEx {
                name: from_wide(&info.szDevice),
                bounds: info.monitorInfo.rcMonitor.into(),
                work_area: info.monitorInfo.rcWork.into(),
                scale: dpi_x as f64 / 96.0,
                // MONITORINFOF_PRIMARY
                is_primary: info.monitorInfo.dwFlags & 1 != 0,
            });
        }
        BOOL(1)
    }

    let mut monitors: Vec<MonitorInfoEx> = Vec::new();
    let ok = unsafe {
        EnumDisplayMonitors(
            None,
            None,
            Some(callback),
            LPARAM(&mut monitors as *mut _ as isize),
        )
    };
    if !ok.as_bool() || monitors.is_empty() {
        return Err(crate::core::AeroError::other("no monitors found"));
    }
    Ok(monitors)
}

/// Find the monitor named in settings, falling back to primary.
pub fn pick_monitor<'a>(monitors: &'a [MonitorInfoEx], name: Option<&str>) -> &'a MonitorInfoEx {
    name.and_then(|n| monitors.iter().find(|m| m.name == n))
        .or_else(|| monitors.iter().find(|m| m.is_primary))
        .unwrap_or(&monitors[0])
}
