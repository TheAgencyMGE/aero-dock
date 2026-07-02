/**
 * TypeScript mirrors of the Rust IPC types (src-tauri/src/core/settings.rs,
 * platform/mod.rs, platform/windows/monitors.rs). Keep both sides in sync
 * in the same change, always.
 */

export type DockEdge = "top" | "bottom" | "left" | "right";

export interface DockSettings {
  edge: DockEdge;
  monitor: string | null;
  iconSize: number;
  magnification: boolean;
  magnificationScale: number;
  autoHide: boolean;
  floating: boolean;
  floatingMargin: number;
  showRunningApps: boolean;
}

export interface AppearanceSettings {
  theme: string;
  transparency: number;
  glassIntensity: number;
  bloomAmount: number;
  reflectionStrength: number;
  particleDensity: number;
  animationSpeed: number;
  wallpaperSync: boolean;
}

export type PinKind = "app" | "file" | "folder" | "stack";

export interface PinnedItem {
  id: string;
  kind: PinKind;
  path: string;
  name: string;
  icon: string | null;
  children: PinnedItem[];
}

export interface Settings {
  schemaVersion: number;
  dock: DockSettings;
  appearance: AppearanceSettings;
  pinned: PinnedItem[];
  launchAtStartup: boolean;
  onboardingComplete: boolean;
}

export interface AppEntry {
  name: string;
  shortcutPath: string | null;
  targetPath: string;
  args: string;
  icon: string | null;
  source: "start-menu" | "desktop" | "folder";
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MonitorInfoEx {
  name: string;
  bounds: Rect;
  workArea: Rect;
  scale: number;
  isPrimary: boolean;
}

export interface WindowInfo {
  hwnd: number;
  title: string;
  exe: string;
  pid: number;
}

export interface RunningSnapshot {
  windows: WindowInfo[];
  focused: number;
}

export interface SystemStatus {
  battery: { present: boolean; percent: number; charging: boolean };
  internet: boolean;
  volume: { available: boolean; level: number; muted: boolean };
  recycleBin: { items: number; bytes: number };
}

/** Event channel names pushed from Rust. */
export const EVENTS = {
  settingsChanged: "settings://changed",
  runningChanged: "apps://running-changed",
  systemStatus: "system://status",
} as const;
