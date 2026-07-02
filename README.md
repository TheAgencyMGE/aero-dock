# Aero Dock

**Bring beauty back to the desktop.**

Aero Dock is a Windows dock built in the Frutiger Aero design language —
glass, water, light, and life — as if Vista's aesthetic had kept evolving
until today. Real glass materials, cursor magnification with spring
physics, water ripples on click, launch bursts, ambient dust, six themes,
and full personalization.

![icon](src-tauri/icons/128x128.png)

## Features

- **Floating glass dock** on any screen edge (bottom/top/left/right),
  floating or flush, with per-monitor DPI-aware positioning
- **Cursor magnification** with soft spring physics, idle float, launch
  bounce, glass tooltips, icon reflections
- **Live running apps** via shell hooks: indicators, focus/cycle/minimize
  on click, window list in the context menu
- **Pinning**: drag-and-drop reorder, drop files/shortcuts from Explorer,
  folder flyouts with a bloom-open grid
- **Effects engine** (WebGL): click ripples, launch bursts, ambient dust —
  GPU ticker sleeps whenever nothing is animating
- **System corner**: clock, battery, network, scroll-to-adjust volume,
  Recycle Bin (open/empty)
- **Search overlay**: apps + recent files, keyboard-first
- **Six themes** (Aero, Ocean, Forest, Aurora, Sunset, Night), wallpaper
  color sync, and sliders for glass/bloom/reflection/particles/speed
- **Auto-hide** with an 8px reveal strip, tray icon, autostart

## Development

Prereqs: Rust (MSVC), Node 22+, pnpm.

```sh
pnpm install
pnpm tauri dev      # run with hot reload
pnpm tauri build    # NSIS installer in src-tauri/target/release/bundle
```

- `docs/ARCHITECTURE.md` — full system design
- `PROJECT_STATE.md` — build progress + decisions log

## Stack

Tauri v2 · Rust (windows-rs) · React 19 · TypeScript · Vite · motion ·
PixiJS · zustand
