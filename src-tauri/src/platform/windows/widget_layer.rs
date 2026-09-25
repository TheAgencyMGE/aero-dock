//! The window widgets live on, and the trick that keeps it out of the way.
//!
//! All the widgets share one transparent window stretched across the whole
//! virtual desktop. One window means one webview, which matters: a second
//! webview costs roughly as much memory as the dock itself, and five of
//! them would undo everything 1.2.1 saved.
//!
//! A full-screen window would normally swallow every click on the desktop.
//! It does not, because the window is given a region: Windows only treats
//! the window as existing inside that region, so clicks anywhere else land
//! on whatever is behind, with no hit testing of our own and nothing to
//! poll. The region is the union of the widget rectangles, rounded to
//! match their corners.
//!
//! While a widget is being dragged the region opens up to the whole
//! window, otherwise the cursor would slip out of the region mid-drag and
//! the widget would be dropped.

use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{
    CombineRgn, CreateRectRgn, CreateRoundRectRgn, DeleteObject, SetWindowRgn, RGN_OR,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_APPWINDOW, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW,
};

use crate::core::AeroResult;

/// One widget's clickable area, in physical pixels relative to the
/// window's top left. The frontend sends these because it is the side
/// that knows the device pixel ratio it laid the widgets out with.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HitRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    /// Corner radius, so the region matches the glass instead of clipping
    /// square corners over the desktop.
    pub radius: i32,
}

/// Desktop furniture, like the dock: no taskbar button, no Alt-Tab entry,
/// and clicking a widget must not pull focus out of whatever the user is
/// actually working in.
pub fn apply_widget_styles(hwnd: HWND) -> AeroResult<()> {
    unsafe {
        let mut ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as isize;
        ex |= (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) as isize;
        ex &= !(WS_EX_APPWINDOW.0 as isize);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex);
    }
    Ok(())
}

/// Restrict the window to the given rectangles.
///
/// An empty list would make the window vanish entirely, which is not what
/// callers mean by "no widgets"; they mean the layer should be closed. So
/// an empty list collapses the window to nothing clickable rather than
/// being treated as "everything".
pub fn set_hit_region(hwnd: HWND, rects: &[HitRect]) -> AeroResult<()> {
    unsafe {
        let combined = CreateRectRgn(0, 0, 0, 0);
        for r in rects {
            // a region of zero area is not an error worth failing over,
            // it just contributes nothing
            if r.width <= 0 || r.height <= 0 {
                continue;
            }
            // CreateRoundRectRgn takes the ellipse size, which is twice
            // the corner radius, and wants the rect exclusive on the far
            // edge, hence the +1.
            let d = (r.radius.max(0) * 2).min(r.width).min(r.height);
            let part = if d > 0 {
                CreateRoundRectRgn(r.x, r.y, r.x + r.width + 1, r.y + r.height + 1, d, d)
            } else {
                CreateRectRgn(r.x, r.y, r.x + r.width, r.y + r.height)
            };
            CombineRgn(Some(combined), Some(combined), Some(part), RGN_OR);
            let _ = DeleteObject(part.into());
        }
        // Windows takes ownership of the region handle on success, so it
        // must not be deleted here.
        if SetWindowRgn(hwnd, Some(combined), true) == 0 {
            let _ = DeleteObject(combined.into());
            return Err(crate::core::AeroError::other(
                "could not apply the widget hit region",
            ));
        }
    }
    Ok(())
}

/// Let the whole window take input again, for the duration of a drag.
pub fn clear_hit_region(hwnd: HWND) -> AeroResult<()> {
    unsafe {
        // a null region means "the whole window", which is the default
        if SetWindowRgn(hwnd, None, true) == 0 {
            return Err(crate::core::AeroError::other(
                "could not clear the widget hit region",
            ));
        }
    }
    Ok(())
}

/// The union of the given rectangles, as a bounding box. Used to check a
/// region covers what it should without going near Win32 in a test.
pub fn bounding_box(rects: &[HitRect]) -> Option<(i32, i32, i32, i32)> {
    let mut it = rects.iter().filter(|r| r.width > 0 && r.height > 0);
    let first = it.next()?;
    let mut left = first.x;
    let mut top = first.y;
    let mut right = first.x + first.width;
    let mut bottom = first.y + first.height;
    for r in it {
        left = left.min(r.x);
        top = top.min(r.y);
        right = right.max(r.x + r.width);
        bottom = bottom.max(r.y + r.height);
    }
    Some((left, top, right, bottom))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i32, y: i32, w: i32, h: i32) -> HitRect {
        HitRect { x, y, width: w, height: h, radius: 18 }
    }

    #[test]
    fn a_single_rect_is_its_own_bounding_box() {
        assert_eq!(bounding_box(&[rect(10, 20, 100, 50)]), Some((10, 20, 110, 70)));
    }

    #[test]
    fn scattered_widgets_are_covered_by_the_union() {
        let rects = [rect(0, 0, 100, 100), rect(500, 300, 200, 80)];
        assert_eq!(bounding_box(&rects), Some((0, 0, 700, 380)));
    }

    #[test]
    fn empty_and_degenerate_rects_contribute_nothing() {
        assert_eq!(bounding_box(&[]), None);
        assert_eq!(bounding_box(&[rect(5, 5, 0, 40)]), None);
        // a real one alongside a degenerate one still counts
        assert_eq!(
            bounding_box(&[rect(5, 5, 0, 40), rect(10, 10, 20, 20)]),
            Some((10, 10, 30, 30))
        );
    }

    #[test]
    fn hit_rects_parse_from_what_the_frontend_sends() {
        let r: HitRect =
            serde_json::from_str(r#"{"x":12,"y":34,"width":200,"height":150,"radius":20}"#)
                .expect("frontend shape");
        assert_eq!((r.x, r.y, r.width, r.height, r.radius), (12, 34, 200, 150, 20));
    }
}
