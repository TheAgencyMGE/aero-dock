//! Windows taskbar control: flip the shell taskbar into auto-hide so
//! Aero Dock can be the visible bar, and restore it on request. Uses
//! the documented appbar state API — fully reversible, survives
//! Explorer restarts, and never fights the shell.

use windows::Win32::UI::Shell::{
    SHAppBarMessage, ABM_SETSTATE, ABS_ALWAYSONTOP, ABS_AUTOHIDE, APPBARDATA,
};

/// `hide = true` puts the taskbar in auto-hide; `false` restores the
/// normal always-on-top state.
pub fn set_taskbar_autohide(hide: bool) {
    let state = if hide { ABS_AUTOHIDE } else { ABS_ALWAYSONTOP };
    let mut abd = APPBARDATA {
        cbSize: std::mem::size_of::<APPBARDATA>() as u32,
        lParam: windows::Win32::Foundation::LPARAM(state as isize),
        ..Default::default()
    };
    unsafe {
        SHAppBarMessage(ABM_SETSTATE, &mut abd);
    }
}
