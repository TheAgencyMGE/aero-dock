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

- [x] Folder flyout verified live (glass grid, staggered bloom, real icons)
- [x] Effects engine: PixiJS layer + bus; ClickRipple / LaunchBurst /
      DustField; edge-anchored coords (survive flyout window growth);
      ticker sleeps when nothing alive. Verified live.
- [x] System widgets: battery/network/volume(WASAPI)/recycle bin in Rust,
      20s poller + instant push; clock/date; scroll-volume, click-mute,
      bin open/empty. Verified live with real data.
- [x] Settings window (?window=settings route): theme swatches, dock
      position/size/magnification, glass sliders, autostart, export/import.
      open_settings MUST be async (sync deadlocks WebView2 creation).
- [x] Theme engine: 6 themes as token sets (themes.ts); cross-window
      live switch verified.
- [x] Wallpaper sync: SPI_GETDESKWALLPAPER + hue-bucket accent
      (load_from_memory — TranscodedWallpaper has no extension).
- [x] Auto-hide: slide out after 1.4s idle → shrink window to 8px strip;
      mouse contact reveals. Verified live.

- [x] Tray icon: left-click toggles dock; menu (show/hide, settings, quit)
- [x] Recent files (Recent folder .lnk resolution, mtime order)
- [x] Search overlay: apps + recent, keyboard-first; set_dock_focusable
      lifts WS_EX_NOACTIVATE while open. Verified live incl. typing.
- [x] Aero orb app icon generated (System.Drawing script in scratchpad),
      tauri icon set regenerated

- [x] Production build validated: NSIS installer builds clean
      (src-tauri/target/release/bundle/nsis/Aero Dock_0.1.0_x64-setup.exe,
      2.6 MB)
- [x] Perf pass: idle was ~84% CPU across webviews → now ~6% (dev mode).
      Fixes: icon float = CSS transform animation (was per-icon rAF),
      glass sweep = translated gradient layer (was background-position
      repainting the blur), Pixi capped 30fps when only dust alive, and
      ALL ambient motion sleeps after 45s idle (animation-play-state
      paused + ticker stop), waking instantly on hover. Verified live.

### Backlog (remaining)
1. Window previews on hover (DWM thumbnails — hard; needs native region)
2. Onboarding welcome surface (basic auto-import works already)
3. Multi-monitor picker UI in settings (backend list_monitors exists)
4. Stacks (grouping pinned items into a dock folder) — deferred
5. Live effects modes (rain/snow/ocean/aurora scenes) — deferred
6. Music visualization + cursor light — deferred
7. Release-build smoke test (install the NSIS setup, check autostart)

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
