/**
 * Theme applier: projects settings onto CSS custom properties.
 * Components never read settings for styling — they read tokens.
 * (Named color themes land with the theme engine; numeric/appearance
 * tokens are fully wired already.)
 */

import type { Settings } from "../../ipc/types";

export function applyAppearance(settings: Settings): void {
  const root = document.documentElement.style;
  const a = settings.appearance;
  const d = settings.dock;

  root.setProperty("--icon-size", `${d.iconSize}px`);
  root.setProperty("--dock-opacity", String(a.transparency));
  root.setProperty("--glass-intensity", String(a.glassIntensity));
  root.setProperty("--bloom-amount", String(a.bloomAmount));
  root.setProperty("--reflection-strength", String(a.reflectionStrength));
  root.setProperty("--anim-speed", String(a.animationSpeed));
}
