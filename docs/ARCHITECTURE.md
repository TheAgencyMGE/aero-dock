# Aero Dock — Architecture

> Bring beauty back to the desktop.

Aero Dock is a Windows dock built on Tauri v2. A Rust core owns all native
Windows integration; a React + PixiJS frontend owns the visual experience. The
two communicate over a strictly typed IPC surface.

If you're about to change something non-trivial, this is the map. Start here,
then read the module you're touching.

## Process model

```
┌──────────────────────────────────────────────────────────────┐
│ Rust core (src-tauri)                                        │
│  • Window management (transparent, undecorated, per-monitor) │
│  • Platform layer (Win32/COM), isolated in platform/windows  │
│  • Settings engine (atomic JSON in the app config dir)       │
│  • Event push → frontend (running apps, system status, …)    │
├──────────────────────── typed IPC ───────────────────────────┤
│ WebView2 frontend (src)                                      │
│  • Dock UI (React 19, spring physics via motion)             │
│  • Effects engine (PixiJS/WebGL: ripples, bursts, scenes)    │
│  • Theme engine (design tokens as CSS custom properties)     │
│  • Settings / onboarding / search / toast surfaces           │
└──────────────────────────────────────────────────────────────┘
```

### Windows (the OS kind)

- **`dock`** — the main window. Transparent, undecorated, always-on-top,
  skip-taskbar, sized to its monitor's edge. `WS_EX_TOOLWINDOW` keeps it out
  of Alt-Tab; `WS_EX_NOACTIVATE` keeps it from stealing focus.
- **`settings`** — a normal decorated window, created on demand. Same bundle,
  routed by `?window=settings` in `src/main.tsx`.
- **Flyouts** (context menus, folders, stacks, window previews, search,
  toasts) are *not* separate OS windows. They render inside the dock window's
  canvas, which grows transparently to make room. This avoids window-spawn
  latency entirely.

## Folder structure

```
aero-dock/
├─ .github/                     issue/PR templates + CI
├─ docs/ARCHITECTURE.md         this file
├─ src/                         frontend
│  ├─ main.tsx                  entry; routes dock vs. settings window
│  ├─ app/DockApp.tsx           dock root: hydrate, drag-drop, icon resolution
│  ├─ features/
│  │  ├─ dock/                  DockBar, DockIcon, ContextMenu, flyouts, menuStore
│  │  ├─ widgets/               clock, battery, network, volume, Recycle Bin
│  │  ├─ search/                search overlay
│  │  ├─ settings/              settings window + Aero form controls
│  │  ├─ onboarding/            first-run welcome card
│  │  └─ feedback/              toast store + stack
│  ├─ engine/
│  │  ├─ animation/springs.ts   every spring constant in the app
│  │  ├─ effects/               PixiJS layer, effect classes, ambient scenes
│  │  └─ themes/                theme definitions + token applier
│  ├─ ipc/                      typed command bindings + event names
│  ├─ state/                    zustand stores (settings, dock, running, system, ambient)
│  └─ styles/                   tokens.css, global.css
├─ src-tauri/
│  ├─ src/
│  │  ├─ main.rs                thin entry
│  │  ├─ lib.rs                 app builder, window setup, tray, state wiring
│  │  ├─ commands/              IPC surface, one module per feature
│  │  │                         apps, dock, settings, system_cmd, windows_cmd
│  │  ├─ core/                  settings engine + unified error type
│  │  └─ platform/
│  │     ├─ mod.rs              shared types + the COM apartment guard
│  │     └─ windows/            every Win32/COM call lives here
│  │        ├─ apps.rs          Start Menu/Desktop .lnk + AppsFolder (UWP)
│  │        ├─ icons.rs         IShellItemImageFactory → PNG cache
│  │        ├─ running.rs       shell-hook window, live running-app tracking
│  │        ├─ thumbnails.rs    DWM live window previews
│  │        ├─ recent.rs        Recent folder items
│  │        ├─ system.rs        battery, network, volume (WASAPI), Recycle Bin
│  │        ├─ wallpaper.rs     wallpaper path + dominant color extraction
│  │        ├─ monitors.rs      work areas + per-monitor DPI
│  │        ├─ dock_window.rs   toolwindow/no-activate style bits
│  │        ├─ taskbar.rs       SHAppBarMessage auto-hide toggle
│  │        └─ util.rs          small shared helpers
│  ├─ capabilities/default.json Tauri permission set
│  ├─ icons/                    generated app icon set
│  └─ tauri.conf.json
└─ package.json / vite.config.ts / tsconfig.json
```

