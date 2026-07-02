# Aero Dock — Architecture

> Bring beauty back to the desktop.

Aero Dock is a production Windows dock application built on Tauri v2. A Rust core
owns all native Windows integration; a React + PixiJS frontend owns the visual
experience. The two communicate over a strictly typed IPC surface.

## Process model

```
┌──────────────────────────────────────────────────────────────┐
│ Rust core (src-tauri)                                        │
│  • Window management (transparent, undecorated, per-monitor) │
│  • Platform layer (Win32/COM) behind a trait abstraction     │
│  • Settings engine (atomic JSON at %APPDATA%\AeroDock)       │
│  • Event push → frontend (running apps, system status, …)    │
├──────────────────────── typed IPC ───────────────────────────┤
│ WebView2 frontend (src)                                      │
│  • Dock UI (React 19, spring physics via motion)             │
│  • Effects engine (PixiJS/WebGL: bloom, ripples, particles)  │
│  • Theme engine (design tokens as CSS custom properties)     │
│  • Settings / onboarding / search surfaces                   │
└──────────────────────────────────────────────────────────────┘
```

Windows:
- `dock` — main window. Transparent, undecorated, always-on-top, skip-taskbar,
  sized to the dock's monitor edge. Never shows in Alt-Tab (WS_EX_TOOLWINDOW).
- `settings` — normal decorated window, created on demand.
- Flyouts (previews, folders, search) render inside the dock window's canvas
  where possible to avoid window-spawn latency.

## Folder structure

```
aero-dock/
├─ docs/
│  ├─ ARCHITECTURE.md          this file
│  └─ …                        per-subsystem docs as they land
├─ PROJECT_STATE.md            running progress tracker (source of truth)
├─ src/                        frontend
│  ├─ app/                     window entrypoints + providers
│  ├─ features/
│  │  ├─ dock/                 dock bar, icons, magnification, indicators
│  │  ├─ folders/              dock folders (bloom-open grid)
│  │  ├─ previews/             window preview flyouts
│  │  ├─ search/               search overlay
│  │  ├─ widgets/              clock, battery, network, volume, recycle bin
│  │  ├─ settings/             settings window UI
│  │  └─ onboarding/           first-run experience
│  ├─ engine/
│  │  ├─ animation/            spring configs, float/breathe drivers, reduced-motion
│  │  ├─ effects/              PixiJS layer (bloom, ripple, burst, particles)
│  │  └─ themes/               theme definitions + applier
│  ├─ ipc/                     typed command bindings + event subscriptions
│  ├─ state/                   zustand stores (dock, settings, system)
│  ├─ ui/                      shared Aero components (GlassPanel, AeroTooltip…)
│  └─ styles/                  tokens.css, global.css
├─ src-tauri/
│  ├─ src/
│  │  ├─ main.rs               thin entry
│  │  ├─ lib.rs                app builder, window setup, state wiring
│  │  ├─ commands/             IPC surface, one module per feature
│  │  ├─ core/                 settings engine, shared state, error types
│  │  └─ platform/
│  │     ├─ mod.rs             platform traits + re-exports
│  │     └─ windows/           Win32/COM implementations
│  │        ├─ apps.rs         Start Menu/Desktop .lnk enumeration
│  │        ├─ icons.rs        IShellItemImageFactory → PNG cache
│  │        ├─ running.rs      EnumWindows + WinEvent hook tracking
│  │        ├─ recent.rs       Recent folder items
│  │        ├─ recycle.rs      SHQueryRecycleBin / SHEmptyRecycleBin
│  │        ├─ system.rs       battery, network, volume (WASAPI)
│  │        ├─ wallpaper.rs    wallpaper path + dominant color extraction
│  │        └─ dock_window.rs  WS_EX_TOOLWINDOW, work-area, positioning
│  └─ tauri.conf.json
└─ package.json / Cargo.toml / …
```

## Subsystems

### 1. Platform layer (Rust, `platform/`)
All Win32/COM lives here behind small traits (`AppProvider`, `IconProvider`,
`RunningWindows`, `SystemStatus`, …) so macOS/Linux backends can slot in later.
Nothing outside `platform/windows` touches the `windows` crate. Every COM call
happens on threads that called `CoInitializeEx`; results cross to the async
world via channels.

