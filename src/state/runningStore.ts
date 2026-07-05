/**
 * Live running-window state, pushed from the Rust shell-hook tracker.
 * Hydrates once from `get_running`, then stays current via events.
 */

import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { ipc } from "../ipc/commands";
import { EVENTS, type RunningSnapshot, type WindowInfo } from "../ipc/types";

interface RunningState {
  windows: WindowInfo[];
  focused: number;
  hydrated: boolean;
  hydrate: () => Promise<void>;
}

export const useRunning = create<RunningState>((set, get) => ({
  windows: [],
  focused: 0,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    set({ hydrated: true });
    await listen<RunningSnapshot>(EVENTS.runningChanged, (event) => {
      set({ windows: event.payload.windows, focused: event.payload.focused });
    });
    const snap = await ipc.getRunning();
    set({ windows: snap.windows, focused: snap.focused });
  },
}));

const APPS_FOLDER_PREFIX = "shell:appsfolder\\";

/** Identity key for a window: AUMID for packaged apps (their exe is
 * always ApplicationFrameHost), exe path otherwise. */
export function windowKey(w: WindowInfo): string {
  return w.aumid ? `aumid:${w.aumid.toLowerCase()}` : w.exe.toLowerCase();
}

/** Identity key for a launch target (pinned item / app entry). */
export function targetKey(path: string): string {
  const lower = path.toLowerCase();
  return lower.startsWith(APPS_FOLDER_PREFIX)
    ? `aumid:${lower.slice(APPS_FOLDER_PREFIX.length)}`
    : lower;
}

/** Group windows by app identity (AUMID or exe). */
export function windowsByExe(windows: WindowInfo[]): Map<string, WindowInfo[]> {
  const map = new Map<string, WindowInfo[]>();
  for (const w of windows) {
    const key = windowKey(w);
    const list = map.get(key);
    if (list) list.push(w);
    else map.set(key, [w]);
  }
  return map;
}

/** Human name for an unpinned running app: exe basename, title-cased. */
export function exeDisplayName(exe: string): string {
  const base = exe.split("\\").pop() ?? exe;
  const stem = base.replace(/\.exe$/i, "");
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}