## Subsystems

### 1. Platform layer (Rust, `platform/`)

All Win32 and COM lives below `platform/windows` so a macOS or Linux backend
can slot in later. **Nothing outside that directory touches the `windows`
crate.** Every COM call happens on a thread that called `CoInitializeEx` —
`ComApartment` in `platform/mod.rs` is the RAII guard for that, and blocking
work is pushed off the async pool.

Key APIs:

- **App enumeration** — walk the machine and user Start Menus and the Desktop,
  resolving `.lnk` files via `IShellLink`/`IPersistFile`. Packaged (UWP) apps
  come from `shell:AppsFolder`, with `SIGDN_PARENTRELATIVEPARSING` giving the
  AUMID.
- **Launching** — `ShellExecuteW` for normal targets. UWP apps need
  `IApplicationActivationManager`; `ShellExecuteW` silently no-ops on an AUMID.
- **Icons** — `IShellItemImageFactory::GetImage` at 256px → BGRA → a PNG file
  cache, served to the WebView through the `asset` protocol. Icons never cross
  the IPC boundary as base64.
- **Running apps** — a dedicated thread owns a `RegisterShellHookWindow`
  message loop and pushes snapshots. UWP windows are hosted by
  `ApplicationFrameHost.exe`, so their identity comes from
  `PKEY_AppUserModel_ID` via `SHGetPropertyStoreForWindow`.
- **Window previews** — `DwmRegisterThumbnail` composites live miniatures
  directly into the dock window. The OS draws these *over* our DOM, so every
  teardown path must unregister them.
- **System status** — `GetSystemPowerStatus`, `INetworkListManager`,
  `IAudioEndpointVolume`, `SHQueryRecycleBin`.

### 2. Settings engine (Rust, `core/settings.rs`)

One typed `Settings` struct, versioned by `schema_version` and forward
compatible via `#[serde(default)]` everywhere — an older build reading a newer
file fills in defaults rather than failing. Persisted as JSON in the app config
dir with an atomic write (temp file + rename). A corrupt file is backed up to
`settings.json.bak` and replaced with defaults rather than blocking startup.

`sanitize()` clamps every numeric field into its documented range, so a
hand-edited or imported file can never push the renderer into a broken state.

Every mutation emits `settings://changed` carrying the **full struct**, so the
frontend stays a pure function of settings and can't drift from disk.

### 3. IPC surface (`commands/` ↔ `src/ipc/`)

Every Rust command has exactly one TypeScript binding in `src/ipc/commands.ts`
and a matching type in `src/ipc/types.ts`. These are kept in sync by hand and
**must change in the same commit**. `src/ipc/commands.ts` is the only file in
the frontend allowed to call `invoke` directly.

Events flow one way, Rust → frontend:

| Event | Payload |
| ----- | ------- |
| `settings://changed` | the complete `Settings` struct |
| `apps://running-changed` | `RunningSnapshot` (windows + focused hwnd) |
| `system://status` | battery, network, volume, Recycle Bin |

### 4. Theme engine (frontend, `engine/themes/`)

A theme is a typed set of design-token overrides. The applier writes them to
CSS custom properties on `:root`; **components read only tokens, never raw
colors**, which is why switching themes restyles everything at once — including
the PixiJS layer, which parses its tint out of `--bloom-color`.

Built-in themes: Aero (default), Ocean, Forest, Aurora, Sunset, Night. The
defaults in `tokens.css` *are* the Aero theme, so its override map is empty.
`THEMED_TOKENS` collects every token any theme touches; they're all cleared
before a theme is applied so switching back to Aero restores the stylesheet
defaults.

Wallpaper sync derives an accent from the current wallpaper's dominant hue
(extracted in Rust) and tints any theme on top.

### 5. Animation engine (frontend, `engine/animation/`)

`motion` springs drive all interactive movement: magnification, drag, bloom.
Every spring constant lives in `springs.ts` so the app's feel is tuned in one
place.

Ambient motion (icon float, glass sweep) is **pure CSS animation on
transforms** — no JavaScript runs per frame. `prefers-reduced-motion` disables
decorative motion globally.