Key APIs used:
- App enumeration: walk `%ProgramData%\Microsoft\Windows\Start Menu`,
  `%APPDATA%\Microsoft\Windows\Start Menu`, Desktop; resolve `.lnk` via
  `IShellLink`/`IPersistFile`.
- Icons: `IShellItemImageFactory::GetImage` at 256px → BGRA → PNG file cache
  keyed by content hash; served to the WebView via the `asset` protocol.
- Running apps: initial `EnumWindows` snapshot + `SetWinEventHook`
  (EVENT_OBJECT_CREATE/DESTROY/FOREGROUND/NAMECHANGE) for live updates.
- System: `GetSystemPowerStatus` (battery), `INetworkListManager` (network),
  `IAudioEndpointVolume` (volume), `SHQueryRecycleBin` (recycle bin).
- Dock window: `WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE` adjustments, per-monitor
  work-area math, optional app-bar reservation.

### 2. Settings engine (Rust, `core/settings.rs`)
Single typed `Settings` struct, versioned with a `schema_version` field and
forward-compatible via `#[serde(default)]` everywhere. Persisted as JSON at
`%APPDATA%\AeroDock\settings.json` with atomic write (temp file + rename).
Every mutation emits a `settings://changed` event carrying the full struct so
the frontend stays a pure function of settings. Export/import = copy the file.

### 3. IPC surface (`commands/` ↔ `src/ipc/`)
Every Rust command has exactly one TypeScript binding with a matching type in
`src/ipc/types.ts` (kept in sync by hand, reviewed together in the same PR).
Events flow one way, Rust → frontend: `apps://running-changed`,
`system://status`, `settings://changed`, `dock://monitor-changed`.

### 4. Theme engine (frontend, `engine/themes/`)
A theme is a typed object of design tokens (colors, glass parameters, light
positions, particle palette). The applier writes tokens to CSS custom
properties on `:root` and pushes effect parameters to the PixiJS layer.
Built-in themes: **Aero** (default, Vista blue-green), **Ocean**, **Forest**,
**Aurora**, **Sunset**, **Night**. Wallpaper sync derives an accent from the
current wallpaper's dominant hue (extracted in Rust) and tints any theme.

### 5. Animation engine (frontend, `engine/animation/`)
`motion` (framer-motion successor) springs for all interactive movement:
magnification, drag, folder bloom. A single shared rAF driver runs ambient
motion (idle float, breathe) and pauses entirely when the dock is hidden or
the window loses visibility. Honors `prefers-reduced-motion`. All spring
constants live in one file (`springs.ts`) so feel is tuned in one place.

### 6. Effects engine (frontend, `engine/effects/`)
One PixiJS `Application` on a canvas layered with the DOM dock. Effects are
small classes with `spawn()`/`update(dt)`/`dispose()`: `HoverBloom`,
`ClickRipple`, `LaunchBurst`, `DustField`. The ticker stops when no effect is
alive and no ambient particles are enabled — idle GPU cost is zero. Density,
bloom amount, and reflection strength come from settings.

### 7. Dock feature (frontend, `features/dock/`)
The dock renders from a single `DockModel`: pinned items (from settings) merged
with running apps (from events). Icon magnification uses cursor-distance
weighting (macOS-style curve, tuned gentler). Auto-hide slides the dock off the
edge; a 2px reveal zone brings it back. Position: bottom/top/left/right +
floating margin. Multi-monitor: settings pick the target monitor; the Rust side
repositions on `WM_DISPLAYCHANGE`.

## Performance rules

1. No timers when idle — ambient animation runs off one rAF driver that stops
   when hidden; the Pixi ticker stops when no effects are live.
2. Events over polling — running apps and system status are push-based
   (WinEvent hook, callbacks); the only poll is a 30s battery/network refresh.
3. Icons render once — PNG cache on disk, `<img>` in DOM, GPU-composited
   transforms only (translate/scale/opacity — never layout properties).
4. Effects budget — particle counts scale with settings; everything must stay
   smooth on Intel integrated graphics.

## Quality gates

- `cargo clippy -- -D warnings` and `cargo test` green.
- `tsc --noEmit` and `vite build` green.
- No `unwrap()` outside tests; all commands return `Result<_, AeroError>`.
- Every subsystem gets a doc section in `docs/` when it lands.
