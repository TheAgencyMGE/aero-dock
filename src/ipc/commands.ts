/**
 * Typed bindings for every Rust command. This file is the only place in
 * the frontend allowed to call `invoke` directly.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  AppAudio,
  AppEntry,
  AudioDevice,
  MonitorInfoEx,
  OutputChoice,
  PinnedItem,
  RecentFile,
  RestoreReport,
  RunningSnapshot,
  Settings,
  StorageInfo,
  SwitchReport,
  SystemStatus,
} from "./types";

export const ipc = {
  // settings
  getSettings: () => invoke<Settings>("get_settings"),
  setSettings: (settings: Settings) => invoke<Settings>("set_settings", { settings }),
  pinItem: (item: PinnedItem, index?: number) =>
    invoke<Settings>("pin_item", { item, index: index ?? null }),
  unpinItem: (id: string) => invoke<Settings>("unpin_item", { id }),
  reorderPinned: (ids: string[]) => invoke<Settings>("reorder_pinned", { ids }),
  firstRunImport: (items: PinnedItem[]) =>
    invoke<Settings>("first_run_import", { items }),
  exportSettings: () => invoke<string>("export_settings"),
  exportSettingsFile: () => invoke<string>("export_settings_file"),
  importSettings: (json: string) => invoke<Settings>("import_settings", { json }),
  openSettings: () => invoke<void>("open_settings"),
  storageInfo: () => invoke<StorageInfo>("storage_info"),
  quitApp: () => invoke<void>("quit_app"),

  // apps
  listApps: () => invoke<AppEntry[]>("list_apps"),
  resolveIcons: (targets: string[]) =>
    invoke<Record<string, string>>("resolve_icons", { targets }),
  launch: (target: string, args?: string) =>
    invoke<void>("launch", { target, args: args || null }),
  launchAsAdmin: (target: string, args?: string) =>
    invoke<void>("launch_as_admin", { target, args: args || null }),
  openFileLocation: (target: string) =>
    invoke<void>("open_file_location", { target }),
  resolveDrop: (path: string) => invoke<AppEntry>("resolve_drop", { path }),
  listRecentFiles: (limit?: number) =>
    invoke<RecentFile[]>("list_recent_files", { limit: limit ?? null }),
  setDockFocusable: (focusable: boolean) =>
    invoke<void>("set_dock_focusable", { focusable }),
  setTaskbarHidden: (hidden: boolean) =>
    invoke<void>("set_taskbar_hidden", { hidden }),
  listFolder: (path: string, limit?: number) =>
    invoke<{ name: string; path: string; isDir: boolean }[]>("list_folder", {
      path,
      limit: limit ?? null,
    }),

  // running windows
  getRunning: () => invoke<RunningSnapshot>("get_running"),
  activateWindow: (hwnd: number) => invoke<void>("activate_window", { hwnd }),
  minimizeWindow: (hwnd: number) => invoke<void>("minimize_window", { hwnd }),
  closeWindow: (hwnd: number) => invoke<void>("close_window", { hwnd }),

  // system widgets
  getSystemStatus: () => invoke<SystemStatus>("get_system_status"),
  setVolume: (level?: number, mute?: boolean) =>
    invoke<void>("set_volume", { level: level ?? null, mute: mute ?? null }),
  openRecycleBin: () => invoke<void>("open_recycle_bin"),
  emptyRecycleBin: () => invoke<void>("empty_recycle_bin"),
  getWallpaperAccent: () => invoke<string>("get_wallpaper_accent"),

  // window previews (DWM thumbnails, physical px in dock client area)
  showWindowPreviews: (
    slots: { hwnd: number; x: number; y: number; w: number; h: number }[],
  ) => invoke<void>("show_window_previews", { slots }),
  hideWindowPreviews: () => invoke<void>("hide_window_previews"),

  // per-app audio
  listAppAudio: () => invoke<AppAudio[]>("list_app_audio"),
  getAppAudio: (exe: string) => invoke<AppAudio | null>("get_app_audio", { exe }),
  setAppAudio: (exe: string, level?: number, mute?: boolean) =>
    invoke<AppAudio | null>("set_app_audio", {
      exe,
      level: level ?? null,
      mute: mute ?? null,
    }),
  /** Positive notches scroll the volume up. */
  nudgeAppVolume: (exe: string, notches: number) =>
    invoke<AppAudio | null>("nudge_app_volume", { exe, notches }),
  toggleAppMute: (exe: string) => invoke<AppAudio | null>("toggle_app_mute", { exe }),
  listAudioDevices: () => invoke<AudioDevice[]>("list_audio_devices"),
  setAppOutputDevice: (exe: string, deviceId: string | null, openSettings: boolean) =>
    invoke<OutputChoice>("set_app_output_device", { exe, deviceId, openSettings }),

  // modes
  enableModes: (enabled: boolean) => invoke<Settings>("enable_modes", { enabled }),
  createMode: (name: string, glyph: string | null, copyCurrentPins: boolean) =>
    invoke<Settings>("create_mode", { name, glyph, copyCurrentPins }),
  renameMode: (id: string, name: string, glyph: string | null) =>
    invoke<Settings>("rename_mode", { id, name, glyph }),
  deleteMode: (id: string) => invoke<Settings>("delete_mode", { id }),
  switchMode: (id: string) => invoke<SwitchReport>("switch_mode", { id }),
  captureWorkspace: (modeId?: string) =>
    invoke<Settings>("capture_workspace", { modeId: modeId ?? null }),
  restoreWorkspace: (modeId?: string) =>
    invoke<RestoreReport>("restore_workspace", { modeId: modeId ?? null }),
  clearWorkspace: (modeId: string) => invoke<Settings>("clear_workspace", { modeId }),
  setModeApps: (modeId: string, apps: string[]) =>
    invoke<Settings>("set_mode_apps", { modeId, apps }),
  setAutoSwitch: (enabled: boolean) => invoke<Settings>("set_auto_switch", { enabled }),
  setRestoreWorkspaceOnSwitch: (enabled: boolean) =>
    invoke<Settings>("set_restore_workspace_on_switch", { enabled }),
  foregroundChanged: (exe: string) =>
    invoke<SwitchReport | null>("foreground_changed", { exe }),

  // dock window
  resizeDock: (width: number, height: number) =>
    invoke<void>("resize_dock", { width, height }),
  listMonitors: () => invoke<MonitorInfoEx[]>("list_monitors"),
};
