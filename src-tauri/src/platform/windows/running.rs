//! Live running-application tracking, the way real taskbars do it:
//! a hidden window on its own thread registers for shell hook messages
//! (HSHELL_WINDOWCREATED / DESTROYED / ACTIVATED …) and keeps a snapshot
//! of alt-tab-eligible windows. Every change is pushed to the frontend
//! as a full `apps://running-changed` snapshot — no polling anywhere.

use std::collections::HashMap;
use std::sync::OnceLock;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, EnumWindows, GetMessageW, GetWindow,
    GetWindowLongPtrW, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    IsWindow, IsWindowVisible, RegisterClassW, RegisterShellHookWindow, RegisterWindowMessageW,
    TranslateMessage, GWL_EXSTYLE, GW_OWNER, MSG, WINDOW_EX_STYLE, WINDOW_STYLE,
    WNDCLASSW, WS_EX_TOOLWINDOW,
};

pub const RUNNING_EVENT: &str = "apps://running-changed";

// Shell hook codes (winuser.h)
const HSHELL_WINDOWCREATED: usize = 1;
const HSHELL_WINDOWDESTROYED: usize = 2;
const HSHELL_WINDOWACTIVATED: usize = 4;
const HSHELL_REDRAW: usize = 6;
const HSHELL_RUDEAPPACTIVATED: usize = 0x8004;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    /// HWND as integer; opaque handle for activate/minimize/close calls.
    pub hwnd: isize,
    pub title: String,
    /// Full path of the owning process executable.
    pub exe: String,
    pub pid: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningSnapshot {
    pub windows: Vec<WindowInfo>,
    /// HWND of the foreground window (0 = none of ours).
    pub focused: isize,
}

struct TrackerState {
    app: AppHandle,
    windows: HashMap<isize, WindowInfo>,
    focused: isize,
}

static STATE: OnceLock<Mutex<TrackerState>> = OnceLock::new();
static SHELL_MSG: OnceLock<u32> = OnceLock::new();

/// Current snapshot for the initial frontend hydrate.
pub fn snapshot() -> RunningSnapshot {
    match STATE.get() {
        Some(state) => {
            let s = state.lock();
            let mut windows: Vec<_> = s.windows.values().cloned().collect();
            windows.sort_by_key(|w| w.hwnd);
            RunningSnapshot {
                windows,
                focused: s.focused,
            }
        }
        None => RunningSnapshot {
            windows: Vec::new(),
            focused: 0,
        },
    }
}

/// Spawn the tracker thread. Call once from app setup.
pub fn start(app: AppHandle) {
    std::thread::Builder::new()
        .name("aero-shell-hook".into())
        .spawn(move || run_message_loop(app))
        .expect("spawn shell hook thread");
}

fn run_message_loop(app: AppHandle) {
    let initial: HashMap<isize, WindowInfo> = enumerate_taskbar_windows()
        .into_iter()
        .map(|w| (w.hwnd, w))
        .collect();
    let _ = STATE.set(Mutex::new(TrackerState {
        app: app.clone(),
        windows: initial,
        focused: 0,
    }));
    emit_snapshot();

    unsafe {
        let class = WNDCLASSW {
            lpfnWndProc: Some(wnd_proc),
            lpszClassName: w!("AeroDockShellHook"),
            ..Default::default()
        };
        RegisterClassW(&class);

        // NOTE: must be a real (hidden) top-level window — message-only
        // windows (HWND_MESSAGE parent) never receive shell hook messages.
        let hwnd = match CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("AeroDockShellHook"),
            w!("AeroDockShellHook"),
            WINDOW_STYLE(0),
            0,
            0,
            0,
            0,
            None,
            None,
            None,
            None,
        ) {
            Ok(h) => h,
            Err(e) => {
                log::error!("shell hook window creation failed: {e}");
                return;
            }
        };

        let _ = SHELL_MSG.set(RegisterWindowMessageW(w!("SHELLHOOK")));
        if !RegisterShellHookWindow(hwnd).as_bool() {
            log::error!("RegisterShellHookWindow failed; running apps won't be live");
            return;
        }

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if Some(&msg) == SHELL_MSG.get() {
        let target = HWND(lparam.0 as *mut _);
        match wparam.0 {
            HSHELL_WINDOWCREATED | HSHELL_REDRAW => {
                if let Some(info) = unsafe { probe_window(target) } {
                    with_state(|s| {
                        s.windows.insert(info.hwnd, info);
                    });
                } else {
                    // REDRAW on a window that stopped qualifying (title gone)
                    with_state(|s| {
                        s.windows.remove(&(lparam.0));
                    });
                }
                prune_and_emit();
            }
            HSHELL_WINDOWDESTROYED => {
                with_state(|s| {
                    s.windows.remove(&(lparam.0));
                    if s.focused == lparam.0 {
                        s.focused = 0;
                    }
                });
                prune_and_emit();
            }
            HSHELL_WINDOWACTIVATED | HSHELL_RUDEAPPACTIVATED => {
                // activation can arrive before creation for fast-starting apps
                if let Some(info) = unsafe { probe_window(target) } {
                    with_state(|s| {
                        s.windows.insert(info.hwnd, info);
                        s.focused = lparam.0;
                    });
                } else {
                    with_state(|s| s.focused = lparam.0);
                }
                prune_and_emit();
            }
            _ => {}
        }
        return LRESULT(0);
    }
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

fn with_state<R>(f: impl FnOnce(&mut TrackerState) -> R) -> Option<R> {
    STATE.get().map(|state| f(&mut state.lock()))
}

/// Drop stale entries (windows that died without a DESTROYED hook) and
/// push the new snapshot to the frontend.
fn prune_and_emit() {
    with_state(|s| {
        s.windows
            .retain(|&hwnd, _| unsafe { IsWindow(Some(HWND(hwnd as *mut _))).as_bool() });
    });
    emit_snapshot();
}

fn emit_snapshot() {
    if let Some(state) = STATE.get() {
        let (app, snap) = {
            let s = state.lock();
            let mut windows: Vec<_> = s.windows.values().cloned().collect();
            windows.sort_by_key(|w| w.hwnd);
            (
                s.app.clone(),
                RunningSnapshot {
                    windows,
                    focused: s.focused,
                },
            )
        };
        if let Err(e) = app.emit(RUNNING_EVENT, &snap) {
            log::warn!("emit running snapshot failed: {e}");
        }
    }
}

/// Initial scan: everything currently alt-tab eligible.
fn enumerate_taskbar_windows() -> Vec<WindowInfo> {
    unsafe extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
        let out = unsafe { &mut *(lparam.0 as *mut Vec<WindowInfo>) };
        if let Some(info) = unsafe { probe_window(hwnd) } {
            out.push(info);
        }
        windows::core::BOOL(1)
    }
    let mut out: Vec<WindowInfo> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(cb), LPARAM(&mut out as *mut _ as isize));
    }
    out
}

