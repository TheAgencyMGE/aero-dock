//! Windows taskbar control: get the shell taskbar out of the way so Aero
//! Dock can be the visible bar, and put it back on request.
//!
//! `ABM_SETSTATE` alone is not enough. It sets the auto-hide *state*, which
//! frees up the work area, but on Windows 11 the shell frequently leaves the
//! bar on screen anyway — it looks like it shifted rather than hid. So the
//! bar is also hidden outright with `ShowWindow`, which is what actually
//! makes it disappear. Both are reversible, and `restore` runs on quit and
//! again at startup so a crash can never leave you without a taskbar.

use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::UI::Shell::{
    SHAppBarMessage, ABM_SETSTATE, ABS_ALWAYSONTOP, ABS_AUTOHIDE, APPBARDATA,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowW, GetClassNameW, ShowWindow, SW_HIDE, SW_SHOWNA,
};

/// Set the appbar auto-hide state. This is what frees the work area, so
/// maximised windows use the full screen.
fn set_appbar_state(hide: bool) {
    let state = if hide { ABS_AUTOHIDE } else { ABS_ALWAYSONTOP };
    let mut abd = APPBARDATA {
        cbSize: std::mem::size_of::<APPBARDATA>() as u32,
        lParam: LPARAM(state as isize),
        ..Default::default()
    };
    unsafe {
        SHAppBarMessage(ABM_SETSTATE, &mut abd);
    }
}

/// Collector for the secondary taskbars that appear on additional monitors.
unsafe extern "system" fn collect_secondary(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
    unsafe {
        let mut class = [0u16; 64];
        let len = GetClassNameW(hwnd, &mut class);
        if len > 0 {
            let name = String::from_utf16_lossy(&class[..len as usize]);
            if name == "Shell_SecondaryTrayWnd" {
                let list = &mut *(lparam.0 as *mut Vec<HWND>);
                list.push(hwnd);
            }
        }
    }
    true.into()
}

/// Every taskbar window: the primary one plus one per extra monitor.
fn taskbar_windows() -> Vec<HWND> {
    let mut found = Vec::new();
    unsafe {
        if let Ok(primary) = FindWindowW(w!("Shell_TrayWnd"), None) {
            if !primary.0.is_null() {
                found.push(primary);
            }
        }
        let mut secondary: Vec<HWND> = Vec::new();
        let _ = EnumWindows(
            Some(collect_secondary),
            LPARAM(&mut secondary as *mut Vec<HWND> as isize),
        );
        found.extend(secondary);
    }
    found
}

fn show_taskbars(visible: bool) {
    let cmd = if visible { SW_SHOWNA } else { SW_HIDE };
    for hwnd in taskbar_windows() {
        unsafe {
            let _ = ShowWindow(hwnd, cmd);
        }
    }
}

/// `hide = true` takes the taskbar off screen; `false` puts it back.
pub fn set_taskbar_autohide(hide: bool) {
    set_appbar_state(hide);
    show_taskbars(!hide);
}

/// Force the taskbar visible regardless of current state. Called on quit
/// and at startup, so an unclean exit cannot strand the user without one.
pub fn restore_taskbar() {
    set_appbar_state(false);
    show_taskbars(true);
}
