//! Win32 styling for the dock window: keep it out of Alt-Tab and the
//! taskbar, and stop it from stealing focus from the app the user is
//! actually working in (docks are furniture, not windows).

use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_APPWINDOW, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW,
};

use crate::core::AeroResult;

/// Apply dock chrome: WS_EX_TOOLWINDOW (no Alt-Tab entry), no
/// WS_EX_APPWINDOW (no taskbar button), WS_EX_NOACTIVATE (clicks don't
/// pull focus away from the foreground app).
pub fn apply_dock_styles(hwnd: HWND) -> AeroResult<()> {
    unsafe {
        let mut ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as isize;
        ex |= (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) as isize;
        ex &= !(WS_EX_APPWINDOW.0 as isize);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex);
    }
    Ok(())
}

/// Temporarily allow the dock to take keyboard focus (search overlay),
/// or give focus-immunity back when the overlay closes.
pub fn set_no_activate(hwnd: HWND, no_activate: bool) -> AeroResult<()> {
    unsafe {
        let mut ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as isize;
        if no_activate {
            ex |= WS_EX_NOACTIVATE.0 as isize;
        } else {
            ex &= !(WS_EX_NOACTIVATE.0 as isize);
        }
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex);
    }
    Ok(())
}
