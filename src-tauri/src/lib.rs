pub mod commands;
pub mod core;
pub mod platform;

use tauri::Manager;

use crate::commands::dock::DockGeometry;
use crate::core::settings::SettingsStore;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Second launch: just make sure the existing dock is visible.
            if let Some(window) = app.get_webview_window("dock") {
                let _ = window.show();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(DockGeometry::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let store = SettingsStore::load(&handle)?;
            app.manage(store);

            let window = app
                .get_webview_window("dock")
                .expect("dock window declared in tauri.conf.json");

            #[cfg(windows)]
            {
                let hwnd = window.hwnd()?;
                platform::windows::dock_window::apply_dock_styles(
                    windows::Win32::Foundation::HWND(hwnd.0),
                )?;
            }

            commands::dock::position_dock(&handle)?;
            window.show()?;

            #[cfg(windows)]
            platform::windows::running::start(handle.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_settings,
            commands::settings::set_settings,
            commands::settings::pin_item,
            commands::settings::unpin_item,
            commands::settings::reorder_pinned,
            commands::settings::first_run_import,
            commands::settings::export_settings,
            commands::settings::import_settings,
            commands::apps::list_apps,
            commands::apps::resolve_icons,
            commands::apps::launch,
            commands::apps::launch_as_admin,
            commands::apps::open_file_location,
            commands::apps::resolve_drop,
            commands::dock::resize_dock,
            commands::dock::list_monitors,
            commands::windows_cmd::get_running,
            commands::windows_cmd::activate_window,
            commands::windows_cmd::minimize_window,
            commands::windows_cmd::close_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Aero Dock");
}
