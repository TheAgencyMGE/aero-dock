//! Window management IPC: the frontend gets live snapshots via the
//! `apps://running-changed` event; these commands cover hydrate + actions.

use crate::platform::windows::running;

#[tauri::command]
pub fn get_running() -> running::RunningSnapshot {
    running::snapshot()
}

#[tauri::command]
pub fn activate_window(hwnd: isize) {
    running::activate_window(hwnd);
}

#[tauri::command]
pub fn minimize_window(hwnd: isize) {
    running::minimize_window(hwnd);
}

#[tauri::command]
pub fn close_window(hwnd: isize) {
    running::close_window(hwnd);
}
