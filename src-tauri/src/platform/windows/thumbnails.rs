//! Live window previews via DWM thumbnails: the compositor renders a
//! real, live miniature of a source window directly into a rectangle of
//! our dock window — zero copies, zero polling. The frontend draws the
//! glass frame; we place the living picture inside it.

use parking_lot::Mutex;
use serde::Deserialize;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Dwm::{
    DwmRegisterThumbnail, DwmUnregisterThumbnail, DwmUpdateThumbnailProperties,
    DWM_THUMBNAIL_PROPERTIES, DWM_TNP_RECTDESTINATION, DWM_TNP_SOURCECLIENTAREAONLY,
    DWM_TNP_VISIBLE,
};

use crate::core::AeroResult;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSlot {
    /// Source window handle.
    pub hwnd: isize,
    /// Destination rect in the dock window's client area, physical px.
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// Registered thumbnail ids (opaque HTHUMBNAIL pointers).
static ACTIVE: Mutex<Vec<isize>> = Mutex::new(Vec::new());

/// Replace all previews with the given slots.
pub fn show(dest: HWND, slots: &[PreviewSlot]) -> AeroResult<()> {
    hide();
    let mut active = ACTIVE.lock();
    for slot in slots {
        let thumb = match unsafe { DwmRegisterThumbnail(dest, HWND(slot.hwnd as *mut _)) } {
            Ok(t) => t,
            Err(e) => {
                log::debug!("thumbnail register failed for {}: {e}", slot.hwnd);
                continue;
            }
        };
        let props = DWM_THUMBNAIL_PROPERTIES {
            dwFlags: DWM_TNP_RECTDESTINATION | DWM_TNP_VISIBLE | DWM_TNP_SOURCECLIENTAREAONLY,
            rcDestination: RECT {
                left: slot.x,
                top: slot.y,
                right: slot.x + slot.w,
                bottom: slot.y + slot.h,
            },
            fVisible: true.into(),
            fSourceClientAreaOnly: false.into(),
            ..Default::default()
        };
        if unsafe { DwmUpdateThumbnailProperties(thumb, &props) }.is_err() {
            let _ = unsafe { DwmUnregisterThumbnail(thumb) };
            continue;
        }
        active.push(thumb);
    }
    Ok(())
}

/// Tear down all live previews.
pub fn hide() {
    let mut active = ACTIVE.lock();
    for id in active.drain(..) {
        let _ = unsafe { DwmUnregisterThumbnail(id) };
    }
}
