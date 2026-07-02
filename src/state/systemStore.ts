/**
 * System status (battery, network, volume, recycle bin), pushed from
 * the Rust poller every 20s plus immediately after changes we make.
 */

import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { ipc } from "../ipc/commands";
import { EVENTS, type SystemStatus } from "../ipc/types";

interface SystemState {
  status: SystemStatus | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
}

export const useSystem = create<SystemState>((set, get) => ({
  status: null,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    set({ hydrated: true });
    await listen<SystemStatus>(EVENTS.systemStatus, (event) => {
      set({ status: event.payload });
    });
    try {
      set({ status: await ipc.getSystemStatus() });
    } catch (e) {
      console.error("system status hydrate failed", e);
    }
  },
}));
