/**
 * Settings state: hydrated once from Rust, then kept in sync by the
 * `settings://changed` event. Mutations go through Rust and come back as
 * events, so this store never diverges from the persisted truth.
 */

import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { ipc } from "../ipc/commands";
import { EVENTS, type Settings } from "../ipc/types";

interface SettingsState {
  settings: Settings | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Apply a partial change on top of current settings and persist. */
  apply: (mutate: (draft: Settings) => void) => Promise<void>;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: null,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const settings = await ipc.getSettings();
    set({ settings, hydrated: true });
    await listen<Settings>(EVENTS.settingsChanged, (event) => {
      set({ settings: event.payload });
    });
  },

  apply: async (mutate) => {
    const current = get().settings;
    if (!current) return;
    const draft: Settings = structuredClone(current);
    mutate(draft);
    // optimistic update; the confirmed struct arrives via the event
    set({ settings: draft });
    await ipc.setSettings(draft);
  },
}));
