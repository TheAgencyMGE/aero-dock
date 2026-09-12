/**
 * Theme applier: projects settings (named theme + numeric appearance)
 * onto CSS custom properties. Components never read settings for
 * styling — they read tokens.
 */

import type { Settings } from "../../ipc/types";
import { themeById, THEMED_TOKENS } from "./themes";

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Which window is being styled. The two carry their own material, so
 *  the caller has to say which one it is. */
export type SurfaceTarget = "dock" | "settings";

export function applyAppearance(
  settings: Settings,
  wallpaperAccent?: string | null,
  target: SurfaceTarget = "dock",
): void {
  const root = document.documentElement.style;
  const a = settings.appearance;
  const d = settings.dock;

  // The material is an attribute rather than a token because it swaps a
  // whole block of tokens at once, plus the shape of the gloss layer.
  document.documentElement.dataset.surface =
    target === "settings" ? a.settingsSurface : a.dockSurface;
  // The two windows composite differently, so a material has to know
  // which one it is in. See surfaces.css for why that matters.
  document.documentElement.dataset.window = target;

  // named theme: clear all theme-managed tokens, then set overrides
  const theme = themeById(a.theme);
  for (const token of THEMED_TOKENS) root.removeProperty(token);
  for (const [token, value] of Object.entries(theme.tokens)) {
    root.setProperty(token, value);
  }

  // wallpaper sync tints the accent + light colors on top of any theme
  if (a.wallpaperSync && wallpaperAccent) {
    const rgb = hexToRgb(wallpaperAccent);
    if (rgb) {
      const [r, g, b] = rgb;
      // lighten toward white for the bloom so it still reads as light
      const lr = Math.round(r + (255 - r) * 0.55);
      const lg = Math.round(g + (255 - g) * 0.55);
      const lb = Math.round(b + (255 - b) * 0.55);
      root.setProperty("--aero-accent", wallpaperAccent);
      root.setProperty("--bloom-color", `rgba(${lr}, ${lg}, ${lb}, 0.9)`);
      root.setProperty("--bloom-soft", `rgba(${lr}, ${lg}, ${lb}, 0.35)`);
      root.setProperty("--ambient-glow", `rgba(${r}, ${g}, ${b}, 0.28)`);
      root.setProperty(
        "--glass-tint-bottom",
        `rgba(${Math.round(r * 0.75)}, ${Math.round(g * 0.85)}, ${Math.round(b * 0.95)}, 0.3)`,
      );
    }
  }

  // numeric appearance tokens
  root.setProperty("--icon-size", `${d.iconSize}px`);
  root.setProperty("--dock-opacity", String(a.transparency));
  root.setProperty("--glass-intensity", String(a.glassIntensity));
  root.setProperty("--bloom-amount", String(a.bloomAmount));
  root.setProperty("--reflection-strength", String(a.reflectionStrength));
  root.setProperty("--anim-speed", String(a.animationSpeed));
}
