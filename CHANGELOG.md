# Changelog

All notable changes to Aero Dock are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-08-26

First public release.

### Added

- **Floating glass dock** on any screen edge (bottom, top, left, or right),
  floating or flush, with per-monitor DPI-aware positioning and a monitor
  picker for multi-display setups.
- **Cursor magnification** with spring physics, idle float, launch bounce,
  glass tooltips, and icon reflections.
- **Live running-app tracking** via a Windows shell hook: running indicators,
  click to focus, cycle, or minimize, and a window list in the context menu.
- **Live window previews** — real DWM thumbnails framed in glass, opened by
  hovering an app with open windows. Click a preview to focus that window.
- **Pinning** — drag to reorder, drop apps, files, or folders from Explorer,
  folder flyouts with a bloom-open grid, and stacks that group several pinned
  items behind one tile.
- **Search overlay** covering installed apps (including packaged/UWP apps) and
  recent files, keyboard-first.
- **System corner** — clock, battery, network, scroll-to-adjust volume, and the
  Recycle Bin.
- **Six themes** (Aero, Ocean, Forest, Aurora, Sunset, Night) plus optional
  wallpaper color sync and sliders for glass, bloom, reflections, particles,
  and animation speed.
- **Ambient scenes** — dust, rain, snow, bubbles, or aurora drifting behind the
  dock, all density-scaled and frame-capped.
- **Effects engine** (WebGL) — click ripples and launch bursts, with a ticker
  that stops entirely when nothing is animating.
- **Auto-hide** with an 8px reveal strip, a tray icon, and launch-at-sign-in.
- **First-run welcome** offering to import a starter set of apps or start empty.
- Settings export and import as a plain JSON file.
- Optional Windows taskbar auto-hide, restored when Aero Dock quits.

### Notes

- Aero Dock makes no network requests and contains no telemetry or analytics.
  All state is a single JSON file in your app config directory.
- Packaged (UWP) apps are grouped by AppUserModelID. This covers the common
  cases but is not perfect for every app — see the README.

[1.0.0]: https://github.com/TheAgencyMGE/aero-dock/releases/tag/v1.0.0