/// Alt-tab eligibility + metadata. Returns None for windows a dock
/// should not show (owned popups, tool windows, cloaked UWP shells,
/// untitled windows, and Aero Dock itself).
unsafe fn probe_window(hwnd: HWND) -> Option<WindowInfo> {
    unsafe {
        if !IsWindow(Some(hwnd)).as_bool() || !IsWindowVisible(hwnd).as_bool() {
            return None;
        }
        if GetWindow(hwnd, GW_OWNER).is_ok_and(|o| !o.0.is_null()) {
            return None;
        }
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        if ex & WS_EX_TOOLWINDOW.0 != 0 {
            return None;
        }
        // cloaked = UWP window that is suspended/on another virtual desktop shell state
        let mut cloaked: u32 = 0;
        let _ = DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut _,
            std::mem::size_of::<u32>() as u32,
        );
        if cloaked != 0 {
            return None;
        }

        let len = GetWindowTextLengthW(hwnd);
        if len == 0 {
            return None;
        }
        let mut title_buf = vec![0u16; len as usize + 1];
        let read = GetWindowTextW(hwnd, &mut title_buf);
        let title = String::from_utf16_lossy(&title_buf[..read.max(0) as usize]);
        if title.trim().is_empty() {
            return None;
        }

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 || pid == std::process::id() {
            return None;
        }
        let exe = process_path(pid)?;

        Some(WindowInfo {
            hwnd: hwnd.0 as isize,
            title,
            exe,
            pid,
        })
    }
}

fn process_path(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32,
            windows::core::PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = windows::Win32::Foundation::CloseHandle(handle);
        ok.ok()?;
        Some(String::from_utf16_lossy(&buf[..len as usize]))
    }
}

// ---------------------------------------------------------------------
// window actions
// ---------------------------------------------------------------------

/// Bring a window to the foreground, restoring it if minimized.
/// Uses the Alt-key trick so it works from a NOACTIVATE dock window.
pub fn activate_window(hwnd: isize) {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        keybd_event, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VK_MENU,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };
    unsafe {
        let h = HWND(hwnd as *mut _);
        if !IsWindow(Some(h)).as_bool() {
            return;
        }
        if IsIconic(h).as_bool() {
            let _ = ShowWindow(h, SW_RESTORE);
        }
        // Windows only lets the foreground process reassign foreground;
        // a synthetic Alt press makes the shell treat us as eligible.
        keybd_event(VK_MENU.0 as u8, 0, KEYBD_EVENT_FLAGS(0), 0);
        let _ = SetForegroundWindow(h);
        keybd_event(VK_MENU.0 as u8, 0, KEYEVENTF_KEYUP, 0);
    }
}

pub fn minimize_window(hwnd: isize) {
    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_MINIMIZE};
    unsafe {
        let h = HWND(hwnd as *mut _);
        if IsWindow(Some(h)).as_bool() {
            let _ = ShowWindow(h, SW_MINIMIZE);
        }
    }
}

pub fn close_window(hwnd: isize) {
    use windows::Win32::UI::WindowsAndMessaging::{PostMessageW, WM_CLOSE};
    unsafe {
        let h = HWND(hwnd as *mut _);
        if IsWindow(Some(h)).as_bool() {
            let _ = PostMessageW(Some(h), WM_CLOSE, WPARAM(0), LPARAM(0));
        }
    }
}
