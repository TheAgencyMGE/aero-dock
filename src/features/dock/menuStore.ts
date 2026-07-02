/**
 * Context menu state. One menu at a time, anchored to the icon that
 * spawned it. The dock window grows (transparently) to make room —
 * see DockBar's window-size math.
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

interface MenuState {
  item: DockItemView | null;
  anchor: MenuAnchor | null;
  open: (item: DockItemView, anchor: MenuAnchor) => void;
  close: () => void;
}

export const useMenu = create<MenuState>((set) => ({
  item: null,
  anchor: null,
  open: (item, anchor) => set({ item, anchor }),
  close: () => set({ item: null, anchor: null }),
}));
