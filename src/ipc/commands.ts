/**
 * Typed bindings for every Rust command. This file is the only place in
 * the frontend allowed to call `invoke` directly.
 */

import { invoke } from "@tauri-apps/api/core";
import type { AppEntry, MonitorInfoEx, PinnedItem, Settings } from "./types";

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

  // dock window
  resizeDock: (width: number, height: number) =>
    invoke<void>("resize_dock", { width, height }),
  listMonitors: () => invoke<MonitorInfoEx[]>("list_monitors"),
};
