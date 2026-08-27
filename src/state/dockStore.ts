/**
 * Dock view model: pinned items (from settings) merged with live running
 * windows, plus resolved icon URLs. Icons live in an on-disk PNG cache on
 * the Rust side; here we only hold `target path -> asset URL` so <img>
 * elements load them directly with zero IPC per render.
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { create } from "zustand";
import { ipc } from "../ipc/commands";
import type { PinnedItem, WindowInfo } from "../ipc/types";
import { exeDisplayName, targetKey, windowsByExe } from "./runningStore";

export interface DockItemView {
  id: string;
  name: string;
  target: string;
  args?: string;
  kind: PinnedItem["kind"];
  iconSrc: string | null;
  children: PinnedItem[];
  /** Resolved icon URLs for stack children (parallel to children). */
  childIcons: (string | null)[];
  pinned: boolean;
  /** Open windows belonging to this app (empty = not running). */
  windows: WindowInfo[];
  /** One of this app's windows is foreground. */
  focused: boolean;
}

interface IconState {
  /** target path -> asset:// URL of the cached PNG */
  iconUrls: Record<string, string>;
  /** targets currently being resolved (dedupes in-flight work) */
  pendingIcons: Set<string>;
  resolveIcons: (targets: string[]) => Promise<void>;
}

export const useDockIcons = create<IconState>((set, get) => ({
  iconUrls: {},
  pendingIcons: new Set(),

  resolveIcons: async (targets) => {
    const { iconUrls, pendingIcons } = get();
    const missing = targets.filter((t) => t && !(t in iconUrls) && !pendingIcons.has(t));
    if (missing.length === 0) return;

    set({ pendingIcons: new Set([...pendingIcons, ...missing]) });
    try {
      const resolved = await ipc.resolveIcons(missing);
      const urls: Record<string, string> = {};
      for (const [target, path] of Object.entries(resolved)) {
        urls[target] = convertFileSrc(path);
      }
      set((s) => ({ iconUrls: { ...s.iconUrls, ...urls } }));
    } catch (e) {
      // a missing icon is cosmetic (the initial-letter glyph stands in);
      // never let it reject into the caller's render effect
      console.warn("icon resolution failed", e);
    } finally {
      set((s) => {
        const pending = new Set(s.pendingIcons);
        for (const t of missing) pending.delete(t);
        return { pendingIcons: pending };
      });
    }
  },
}));

/**
 * Build the dock model: pinned items in user order (with live window
 * state attached), then one icon per running-but-unpinned app.
 */
export function buildDockItems(
  pinned: PinnedItem[],
  runningWindows: WindowInfo[],
  focused: number,
  iconUrls: Record<string, string>,
  showRunningApps: boolean,
): DockItemView[] {
  const byExe = windowsByExe(runningWindows);
  const pinnedTargets = new Set(
    pinned.filter((p) => p.path).map((p) => targetKey(p.path)),
  );

  const items: DockItemView[] = pinned.map((p) => {
    const windows = p.path ? (byExe.get(targetKey(p.path)) ?? []) : [];
    return {
      id: p.id,
      name: p.name,
      target: p.path,
      kind: p.kind,
      iconSrc: p.path ? (iconUrls[p.path] ?? null) : null,
      children: p.children,
      childIcons: p.children.map((c) => (c.path ? (iconUrls[c.path] ?? null) : null)),
      pinned: true,
      windows,
      focused: windows.some((w) => w.hwnd === focused),
    };
  });

  if (showRunningApps) {
    for (const [key, windows] of byExe) {
      if (pinnedTargets.has(key)) continue;
      const first = windows[0];
      // UWP windows launch (and icon-resolve) through their AUMID
      const target = first.aumid ? `shell:AppsFolder\\${first.aumid}` : first.exe;
      items.push({
        id: `run-${key}`,
        name: windows.length === 1 ? first.title : exeDisplayName(first.exe),
        target,
        kind: "app",
        iconSrc: iconUrls[target] ?? null,
        children: [],
        childIcons: [],
        pinned: false,
        windows,
        focused: windows.some((w) => w.hwnd === focused),
      });
    }
  }

  return items;
}
