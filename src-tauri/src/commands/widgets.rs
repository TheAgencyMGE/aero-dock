//! Widget IPC: the overlay window, the widget list, and the live data
//! the widgets render.
//!
//! The overlay is created here rather than declared in tauri.conf.json
//! because it has to be sized to the virtual desktop, which is only known
//! at runtime and changes when monitors are plugged in.

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::core::settings::{Settings, SettingsStore};
use crate::core::widgets::{WidgetInstance, WidgetKind, WidgetOptions};
use crate::core::{AeroError, AeroResult};

#[cfg(windows)]
use crate::platform::windows::widget_layer::{self, HitRect};

pub const WIDGETS_LABEL: &str = "widgets";

fn new_id() -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static SEQ: AtomicU32 = AtomicU32::new(0);
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("wid-{millis:x}-{:x}", SEQ.fetch_add(1, Ordering::Relaxed))
}

/// Where the overlay has to sit to cover every monitor.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// The union of every monitor, in physical pixels. Widgets are positioned
/// relative to this origin, which is why the frontend needs it too.
fn desktop_bounds() -> DesktopBounds {
    let monitors = crate::platform::windows::monitors::enumerate_monitors().unwrap_or_default();
    if monitors.is_empty() {
        return DesktopBounds { x: 0, y: 0, width: 1920, height: 1080 };
    }
    let left = monitors.iter().map(|m| m.bounds.x).min().unwrap_or(0);
    let top = monitors.iter().map(|m| m.bounds.y).min().unwrap_or(0);
    let right = monitors
        .iter()
        .map(|m| m.bounds.x + m.bounds.width)
        .max()
        .unwrap_or(1920);
    let bottom = monitors
        .iter()
        .map(|m| m.bounds.y + m.bounds.height)
        .max()
        .unwrap_or(1080);
    DesktopBounds {
        x: left,
        y: top,
        width: (right - left).max(1) as u32,
        height: (bottom - top).max(1) as u32,
    }
}

#[tauri::command]
pub fn widget_desktop_bounds() -> DesktopBounds {
    desktop_bounds()
}

/// Build the overlay window if it is not already there.
///
/// Async for the same reason the settings window is: creating a WebView2
/// inside a synchronous command deadlocks, because the command is holding
/// the thread the webview needs.
#[tauri::command]
pub async fn open_widget_layer(app: AppHandle) -> AeroResult<()> {
    if let Some(w) = app.get_webview_window(WIDGETS_LABEL) {
        w.show()?;
        return Ok(());
    }

    let bounds = desktop_bounds();
    let builder = tauri::WebviewWindowBuilder::new(
        &app,
        WIDGETS_LABEL,
        tauri::WebviewUrl::App("index.html?window=widgets".into()),
    )
    .title("Aero Widgets")
    .decorations(false)
    .transparent(true)
    .resizable(false)
    .skip_taskbar(true)
    .shadow(false)
    .focused(false)
    // Desktop furniture belongs on the desktop. Without this the overlay
    // floats over whatever you are working in, which is the opposite of
    // what a wallpaper widget is for.
    .always_on_bottom(true)
    .visible(false);

    // Same browser arguments as every other window, or WebView2 refuses
    // to create a second one against the same profile.
    #[cfg(windows)]
    let builder = match crate::commands::settings::dock_browser_args(&app) {
        Some(args) => builder.additional_browser_args(&args),
        None => builder,
    };

    let window = builder.build()?;

    // Monitor bounds are physical pixels, and the builder takes logical
    // ones, so the geometry is applied afterwards in the units it was
    // measured in. On a scaled display the two differ and the overlay
    // would otherwise miss part of the desktop.
    window.set_position(tauri::PhysicalPosition::new(bounds.x, bounds.y))?;
    window.set_size(tauri::PhysicalSize::new(bounds.width, bounds.height))?;

    #[cfg(windows)]
    {
        let hwnd = windows::Win32::Foundation::HWND(window.hwnd()?.0);
        // Start with nothing clickable. The frontend sends the real region
        // once it has laid the widgets out, and until then the desktop has
        // to stay usable.
        widget_layer::set_hit_region(hwnd, &[])?;
    }

    window.show()?;

    #[cfg(windows)]
    {
        // After show, not before: Tauri rewrites the extended styles as
        // part of presenting the window, which silently undoes these if
        // they are applied any earlier.
        let hwnd = windows::Win32::Foundation::HWND(window.hwnd()?.0);
        widget_layer::apply_widget_styles(hwnd)?;
    }
    Ok(())
}

#[tauri::command]
pub fn close_widget_layer(app: AppHandle) -> AeroResult<()> {
    if let Some(w) = app.get_webview_window(WIDGETS_LABEL) {
        w.close()?;
    }
    Ok(())
}

/// Make only the given rectangles clickable. Everything else in the
/// overlay passes straight through to the desktop.
#[tauri::command]
pub fn set_widget_hit_rects(app: AppHandle, rects: Vec<HitRect>) -> AeroResult<()> {
    #[cfg(windows)]
    {
        let Some(w) = app.get_webview_window(WIDGETS_LABEL) else {
            return Ok(());
        };
        let hwnd = w.hwnd()?;
        widget_layer::set_hit_region(windows::Win32::Foundation::HWND(hwnd.0), &rects)?;
    }
    #[cfg(not(windows))]
    let _ = (app, rects);
    Ok(())
}

