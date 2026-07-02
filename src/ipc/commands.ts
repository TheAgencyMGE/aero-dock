/**
 * Typed bindings for every Rust command. This file is the only place in
 * the frontend allowed to call `invoke` directly.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  AppEntry,
  MonitorInfoEx,
  PinnedItem,
  RunningSnapshot,
  Settings,
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
  importSettings: (json: string) => invoke<Settings>("import_settings", { json }),

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

  // dock window
  resizeDock: (width: number, height: number) =>
    invoke<void>("resize_dock", { width, height }),
  listMonitors: () => invoke<MonitorInfoEx[]>("list_monitors"),
};
