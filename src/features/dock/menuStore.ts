/**
 * Flyout state (context menu / folder grid). One flyout at a time,
 * anchored to the icon that spawned it. The dock window grows
 * (transparently) to make room — see DockBar's window-size math.
 */

import { create } from "zustand";
import type { DockItemView } from "../../state/dockStore";

export interface MenuAnchor {
  /** Icon bounding box in window coordinates, captured at click time. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  cx: number;
  cy: number;
  /** Window inner size at click time (window may grow afterwards). */
  winW: number;
  winH: number;
}

export type FlyoutKind = "menu" | "folder" | "windows" | "stack";

interface MenuState {
  kind: FlyoutKind;
  item: DockItemView | null;
  anchor: MenuAnchor | null;
  open: (kind: FlyoutKind, item: DockItemView, anchor: MenuAnchor) => void;
  close: () => void;
  /** Close soon unless something (re-entering the flyout) cancels it. */
  scheduleClose: (delayMs: number) => void;
  cancelScheduledClose: () => void;
}

let closeTimer: ReturnType<typeof setTimeout> | undefined;

export const useMenu = create<MenuState>((set) => ({
  kind: "menu",
  item: null,
  anchor: null,
  open: (kind, item, anchor) => {
    clearTimeout(closeTimer);
    set({ kind, item, anchor });
  },
  close: () => {
    clearTimeout(closeTimer);
    set({ item: null, anchor: null });
  },
  scheduleClose: (delayMs) => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => set({ item: null, anchor: null }), delayMs);
  },
  cancelScheduledClose: () => clearTimeout(closeTimer),
}));

/** Capture an icon's anchor box for flyout positioning. */
export function anchorFor(target: HTMLElement): MenuAnchor {
  const r = target.getBoundingClientRect();
  return {
    left: r.left,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    cx: r.left + r.width / 2,
    cy: r.top + r.height / 2,
    winW: window.innerWidth,
    winH: window.innerHeight,
  };
}
