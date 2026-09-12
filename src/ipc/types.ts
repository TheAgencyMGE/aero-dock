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
  /** Pointer-away delay before the dock slides out, in milliseconds. */
  autoHideDelayMs: number;
  floating: boolean;
  floatingMargin: number;
  showRunningApps: boolean;
  /** Built-in dock controls, each independently hideable. */
  showSearchButton: boolean;
  showSettingsButton: boolean;
  showClock: boolean;
  /** Battery, network, volume and Recycle Bin glyphs. */
  showSystemStatus: boolean;
}

/** How a surface is rendered. Both are Frutiger Aero; they differ in how
 *  thick the material reads. "aero" is the glossy beveled panel, "liquid"
 *  keeps the palette but renders as a thin lens. */
export type SurfaceStyle = "aero" | "liquid";

export interface AppearanceSettings {
  theme: string;
  transparency: number;
  glassIntensity: number;
  bloomAmount: number;
  reflectionStrength: number;
  particleDensity: number;
  scene: string;
  animationSpeed: number;
  wallpaperSync: boolean;
  /** Material for the dock, its flyouts and its controls. */
  dockSurface: SurfaceStyle;
  /** Material for the settings window, independent of the dock. */
  settingsSurface: SurfaceStyle;
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

/** One app's remembered audio inside a mode. */
export interface AppAudioPref {
  exe: string;
  volume: number;
  muted: boolean;
  deviceId: string | null;
}

export type WindowState = "normal" | "minimized" | "maximized";

export interface SnapRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface WindowSnapshot {
  exe: string;
  title: string;
  aumid: string | null;
  monitor: string;
  rect: SnapRect;
  state: WindowState;
}

export interface WorkspaceSnapshot {
  windows: WindowSnapshot[];
  /** Unix seconds. 0 means nothing has been saved yet. */
  capturedAt: number;
}

/** One saved way of working: its own pins, layout and per-app audio. */
export interface DockMode {
  id: string;
  name: string;
  glyph: string;
  pinned: PinnedItem[];
  audio: AppAudioPref[];
  workspace: WorkspaceSnapshot;
  autoSwitchApps: string[];
}

export interface ModesSettings {
  enabled: boolean;
  activeId: string;
  modes: DockMode[];
  autoSwitch: boolean;
  restoreWorkspaceOnSwitch: boolean;
}

export interface Settings {
  schemaVersion: number;
  dock: DockSettings;
  appearance: AppearanceSettings;
  pinned: PinnedItem[];
  launchAtStartup: boolean;
  hideTaskbar: boolean;
  onboardingComplete: boolean;
  modes: ModesSettings;
}

export interface AppEntry {
  name: string;
  shortcutPath: string | null;
  targetPath: string;
  args: string;
  icon: string | null;
  source: "start-menu" | "desktop" | "folder" | "apps-folder";
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
  /** AppUserModelID for UWP windows (hosted by ApplicationFrameHost). */
  aumid: string | null;
}

export interface RunningSnapshot {
  windows: WindowInfo[];
  focused: number;
}

export interface RecentFile {
  name: string;
  path: string;
  icon: string;
  usedAt: number;
}

export interface SystemStatus {
  battery: { present: boolean; percent: number; charging: boolean };
  internet: boolean;
  volume: { available: boolean; level: number; muted: boolean };
  recycleBin: { items: number; bytes: number };
}

/** One app in the Windows volume mixer, rolled up across its sessions. */
export interface AppAudio {
  exe: string;
  path: string;
  name: string;
  /** 0..=100 */
  volume: number;
  muted: boolean;
  sessions: number;
}

/** An output endpoint an app can be sent to. */
export interface AudioDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

/** What a mode switch managed to do. */
export interface SwitchReport {
  modeId: string;
  modeName: string;
  audioApplied: number;
  windowsMoved: number;
  appsLaunched: number;
  settings: Settings;
}

/** What a workspace restore managed to do. */
export interface RestoreReport {
  moved: number;
  launched: number;
  missing: number;
}

/** Windows has no public per-app routing API; this says what happened. */
export interface OutputChoice {
  exe: string;
  deviceId: string | null;
  openedSettings: boolean;
}

/** Where this copy keeps settings.json and the icon cache. */
export interface StorageInfo {
  portable: boolean;
  dataDir: string;
}

/** Event channel names pushed from Rust. */
export const EVENTS = {
  settingsChanged: "settings://changed",
  runningChanged: "apps://running-changed",
  systemStatus: "system://status",
} as const;
