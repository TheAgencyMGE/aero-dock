/**
 * Per-app volume as the dock sees it.
 *
 * Scrolling has to feel like a hardware knob, so every change is applied
 * to local state first and the IPC result reconciles afterwards. Rust
 * owns the arithmetic (it reads the live session, steps, and writes) so
 * a fast burst of wheel events cannot compound off a stale value; the
 * optimistic number here is only what the indicator draws until the real
 * one lands.
 */

import { create } from "zustand";
import { ipc } from "../ipc/commands";
import type { AppAudio } from "../ipc/types";

/** Mirrors `core::names::exe_key` on the Rust side. */
export function exeKey(path: string): string {
  const parts = path.split(/[\\/]/);
  return (parts[parts.length - 1] || path).toLowerCase();
}

/** How long the indicator stays up after the last change. */
const INDICATOR_MS = 1400;

/** One wheel notch, mirroring `commands::audio::SCROLL_STEP`. */
const STEP = 4;

interface AudioState {
  /** exe key -> last known mixer entry. */
  levels: Record<string, AppAudio>;
  /** exe key -> timestamp the indicator should stay visible until. */
  showUntil: Record<string, number>;
  /** Bumped whenever an indicator expires, to re-render the dock. */
  tick: number;

  refresh: () => Promise<void>;
  /** Positive notches scroll up. Returns false when nothing is playing. */
  nudge: (exe: string, notches: number) => Promise<boolean>;
  toggleMute: (exe: string) => Promise<boolean>;
  setLevel: (exe: string, level: number) => Promise<void>;
  /** True while this app's indicator should be drawn. */
  isVisible: (exe: string) => boolean;
}

let expiryTimer: ReturnType<typeof setTimeout> | undefined;

export const useAppAudio = create<AudioState>((set, get) => {
  /** Keep the indicator up, and schedule the re-render that hides it. */
  const flash = (key: string) => {
    set((s) => ({ showUntil: { ...s.showUntil, [key]: Date.now() + INDICATOR_MS } }));
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => set((s) => ({ tick: s.tick + 1 })), INDICATOR_MS + 60);
  };

  /** Fold a fresh reading in, or drop the app when it stopped playing. */
  const settle = (key: string, entry: AppAudio | null) => {
    set((s) => {
      const levels = { ...s.levels };
      if (entry) {
        levels[entry.exe] = entry;
      } else {
        delete levels[key];
      }
      return { levels };
    });
  };

  return {
    levels: {},
    showUntil: {},
    tick: 0,

    refresh: async () => {
      try {
        const apps = await ipc.listAppAudio();
        const levels: Record<string, AppAudio> = {};
        for (const a of apps) levels[a.exe] = a;
        set({ levels });
      } catch (e) {
        // audio is a convenience; never let a mixer hiccup break the dock
        console.warn("app audio refresh failed", e);
      }
    },

    nudge: async (exe, notches) => {
      const key = exeKey(exe);
      const current = get().levels[key];
      if (!current) {
        // nothing known yet: ask Rust, which answers null when silent
        const entry = await ipc.nudgeAppVolume(exe, notches).catch(() => null);
        if (entry) {
          settle(key, entry);
          flash(key);
        }
        return entry !== null;
      }
      // optimistic: draw the new level this frame
      const optimistic = Math.min(100, Math.max(0, current.volume + notches * STEP));
      set((s) => ({
        levels: {
          ...s.levels,
          [key]: {
            ...current,
            volume: optimistic,
            muted: notches > 0 ? false : current.muted,
          },
        },
      }));
      flash(key);
      try {
        settle(key, await ipc.nudgeAppVolume(exe, notches));
      } catch (e) {
        console.warn("volume nudge failed", e);
        settle(key, current);
      }
      return true;
    },

    toggleMute: async (exe) => {
      const key = exeKey(exe);
      const current = get().levels[key];
      if (current) {
        set((s) => ({
          levels: { ...s.levels, [key]: { ...current, muted: !current.muted } },
        }));
        flash(key);
      }
      try {
        const entry = await ipc.toggleAppMute(exe);
        settle(key, entry);
        if (entry) flash(key);
        return entry !== null;
      } catch (e) {
        console.warn("mute toggle failed", e);
        if (current) settle(key, current);
        return false;
      }
    },

    setLevel: async (exe, level) => {
      const key = exeKey(exe);
      flash(key);
      try {
        settle(key, await ipc.setAppAudio(exe, level));
      } catch (e) {
        console.warn("volume set failed", e);
      }
    },

    isVisible: (exe) => {
      const until = get().showUntil[exeKey(exe)];
      return until !== undefined && until > Date.now();
    },
  };
});
