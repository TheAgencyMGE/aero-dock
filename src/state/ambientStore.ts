/**
 * Ambient-motion state: true while the dock has been left alone long
 * enough that decorative animation (float, sweep, dust) should pause.
 * Written by DockBar's interaction tracking; read by the effects layer.
 */

import { create } from "zustand";

interface AmbientState {
  asleep: boolean;
  setAsleep: (asleep: boolean) => void;
}

export const useAmbient = create<AmbientState>((set) => ({
  asleep: false,
  setAsleep: (asleep) => set({ asleep }),
}));
