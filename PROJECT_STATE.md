# Aero Dock — Project State

> Source of truth for build progress. Update after every completed module.
> New sessions: read this file + docs/ARCHITECTURE.md first, then continue.

## Status: Foundation phase

### Environment
- Windows 11, VS2022 Community (MSVC toolchain present)
- Rust 1.96.1 (stable-x86_64-pc-windows-msvc), Node 22.12, pnpm 10.23
- Tauri 2.11 / React 19 / Vite 7 / TS 5.8 scaffold at repo root

### Completed
- [x] Toolchain installed and verified
- [x] Project scaffolded (create-tauri-app react-ts), git initialized
- [x] docs/ARCHITECTURE.md written
- [x] Build baseline: tauri.conf dock window (transparent/undecorated/on-top),
      crates (windows 0.62, plugins), frontend deps (motion, pixi, zustand)
- [x] core/error.rs — AeroError unified error type
- [x] core/settings.rs — settings engine, atomic persist, events, 4 unit tests
- [x] platform/windows: apps.rs (.lnk enumeration), icons.rs (IShellItemImageFactory
      → PNG cache), monitors.rs (work areas + DPI), dock_window.rs (toolwindow styles)
- [x] commands: settings, apps (list/resolve_icons/launch), dock (resize/position, 2 tests)
- [x] lib.rs wiring: single-instance, autostart plugins, dock styling on setup
- [x] Frontend: ipc/types+commands, settingsStore, dockStore, tokens.css,
      global.css (glass material), DockBar + DockIcon (magnification, bounce,
      idle float, tooltips, reflections), DockApp (hydrate, first-run import)
- [x] cargo test green (6 tests), pnpm build green

### In progress
- [ ] First live dev run + visual verification

### Backlog (task list mirrors this)
1. Settings engine (Rust core/settings.rs)
2. App enumeration + icon extraction (platform/windows)
3. Running-apps tracker (WinEvent hooks)
4. Dock UI foundation (glass bar, magnification, launch)
5. Effects engine (PixiJS: bloom, ripple, burst, dust)
6. System widgets (clock, battery, network, volume, recycle bin)
7. Pinning, drag reorder, folders, context menus
8. Settings window + theme engine + wallpaper sync
9. Search, recent files, window previews, onboarding, tray, installer

### Decisions log
- 2026-07-01: Stack locked: Tauri v2 + React 19 + Vite + motion + PixiJS + zustand.
- 2026-07-01: Icons cached as PNG on disk, served via asset protocol (not base64 IPC).
- 2026-07-01: All ambient animation on one rAF driver; Pixi ticker stops at idle.
- 2026-07-01: Settings = single versioned JSON struct, atomic writes, full-struct
  change events.

### Known constraints
- WebView2 transparency works with `"transparent": true` + undecorated window.
- COM calls need CoInitializeEx-per-thread; keep them off the main async pool.
