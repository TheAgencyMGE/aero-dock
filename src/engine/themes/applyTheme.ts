/**
 * Theme applier: projects settings (named theme + numeric appearance)
 * onto CSS custom properties. Components never read settings for
 * styling — they read tokens.
 */

import type { Settings } from "../../ipc/types";
import { themeById, THEMED_TOKENS } from "./themes";

export function applyAppearance(settings: Settings): void {
  const root = document.documentElement.style;
  const a = settings.appearance;
  const d = settings.dock;

  // named theme: clear all theme-managed tokens, then set overrides
  const theme = themeById(a.theme);
  for (const token of THEMED_TOKENS) root.removeProperty(token);
  for (const [token, value] of Object.entries(theme.tokens)) {
    root.setProperty(token, value);
  }

  // numeric appearance tokens
  root.setProperty("--icon-size", `${d.iconSize}px`);
  root.setProperty("--dock-opacity", String(a.transparency));
  root.setProperty("--glass-intensity", String(a.glassIntensity));
  root.setProperty("--bloom-amount", String(a.bloomAmount));
  root.setProperty("--reflection-strength", String(a.reflectionStrength));
  root.setProperty("--anim-speed", String(a.animationSpeed));
}
