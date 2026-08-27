/**
 * Flyout state (context menu / folder grid). One flyout at a time,
 * anchored to the icon that spawned it. The dock window grows
 * (transparently) to make room — see DockBar's window-size math.
 */

import { create } from "zustand";
import type { DockEdge } from "../../ipc/types";
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

/**
 * Where a flyout of a given width should sit relative to its anchor, for
 * whichever edge the dock is glued to. Offsets are measured from the
 * dock's screen edge, which stays put when the window grows to make
 * room — so a style computed here survives that growth.
 *
 * `maxHeight` (when known) keeps side-edge flyouts inside the window.
 */
export function flyoutStyle(
  edge: DockEdge,
  anchor: MenuAnchor,
  width: number,
  gap = 12,
  maxHeight = 0,
): React.CSSProperties {
  const style: React.CSSProperties = { position: "absolute", width, zIndex: 100 };
  // when the window is narrower than the flyout, hug the left edge
  // rather than letting the clamp go negative
  const alongMain = Math.max(8, Math.min(anchor.cx - width / 2, anchor.winW - width - 8));
  const alongCross = maxHeight
    ? Math.max(8, Math.min(anchor.cy - 90, anchor.winH - maxHeight - 8))
    : Math.max(8, anchor.cy - 90);

  switch (edge) {
    case "bottom":
      style.left = alongMain;
      style.bottom = anchor.winH - anchor.top + gap;
      break;
    case "top":
      style.left = alongMain;
      style.top = anchor.bottom + gap;
      break;
    case "left":
      style.left = anchor.right + gap;
      style.top = alongCross;
      break;
    case "right":
      style.right = anchor.winW - anchor.left + gap;
      style.top = alongCross;
      break;
  }
  return style;
}

/** Entrance offset for a flyout blooming out from the given edge. */
export function bloomOffset(edge: DockEdge): { x: number; y: number } {
  switch (edge) {
    case "bottom":
      return { x: 0, y: 12 };
    case "top":
      return { x: 0, y: -12 };
    case "left":
      return { x: -12, y: 0 };
    case "right":
      return { x: 12, y: 0 };
  }
}

/**
 * A panel centered on the dock and pushed clear of it (search overlay,
 * welcome card). Centering rides on the CSS `translate` property rather
 * than `transform`, because motion owns `transform` for the entrance
 * animation and an inline transform would silently drop the centering.
 */
export function edgePanelStyle(edge: DockEdge, offset: string): React.CSSProperties {
  const vertical = edge === "left" || edge === "right";
  const style: React.CSSProperties = {
    position: "absolute",
    translate: vertical ? "0 -50%" : "-50% 0",
    transformOrigin: {
      bottom: "bottom center",
      top: "top center",
      left: "center left",
      right: "center right",
    }[edge],
  };
  if (vertical) {
    style.top = "50%";
    if (edge === "left") style.left = offset;
    else style.right = offset;
  } else {
    style.left = "50%";
    if (edge === "top") style.top = offset;
    else style.bottom = offset;
  }
  return style;
}
