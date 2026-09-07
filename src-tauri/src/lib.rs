pub mod commands;
pub mod core;
pub mod platform;

use tauri::Manager;

use crate::commands::dock::DockGeometry;
use crate::core::settings::SettingsStore;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // A portable copy takes WebView2's profile with it. Left alone, WebView2
    // writes one under %LOCALAPPDATA% on whatever machine it was plugged into.
    #[cfg(windows)]
    if let Some(dir) = core::paths::webview_dir() {
        let _ = std::fs::create_dir_all(&dir);
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &dir);
    }

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
            commands::system_cmd::start_poller(handle.clone());
            setup_tray(app)?;

            // honor the taskbar preference from the last session, and if it
            // is off, force the taskbar back: a previous crash while hidden
            // must not leave the user without one
            if app.state::<SettingsStore>().get().hide_taskbar {
                platform::windows::taskbar::set_taskbar_autohide(true);
            } else {
                platform::windows::taskbar::restore_taskbar();
            }
            commands::apps::warm_app_cache();
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
            commands::settings::export_settings_file,
            commands::settings::import_settings,
            commands::settings::open_settings,
            commands::settings::storage_info,
            commands::apps::list_apps,
            commands::apps::resolve_icons,
            commands::apps::launch,
            commands::apps::launch_as_admin,
            commands::apps::open_file_location,
            commands::apps::resolve_drop,
            commands::apps::list_folder,
            commands::apps::list_recent_files,
            commands::dock::resize_dock,
            commands::dock::list_monitors,
            commands::dock::set_dock_focusable,
            commands::dock::set_taskbar_hidden,
            commands::dock::quit_app,
            commands::windows_cmd::get_running,
            commands::windows_cmd::activate_window,
            commands::windows_cmd::minimize_window,
            commands::windows_cmd::close_window,
            commands::windows_cmd::show_window_previews,
            commands::windows_cmd::hide_window_previews,
            commands::system_cmd::get_system_status,
            commands::system_cmd::set_volume,
            commands::system_cmd::open_recycle_bin,
            commands::system_cmd::empty_recycle_bin,
            commands::system_cmd::get_wallpaper_accent,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Aero Dock")
        .run(|_app, event| {
            // leaving? give the user their taskbar back
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // always restore, not only when the pref is on: the user may
                // have toggled it off mid-session without the bar coming back
                platform::windows::taskbar::restore_taskbar();
            }
        });
}

/// Tray icon: the dock's home base. Left-click toggles dock visibility;
/// the menu covers show/hide, settings, and quit.
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let toggle = MenuItem::with_id(app, "toggle", "Show/hide dock", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Aero Dock", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&toggle, &settings, &separator, &quit])?;

    fn toggle_dock(app: &tauri::AppHandle) {
        if let Some(w) = app.get_webview_window("dock") {
            match w.is_visible() {
                Ok(true) => {
                    let _ = w.hide();
                }
                _ => {
                    let _ = w.show();
                }
            }
        }
    }

    TrayIconBuilder::with_id("aero-dock-tray")
        .icon(
            app.default_window_icon()
                .expect("bundle has a default icon")
                .clone(),
        )
        .tooltip("Aero Dock (right-click for menu)")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => toggle_dock(app),
            "settings" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = commands::settings::open_settings(app).await {
                        log::error!("open settings from tray failed: {e}");
                    }
                });
            }
            "quit" => commands::dock::quit_app(app.clone()),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_dock(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