/// Take input across the whole overlay, for the duration of a drag.
#[tauri::command]
pub fn set_widget_drag_mode(app: AppHandle, dragging: bool) -> AeroResult<()> {
    #[cfg(windows)]
    {
        let Some(w) = app.get_webview_window(WIDGETS_LABEL) else {
            return Ok(());
        };
        let hwnd = windows::Win32::Foundation::HWND(w.hwnd()?.0);
        if dragging {
            widget_layer::clear_hit_region(hwnd)?;
        }
        // Leaving a drag does not restore the region here: the frontend
        // knows the new geometry and sends it, which avoids a frame where
        // the region is stale.
    }
    #[cfg(not(windows))]
    let _ = (app, dragging);
    Ok(())
}

// ---------------------------------------------------------------------
// the widget list
// ---------------------------------------------------------------------

/// Turn the layer on or off. Turning it on with no widgets adds a clock,
/// because an empty desktop looks like the feature failed.
#[tauri::command]
pub async fn enable_widgets(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    enabled: bool,
) -> AeroResult<Settings> {
    let settings = store.update(&app, |s| {
        if enabled {
            if s.widgets.widgets.is_empty() {
                s.widgets
                    .widgets
                    .push(WidgetInstance::new(new_id(), WidgetKind::Clock, 80, 80));
            }
            s.widgets.enabled = true;
        } else {
            s.widgets.enabled = false;
        }
    })?;

    if settings.widgets.enabled {
        open_widget_layer(app).await?;
    } else {
        close_widget_layer(app)?;
    }
    Ok(settings)
}

#[tauri::command]
pub async fn add_widget(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    kind: WidgetKind,
    x: Option<i32>,
    y: Option<i32>,
) -> AeroResult<Settings> {
    let settings = store.update(&app, |s| {
        // stagger new widgets so they do not stack exactly on each other
        let n = s.widgets.widgets.len() as i32;
        let instance = WidgetInstance::new(
            new_id(),
            kind,
            x.unwrap_or(80 + (n % 5) * 40),
            y.unwrap_or(80 + (n % 5) * 40),
        );
        s.widgets.widgets.push(instance);
        s.widgets.enabled = true;
    })?;
    open_widget_layer(app).await?;
    Ok(settings)
}

#[tauri::command]
pub fn remove_widget(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    id: String,
) -> AeroResult<Settings> {
    let settings = store.update(&app, |s| {
        s.widgets.widgets.retain(|w| w.id != id);
    })?;
    // sanitize turns the layer off when the last one goes
    if !settings.widgets.enabled {
        close_widget_layer(app)?;
    }
    Ok(settings)
}

/// Move or resize. Called on drop rather than per frame: the frontend
/// animates locally and only persists the result.
#[tauri::command]
pub fn place_widget(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    id: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> AeroResult<Settings> {
    store.update(&app, |s| {
        if let Some(w) = s.widgets.widgets.iter_mut().find(|w| w.id == id) {
            w.x = x;
            w.y = y;
            w.width = width;
            w.height = height;
        }
    })
}

/// The appearance side of one widget. Every field is optional so the UI
/// can send only what the user actually touched.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetStyle {
    pub opacity: Option<f32>,
    pub surface: Option<crate::core::settings::SurfaceStyle>,
    /// Outer option: was it sent. Inner: clearing the tint back to theme.
    pub accent: Option<Option<String>>,
    pub ambient: Option<bool>,
    pub locked: Option<bool>,
    pub options: Option<WidgetOptions>,
}

#[tauri::command]
pub fn style_widget(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    id: String,
    style: WidgetStyle,
) -> AeroResult<Settings> {
    store.update(&app, |s| {
        let Some(w) = s.widgets.widgets.iter_mut().find(|w| w.id == id) else {
            return;
        };
        if let Some(v) = style.opacity {
            w.opacity = v;
        }
        if let Some(v) = style.surface {
            w.surface = v;
        }
        if let Some(v) = style.accent {
            w.accent = v;
        }
        if let Some(v) = style.ambient {
            w.ambient = v;
        }
        if let Some(v) = style.locked {
            w.locked = v;
        }
        if let Some(v) = style.options {
            w.options = v;
        }
    })
}

/// Weather is the only widget that leaves the machine, so permission is
/// its own switch rather than something implied by adding it.
#[tauri::command]
pub fn allow_weather_network(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    allowed: bool,
) -> AeroResult<Settings> {
    store.update(&app, |s| s.widgets.allow_weather_network = allowed)
}

// ---------------------------------------------------------------------
// live data
// ---------------------------------------------------------------------

#[tauri::command]
pub async fn widget_system_load() -> AeroResult<crate::platform::windows::sysstats::SystemLoad> {
    tauri::async_runtime::spawn_blocking(crate::platform::windows::sysstats::read)
        .await
        .map_err(|e| AeroError::other(format!("system load failed: {e}")))
}

#[tauri::command]
pub async fn widget_now_playing() -> crate::platform::windows::media::NowPlaying {
    crate::platform::windows::media::now_playing().await
}

#[tauri::command]
pub async fn widget_media_control(
    action: crate::platform::windows::media::MediaAction,
) -> bool {
    crate::platform::windows::media::control(action).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn generated_ids_do_not_collide() {
        let ids: HashSet<String> = (0..200).map(|_| new_id()).collect();
        assert_eq!(ids.len(), 200);
    }

    #[test]
    fn the_desktop_bounds_cover_a_real_area() {
        let b = desktop_bounds();
        assert!(b.width > 0 && b.height > 0);
    }
}
