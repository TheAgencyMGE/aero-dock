/**
 * Every spring in Aero Dock is defined here so the whole app's "feel"
 * is tuned from one file. Values chosen for soft, watery motion —
 * nothing snaps, nothing overshoots harshly.
 */

export const springs = {
  /** Icon magnification following the cursor. */
  magnify: { mass: 0.08, stiffness: 190, damping: 16 },
  /** Launch bounce: playful but quick to settle. */
  bounce: { type: "spring", stiffness: 320, damping: 13, mass: 0.6 } as const,
  /** Drag: icons feel like they're suspended in water. */
  drag: { stiffness: 260, damping: 22, mass: 0.5 },
  /** Neighbours getting out of the way during a reorder. Stiffer than
   * `drag` on purpose: the gap has to open before the cursor arrives,
   * or the drag reads as laggy even though the tile is tracking 1:1. */
  reorder: { type: "spring", stiffness: 520, damping: 38, mass: 0.4 } as const,
  /** Panels/menus blooming open. */
  bloom: { type: "spring", stiffness: 240, damping: 22, mass: 0.7 } as const,
  /** Dock slide for auto-hide. */
  slide: { type: "spring", stiffness: 210, damping: 26, mass: 0.8 } as const,
} as const;

/** Idle float: gentle vertical drift, phase-offset per icon. */
export const idleFloat = {
  amplitude: 1.6, // px
  period: 5.2, // seconds
};