> **Gotcha:** `motion` writes an inline `transform`, which beats any CSS
> `transform` on the same element. Centering therefore rides on the CSS
> `translate` property instead — see `.dock-label` and `edgePanelStyle`. Put
> centering in a CSS `transform` and it will silently vanish the moment an
> animation runs.

### 6. Effects engine (frontend, `engine/effects/`)

One PixiJS `Application` on a transparent canvas above the DOM dock, driven by
a tiny event bus so components stay decoupled from it. Effects are small
classes with `update(dt)` and `done()`: `ClickRipple`, `LaunchBurst`,
`DustField`, plus the ambient scenes (rain, snow, bubbles, aurora).

Coordinates are **anchored to the dock's screen edge**, not the window's
top-left, because the window grows and shrinks to host flyouts. An effect
spawned before a flyout opens must not jump when it does.

### 7. Dock feature (frontend, `features/dock/`)

The dock renders from a single `DockModel`: pinned items (from settings) merged
with running apps (from events), keyed by AUMID for packaged apps and exe path
otherwise. Magnification weights icon width by cursor distance along the dock
axis.

The window size is computed **deterministically** from icon count, size,
magnification headroom, and whether a flyout is open — there is no
`ResizeObserver` anywhere, because measuring a window that resizes in response
to the measurement is a feedback loop.

Flyout geometry is shared: `flyoutStyle()` and `edgePanelStyle()` in
`menuStore.ts` are the single source of truth for where a panel sits relative
to each of the four dock edges.

## Performance rules

These are requirements, not aspirations. An always-on-top dock that costs CPU
while you aren't using it is a dock people uninstall.

1. **No timers when idle.** The Pixi ticker stops when no effect is alive. All
   ambient motion pauses after 45s without interaction and wakes instantly on
   hover.
2. **Events over polling.** Running apps and focus changes are push-based via
   the shell hook. The only poll is a 20s battery/network/volume refresh.
3. **Icons render once.** PNG cache on disk, plain `<img>` in the DOM,
   GPU-composited transforms only — never layout properties.
4. **Effects budget.** Particle counts scale with the density setting, and
   ambient-only frames are capped at 30fps. Everything must stay smooth on
   Intel integrated graphics.

An earlier build idled at ~84% CPU across webviews. The fixes were: icon float
moved from per-icon `requestAnimationFrame` to a CSS transform animation, the
glass sweep changed from repainting `background-position` to translating a
gradient layer, the Pixi ticker capped and then stopped outright, and the
ambient sleep timer. Idle is now ~6%. Keep it there.

## Quality gates

`pnpm check` runs all four:

- `tsc --noEmit` clean
- `cargo clippy --all-targets -- -D warnings` clean
- `cargo test` green
- `vite build` succeeds

Plus: no `unwrap()` outside tests, and every command returns
`Result<_, AeroError>`.

## Implementation notes worth knowing

Hard-won details that aren't obvious from the code:

- **`open_settings` must be `async`.** Building a WebView2 inside a synchronous
  Tauri command deadlocks — the command blocks the main thread that WebView2
  creation needs.
- **React StrictMode double-fires effects.** Any first-run or one-shot IPC needs
  an idempotent, atomic transaction on the Rust side. `first_run_import` is the
  example: it only does anything on the first call through the lock.
- **`.glass` sets `position: relative`,** and Vite's HMR reorders stylesheets.
  Flyouts therefore set `position: absolute` inline rather than fighting CSS
  ordering, which is fragile under HMR.
- **Edge switching needs an explicit reposition.** Bottom → top keeps identical
  window dimensions, so the frontend's resize path never fires;
  `set_settings` always calls `position_dock`.
- **Transparency requires both** `"transparent": true` *and* an undecorated
  window in `tauri.conf.json`.
- **`TranscodedWallpaper` has no file extension,** so wallpaper color extraction
  uses `image::load_from_memory` rather than extension sniffing.
- **DWM thumbnails outlive the DOM.** They're composited by the OS over
  everything we draw, so a leaked one floats with no glass behind it. Teardown
  hides them twice — once immediately, once after a delay — to catch anything a
  straggling animation callback re-registered.

## Known limitations

- **Windows only.** The platform layer is trait-isolated and a port is a real
  possibility, but no other backend exists today.
- **UWP window grouping is imperfect.** Packaged apps are identified by AUMID
  from the frame window, which covers the common cases but not every app.
