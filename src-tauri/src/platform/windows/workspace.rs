//! Capturing and applying workspace snapshots on Windows.
//!
//! The shape of a snapshot and the rules for matching and clamping live
//! in `core::workspace`; this file is only the Win32 half.
//!
//! Placement goes through `GetWindowPlacement` rather than
//! `GetWindowRect` because it reports the restored geometry even while a
//! window is maximized or minimized, which is the only way a snapshot can
//! round-trip a maximized window without losing the size it had before.
//!
//! Restoring is deliberately conservative. A window that is still open is
//! moved, never relaunched. An app that has closed is launched once and
//! given a short grace period to show a window. Anything whose monitor
//! has since disappeared is pulled back onto a screen that exists.

use std::collections::HashSet;

use serde::Serialize;
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, HMONITOR, MONITORINFO, MONITORINFOEXW,
    MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowPlacement, IsWindow, SetWindowPlacement, SHOW_WINDOW_CMD, SW_MAXIMIZE, SW_MINIMIZE,
    SW_SHOWNORMAL, WINDOWPLACEMENT, WINDOWPLACEMENT_FLAGS,
};

use super::util::from_wide;
use crate::core::names::exe_key;
use crate::core::workspace::{
    best_match, clamp_onto, SnapRect, WindowSnapshot, WindowState, WorkspaceSnapshot,
};
use crate::core::AeroResult;

/// How long a freshly launched app gets to put a window up before the
/// restore gives up on placing it. Anything slower keeps its own default
/// geometry, which beats blocking the dock for seconds.
const LAUNCH_GRACE_MS: u64 = 1600;

fn to_show_cmd(state: WindowState) -> u32 {
    match state {
        WindowState::Maximized => SW_MAXIMIZE.0 as u32,
        WindowState::Minimized => SW_MINIMIZE.0 as u32,
        WindowState::Normal => SW_SHOWNORMAL.0 as u32,
    }
}

fn from_show_cmd(cmd: u32) -> WindowState {
    match SHOW_WINDOW_CMD(cmd as i32) {
        SW_MAXIMIZE => WindowState::Maximized,
        SW_MINIMIZE => WindowState::Minimized,
        _ => WindowState::Normal,
    }
}

fn to_rect(r: SnapRect) -> RECT {
    RECT {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
    }
}

fn from_rect(r: RECT) -> SnapRect {
    SnapRect {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
    }
}

/// Device name of the monitor a window mostly sits on.
fn monitor_of(hwnd: HWND) -> String {
    unsafe {
        let hmon: HMONITOR = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFOEXW {
            monitorInfo: MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFOEXW>() as u32,
                ..Default::default()
            },
            ..Default::default()
        };
        if GetMonitorInfoW(hmon, &mut info.monitorInfo as *mut _).as_bool() {
            from_wide(&info.szDevice)
        } else {
            String::new()
        }
    }
}

/// Read a window's restored geometry and show state.
pub fn read_placement(hwnd: isize) -> Option<(SnapRect, WindowState)> {
    placement_of(HWND(hwnd as *mut _))
}

/// Apply a geometry and show state to a window. Returns false when the
/// window has gone or Windows refused the move.
pub fn apply_placement(hwnd: isize, rect: SnapRect, state: WindowState) -> bool {
    place(HWND(hwnd as *mut _), rect, state)
}

fn placement_of(hwnd: HWND) -> Option<(SnapRect, WindowState)> {
    unsafe {
        let mut wp = WINDOWPLACEMENT {
            length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
            ..Default::default()
        };
        GetWindowPlacement(hwnd, &mut wp).ok()?;
        Some((from_rect(wp.rcNormalPosition), from_show_cmd(wp.showCmd)))
    }
}

/// Snapshot every window the dock currently tracks.
pub fn capture() -> WorkspaceSnapshot {
    let live = super::running::snapshot();
    let mut windows = Vec::new();
    for w in live.windows {
        let hwnd = HWND(w.hwnd as *mut _);
        if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
            continue;
        }
        let Some((rect, state)) = placement_of(hwnd) else {
            continue;
        };
        windows.push(WindowSnapshot {
            exe: w.exe,
            title: w.title,
            aumid: w.aumid,
            monitor: monitor_of(hwnd),
            rect,
            state,
        });
    }
    WorkspaceSnapshot {
        windows,
        captured_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    }
}

/// What a restore actually managed to do.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    /// Windows that were already open and got moved.
    pub moved: u32,
    /// Apps that were not running and were launched.
    pub launched: u32,
    /// Entries nothing could be done about.
    pub missing: u32,
}

