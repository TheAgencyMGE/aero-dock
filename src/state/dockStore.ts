/**
 * Dock view model: pinned items (from settings) plus resolved icon URLs.
 * Icons live in an on-disk PNG cache on the Rust side; here we only hold
 * `target path -> asset URL` so <img> elements can load them directly.
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { create } from "zustand";
import { ipc } from "../ipc/commands";
import type { PinnedItem } from "../ipc/types";

export interface DockItemView {
  id: string;
  name: string;
  target: string;
  args?: string;
  kind: PinnedItem["kind"];
  iconSrc: string | null;
  children: PinnedItem[];
}

interface DockState {
  /** target path -> asset:// URL of the cached PNG */
  iconUrls: Record<string, string>;
  /** targets currently being resolved (dedupe in-flight work) */
  pendingIcons: Set<string>;
  resolveIcons: (targets: string[]) => Promise<void>;
}

export const useDockIcons = create<DockState>((set, get) => ({
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
    } finally {
      set((s) => {
        const pending = new Set(s.pendingIcons);
        for (const t of missing) pending.delete(t);
        return { pendingIcons: pending };
      });
    }
  },
}));

/** Merge pinned items with resolved icons into render-ready views. */
export function toDockItems(
  pinned: PinnedItem[],
  iconUrls: Record<string, string>,
): DockItemView[] {
  return pinned.map((p) => ({
    id: p.id,
    name: p.name,
    target: p.path,
    kind: p.kind,
    iconSrc: p.path ? (iconUrls[p.path] ?? null) : null,
    children: p.children,
  }));
}
