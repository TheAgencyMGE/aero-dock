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

- [x] Live dev run verified by screenshot: glass bar, real icons,
      magnification + tooltips, first-run import (atomic, StrictMode-safe)
- [x] Running-apps tracker: shell hook window (RegisterShellHookWindow) on
      own thread, live snapshots, activate (Alt trick) / minimize / close;
      dock shows divider + running-only apps + droplet indicators
- [x] Context menus (Aero glass, bloom open): open, run as admin, open
      file location, pin/unpin, minimize/close, window list
- [x] Drag reorder (Reorder.Group, springs), persists via reorder_pinned
- [x] Drop .lnk/.exe/folders from Explorer to pin (resolve_drop)
- [x] Folder flyout: glass grid, staggered bloom, list_folder command

### In progress
- [ ] Folder flyout visual verification

### Backlog (task list mirrors this)
5. Effects engine (PixiJS: bloom, ripple, burst, dust) — task #7
6. System widgets (clock, battery, network, volume, recycle bin) — #8
7. Settings window + theme engine + wallpaper sync — #10
8. Auto-hide with edge reveal — #12
9. Search, recent files, window previews, onboarding, tray, installer — #11

### Dev/debug infrastructure
- WebView console/DOM access: launch dev with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`,
  then `node <scratchpad>/cdp.mjs "<js>"` evaluates in the page.
- `withGlobalTauri: true` → `window.__TAURI__.core.invoke` for testing.
- Synthetic input via PowerShell mouse_event; screenshots via
  System.Drawing CopyFromScreen (see session scratchpad).

### Gotchas learned
- .glass sets position:relative — flyouts must inline position:absolute
  (vite HMR reorders stylesheets, CSS-order fixes are fragile).
- Window grows transparently (MENU_SPACE) to host flyouts; anchor math
  must be relative to the dock's screen edge, not window top-left.
- React StrictMode double-fires effects: any first-run/one-shot IPC needs
  an atomic idempotent Rust transaction.

### Decisions log
- 2026-07-01: Stack locked: Tauri v2 + React 19 + Vite + motion + PixiJS + zustand.
- 2026-07-01: Icons cached as PNG on disk, served via asset protocol (not base64 IPC).
- 2026-07-01: All ambient animation on one rAF driver; Pixi ticker stops at idle.
- 2026-07-01: Settings = single versioned JSON struct, atomic writes, full-struct
  change events.

### Known constraints
- WebView2 transparency works with `"transparent": true` + undecorated window.
- COM calls need CoInitializeEx-per-thread; keep them off the main async pool.