/// Current monitor work areas, plus the one to fall back to.
fn work_areas() -> (Vec<SnapRect>, SnapRect) {
    let monitors = super::monitors::enumerate_monitors().unwrap_or_default();
    let as_rect = |m: &super::monitors::MonitorInfoEx| SnapRect {
        left: m.work_area.x,
        top: m.work_area.y,
        right: m.work_area.x + m.work_area.width,
        bottom: m.work_area.y + m.work_area.height,
    };
    let areas: Vec<SnapRect> = monitors.iter().map(as_rect).collect();
    let fallback = monitors
        .iter()
        .find(|m| m.is_primary)
        .or_else(|| monitors.first())
        .map(as_rect)
        // no monitors at all should be impossible, but a restore must not
        // panic on the way to finding that out
        .unwrap_or(SnapRect {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1040,
        });
    (areas, fallback)
}

/// Apply a remembered geometry to a live window.
fn place(hwnd: HWND, rect: SnapRect, state: WindowState) -> bool {
    unsafe {
        if !IsWindow(Some(hwnd)).as_bool() {
            return false;
        }
        let wp = WINDOWPLACEMENT {
            length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
            flags: WINDOWPLACEMENT_FLAGS(0),
            showCmd: to_show_cmd(state),
            // -1 tells Windows to work these out itself rather than
            // restoring stale minimize/maximize anchors
            ptMinPosition: POINT { x: -1, y: -1 },
            ptMaxPosition: POINT { x: -1, y: -1 },
            rcNormalPosition: to_rect(rect),
        };
        SetWindowPlacement(hwnd, &wp).is_ok()
    }
}

/// Live windows as `(index, exe, title)` for the matcher.
fn candidates(live: &super::running::RunningSnapshot) -> Vec<(usize, String, String)> {
    live.windows
        .iter()
        .enumerate()
        .map(|(i, w)| (i, w.exe.clone(), w.title.clone()))
        .collect()
}

/// Put a snapshot back. Windows already open are moved; apps that are
/// gone are launched once and then placed when they show a window.
///
/// `launch` is injected so the command layer owns the actual shell call
/// and this module keeps no dependency on Tauri.
pub fn restore(
    snapshot: &WorkspaceSnapshot,
    launch: impl Fn(&str) -> AeroResult<()>,
) -> RestoreReport {
    let (areas, fallback) = work_areas();
    let mut report = RestoreReport::default();
    let mut used: HashSet<usize> = HashSet::new();
    let mut to_launch: Vec<&WindowSnapshot> = Vec::new();

    let live = super::running::snapshot();
    let live_candidates = candidates(&live);

    for snap in &snapshot.windows {
        match best_match(&snap.exe, &snap.title, &live_candidates, &used) {
            Some(idx) => {
                used.insert(idx);
                let hwnd = HWND(live.windows[idx].hwnd as *mut _);
                if place(hwnd, clamp_onto(snap.rect, &areas, fallback), snap.state) {
                    report.moved += 1;
                } else {
                    report.missing += 1;
                }
            }
            None => to_launch.push(snap),
        }
    }

    // one launch per executable, however many windows it owned
    let mut launched: HashSet<String> = HashSet::new();
    for snap in &to_launch {
        if !launched.insert(exe_key(&snap.exe)) {
            continue;
        }
        match launch(&snap.launch_target()) {
            Ok(()) => report.launched += 1,
            Err(e) => {
                log::warn!("workspace restore could not launch {}: {e}", snap.exe);
                report.missing += 1;
            }
        }
    }

    if report.launched > 0 {
        std::thread::sleep(std::time::Duration::from_millis(LAUNCH_GRACE_MS));
        let late = super::running::snapshot();
        let late_candidates = candidates(&late);
        let mut late_used: HashSet<usize> = HashSet::new();
        for snap in &to_launch {
            if let Some(idx) = best_match(&snap.exe, &snap.title, &late_candidates, &late_used) {
                late_used.insert(idx);
                let hwnd = HWND(late.windows[idx].hwnd as *mut _);
                place(hwnd, clamp_onto(snap.rect, &areas, fallback), snap.state);
            }
        }
    }

    report
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn show_state_round_trips_through_the_win32_constants() {
        for state in [
            WindowState::Normal,
            WindowState::Minimized,
            WindowState::Maximized,
        ] {
            assert_eq!(from_show_cmd(to_show_cmd(state)), state);
        }
    }

    #[test]
    fn rects_round_trip_through_win32() {
        let r = SnapRect {
            left: 10,
            top: 20,
            right: 810,
            bottom: 620,
        };
        assert_eq!(from_rect(to_rect(r)), r);
    }

    #[test]
    fn there_is_always_a_fallback_work_area() {
        let (_areas, fallback) = work_areas();
        assert!(fallback.width() > 0);
        assert!(fallback.height() > 0);
    }

    #[test]
    fn capturing_the_live_desktop_produces_consistent_entries() {
        let snap = capture();
        for w in &snap.windows {
            assert!(!w.exe.is_empty());
            // a captured rect is always a real rectangle
            assert!(w.rect.right >= w.rect.left);
            assert!(w.rect.bottom >= w.rect.top);
        }
        if !snap.is_empty() {
            assert!(snap.captured_at > 0);
        }
    }
}
