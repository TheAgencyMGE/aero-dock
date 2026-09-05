/**
 * True while Explorer is dragging files over the dock window.
 *
 * Auto-hide reads this: sliding the dock away mid-drag is the one moment
 * where hiding actively fights the user, because they are aiming at it.
 */

import { create } from "zustand";

interface DragState {
  /** A file drag is currently over the dock. */
  overDock: boolean;
  setOverDock: (over: boolean) => void;
}

export const useFileDrag = create<DragState>((set) => ({
  overDock: false,
  setOverDock: (overDock) => set({ overDock }),
}));
