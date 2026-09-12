# Changelog

All notable changes to Aero Dock are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-09-08

Modes, and the two things a mode is made of.

### Added

- **Per-app audio.** Scroll an app on the dock to change that app's
  volume, middle-click to mute or unmute it, and right-click to pick an
  output. A readout appears while you scroll and a muted app keeps a
  badge so silence never looks like a broken app. This is the same knob
  the Windows volume mixer shows, so the two always agree. An app that
  holds several audio sessions, which is normal for browsers and games,
  is treated as one.
- **Workspace snapshots.** Save which apps are open, where their windows
  sit, how big they are and which monitor they are on, then put it all
  back. Windows that are still open are moved rather than relaunched,
  apps that have closed are opened once, and anything saved on a monitor
  that is no longer plugged in comes back onto a screen that exists
  instead of off the edge of the desktop.
- **Dock Modes.** A mode holds its own pinned apps, its own workspace and
  its own per-app volumes. Switching restores all three from the tile on
  the dock. Modes can also switch on their own: name the apps that belong
  to a mode and bringing one of them to the front loads it. Automatic
  switching changes pins and volumes only, never window positions, so it
  cannot fight the app you just clicked on.
- Settings gained a Modes card for making, renaming, deleting and
  switching modes, and an App volume card that mirrors the dock.
- **Two glass materials.** Classic is the glossy, beveled Aero panel the
  app has always used. Liquid keeps the same palette but renders as thin
  glass: most of the tint leaves the body and the light moves to the rim,
  with deeper corners and no hard gloss cap. The dock and the settings
  window pick their material separately, so either can be glossy while
  the other is a lens. Both start on Classic, so upgrading changes
  nothing on screen; Liquid is one control away in Settings, then Theme.
- Each mode picks its own tile icon from a grid of presets grouped by
  what people name modes after, or any character you type. Without one it
  falls back to the first letter of the mode's name.

### Changed

- Picking an output for an app records the choice on the mode and opens
  the Windows page that performs the routing. Windows has no public API
  for per-application endpoint routing, so the last step is its own.
- The settings file gained a `modes` section. It is dormant on upgrade:
  existing configs load unchanged and the dock behaves exactly as it did
  until Modes is switched on, at which point the current dock becomes the
  first mode.

## [1.1.0] - 2026-09-07

### Added

- A portable build. Unpack the zip anywhere and run it; settings, pinned
  apps and the icon cache go in a `data` folder beside the exe instead of
  `%APPDATA%`, and WebView2 is pointed at that folder too, so a portable
  copy leaves nothing on the host machine. The switch is a `portable.txt`
  file next to the executable, so one binary covers both. Settings, then
  About, shows which mode is active and where the files are.

## [1.0.1] - 2026-09-04

### Fixed

- Windows Search, the Start menu, the input host and other shell surfaces
  no longer appear in the dock as if they were running apps. Filtering now
  matches on process name, window class and package identity, and drops
  ApplicationFrameHost frames that carry no AppUserModelID.
- **Open file location** opens the real folder with the file selected.
  Explorer needs its `/select,` path quoted inside the same argument and
  passed through verbatim; the previous call was escaped in a way Explorer
  answered by opening Documents. Packaged apps open the Apps folder, and a
  pin whose target has gone falls back to the parent folder.
- Dragging an icon to reorder tracks the cursor with no lag. Drag momentum
  and elasticity are off, neighbours move on a stiffer spring, and icons
  snap to their base size at drag start instead of animating down while
  the cursor is on top of them.
- Icons from apps that ship only a 16 or 32 px resource, such as Core Temp,
  are cropped to their drawn pixels and scaled up, so every tile carries
  the same optical weight. Non-square icons are padded rather than
  stretched, at any dock size. The icon cache is versioned, so existing
  installs regenerate on upgrade.
- Auto-hide no longer slides the dock away while files are being dragged
  onto it, which was the one moment it moved out from under the cursor on
  purpose.
- Quitting is reliable and easier to find. The tray menu keeps its Quit,
  now below a separator, and Settings gained a **Quit** button next to the
  settings file controls. Both paths restore the Windows taskbar before
  exiting, so an unclean shutdown cannot leave you without one.

### Changed

- The auto-hide delay is configurable, from 200ms to 5 seconds. It was
  fixed at 1.4 seconds before.
- The built-in dock items can each be turned off: search button, settings
  button, clock and date, and the battery, network, volume and Recycle Bin
  glyphs. They were always shown before.
- The search and settings icons are drawn as glass, with a gradient body,
  a specular highlight and a seated centre, to match the app icons beside
  them. They still take their colour from the active theme.

## [1.0.0] - 2026-08-26

First public release.

### Added

- **Floating glass dock** on any screen edge (bottom, top, left, or right),
  floating or flush, with per-monitor DPI-aware positioning and a monitor
  picker for multi-display setups.
- **Cursor magnification** with spring physics, idle float, launch bounce,
  glass tooltips, and icon reflections.
- **Live running-app tracking** via a Windows shell hook: running indicators,
  click to focus, cycle, or minimize, and a window list in the context menu.
- **Live window previews**: real DWM thumbnails framed in glass, opened by
  hovering an app with open windows. Click a preview to focus that window.
- **Pinning**: drag to reorder, drop apps, files, or folders from Explorer,
  folder flyouts with a bloom-open grid, and stacks that group several pinned
  items behind one tile.
- **Search overlay** covering installed apps (including packaged/UWP apps) and
  recent files, keyboard-first.
- **System corner**: clock, battery, network, scroll-to-adjust volume, and the
  Recycle Bin.
- **Six themes** (Aero, Ocean, Forest, Aurora, Sunset, Night) plus optional
  wallpaper color sync and sliders for glass, bloom, reflections, particles,
  and animation speed.
- **Ambient scenes**: dust, rain, snow, bubbles, or aurora drifting behind the
  dock, all density-scaled and frame-capped.
- **Effects engine** (WebGL): click ripples and launch bursts, with a ticker
  that stops entirely when nothing is animating.
- **Auto-hide** with an 8px reveal strip, a tray icon, and launch-at-sign-in.
- **First-run welcome** offering to import a starter set of apps or start empty.
- Settings export and import as a plain JSON file.
- Optional Windows taskbar auto-hide, restored when Aero Dock quits.

### Notes

- Aero Dock makes no network requests and contains no telemetry or analytics.
  All state is a single JSON file in your app config directory.
- Packaged (UWP) apps are grouped by AppUserModelID. This covers the common
  cases and misses a few. See the README.

[1.2.0]: https://github.com/TheAgencyMGE/aero-dock/releases/tag/v1.2.0
[1.1.0]: https://github.com/TheAgencyMGE/aero-dock/releases/tag/v1.1.0
[1.0.1]: https://github.com/TheAgencyMGE/aero-dock/releases/tag/v1.0.1
[1.0.0]: https://github.com/TheAgencyMGE/aero-dock/releases/tag/v1.0.0
