//! Dock window geometry. The frontend measures its content (which changes
//! with icon count, size, and magnification headroom) and asks Rust to fit
//! the OS window; Rust owns edge/monitor math so the window always lands
//! inside the target monitor's work area.

use parking_lot::Mutex;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};

use crate::core::settings::{DockEdge, SettingsStore};
use crate::core::{AeroError, AeroResult};
use crate::platform::windows::monitors::{enumerate_monitors, pick_monitor, MonitorInfoEx};

/// Last content size requested by the frontend, in logical pixels.
pub struct DockGeometry {
    content_size: Mutex<(f64, f64)>,
}

impl Default for DockGeometry {
    fn default() -> Self {
        Self {
            // sensible pre-first-measure footprint
            content_size: Mutex::new((720.0, 160.0)),
        }
    }
}

/// Frontend reports its content size; window is resized and repositioned.
#[tauri::command]
pub fn resize_dock(app: AppHandle, width: f64, height: f64) -> AeroResult<()> {
    let geometry = app.state::<DockGeometry>();
    *geometry.content_size.lock() = (width.max(1.0), height.max(1.0));
    position_dock(&app)
}

/// Recompute and apply the dock window's position from current settings.
/// Called on resize requests, settings changes, and WM_DISPLAYCHANGE.
pub fn position_dock(app: &AppHandle) -> AeroResult<()> {
    let settings = app.state::<SettingsStore>().get();
    let geometry = app.state::<DockGeometry>();
    let (logical_w, logical_h) = *geometry.content_size.lock();

    let monitors = enumerate_monitors()?;
    let monitor = pick_monitor(&monitors, settings.dock.monitor.as_deref());

    let scale = monitor.scale;
    let margin = if settings.dock.floating {
        (settings.dock.floating_margin as f64 * scale).round() as i32
    } else {
        0
    };

    let w = (logical_w * scale).round() as i32;
    let h = (logical_h * scale).round() as i32;
    let (x, y) = place_on_edge(monitor, settings.dock.edge, w, h, margin);

    let window = app
        .get_webview_window("dock")
        .ok_or_else(|| AeroError::other("dock window missing"))?;
    window.set_size(PhysicalSize::new(w.max(1) as u32, h.max(1) as u32))?;
    window.set_position(PhysicalPosition::new(x, y))?;
    Ok(())
}

/// Pure placement math: center the dock along the chosen work-area edge.
fn place_on_edge(
    monitor: &MonitorInfoEx,
    edge: DockEdge,
    w: i32,
    h: i32,
    margin: i32,
) -> (i32, i32) {
    let wa = monitor.work_area;
    match edge {
        DockEdge::Bottom => (wa.x + (wa.width - w) / 2, wa.y + wa.height - h - margin),
        DockEdge::Top => (wa.x + (wa.width - w) / 2, wa.y + margin),
        DockEdge::Left => (wa.x + margin, wa.y + (wa.height - h) / 2),
        DockEdge::Right => (wa.x + wa.width - w - margin, wa.y + (wa.height - h) / 2),
    }
}

/// List monitors so the settings UI can offer a monitor picker.
#[tauri::command]
pub fn list_monitors() -> AeroResult<Vec<MonitorInfoEx>> {
    enumerate_monitors()
}

/// Let the dock take keyboard focus (search overlay) or give its
/// focus-immunity back when the overlay closes.
#[tauri::command]
pub fn set_dock_focusable(app: AppHandle, focusable: bool) -> AeroResult<()> {
    let window = app
        .get_webview_window("dock")
        .ok_or_else(|| AeroError::other("dock window missing"))?;
    let hwnd = window.hwnd()?;
    crate::platform::windows::dock_window::set_no_activate(
        windows::Win32::Foundation::HWND(hwnd.0),
        !focusable,
    )?;
    if focusable {
        window.set_focus()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::windows::monitors::Rect;

    fn monitor() -> MonitorInfoEx {
        MonitorInfoEx {
            name: r"\\.\DISPLAY1".into(),
            bounds: Rect { x: 0, y: 0, width: 2560, height: 1440 },
            work_area: Rect { x: 0, y: 0, width: 2560, height: 1392 }, // 48px taskbar
            scale: 1.25,
            is_primary: true,
        }
    }

    #[test]
    fn bottom_edge_sits_above_taskbar() {
        let (x, y) = place_on_edge(&monitor(), DockEdge::Bottom, 800, 200, 10);
        assert_eq!(x, (2560 - 800) / 2);
        assert_eq!(y, 1392 - 200 - 10);
    }

    #[test]
    fn left_edge_centers_vertically() {
        let (x, y) = place_on_edge(&monitor(), DockEdge::Left, 200, 800, 0);
        assert_eq!(x, 0);
        assert_eq!(y, (1392 - 800) / 2);
    }
}
