<div align="center">

<img src="src-tauri/icons/128x128.png" width="96" alt="Aero Dock icon" />

# Aero Dock

**A modern free and open-source RocketDock and Nexus Dock alternative for
Windows 10 and 11.**

Live window previews, Aero glass, cursor magnification, and full desktop
customization.

Built in the Frutiger Aero design language: pin your apps to a floating pane
of glass, watch icons grow under the cursor, and let light drift across the
whole thing.

[![Latest release](https://img.shields.io/github/v/release/TheAgencyMGE/aero-dock?label=download&color=2f9de3)](https://github.com/TheAgencyMGE/aero-dock/releases/latest)
[![CI](https://github.com/TheAgencyMGE/aero-dock/actions/workflows/ci.yml/badge.svg)](https://github.com/TheAgencyMGE/aero-dock/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-7ad03a)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0d3a5c)](#requirements)

<img src="docs/screenshots/dock.png" alt="Aero Dock glass taskbar with magnified app icons and running indicators on Windows 11" width="880" />

</div>

---

## What it does

Aero Dock is an app launcher and window switcher for Windows, in the same
vein as RocketDock and Winstep Nexus Dock. It sits on any screen edge and
covers what the taskbar covers, in glass.

The Windows side is Rust calling Win32 and COM directly. Shortcut resolution,
icon extraction, window tracking and the live previews all go through real
Windows APIs. The interface on top is React in WebView2, which is how the blur
and gloss work at all.

If you used RocketDock years ago and miss it, this is aimed squarely at you.
Its last release was 2008.

## Features

**Dock**

- Any edge: bottom, top, left or right, floating or flush
- Per monitor DPI aware, with a monitor picker on multi display setups
- Cursor magnification on springs, idle float, launch bounce, glass tooltips
- Auto hide with an 8px reveal strip

**Apps and windows**

- Running indicators. Click to focus, click again to cycle or minimize
- Live window previews using real DWM thumbnails, framed in glass
- Drag to reorder, or drop apps, files and folders in from Explorer
- Folder flyouts, and stacks that group several pins behind one tile
- Context menu: open, run as administrator, open file location, pin, unpin

**Search**

- Keyboard overlay across installed apps, including Microsoft Store apps, plus
  recent files

**System corner**

- Clock, battery, network, volume (scroll to change, click to mute), Recycle
  Bin

**Appearance**

- Six themes: Aero, Ocean, Forest, Aurora, Sunset, Night
- Optional wallpaper colour sync
- Ambient scenes behind the dock: dust, rain, snow, bubbles, aurora
- Sliders for glass, bloom, reflections, particles, opacity, speed
- Honours `prefers-reduced-motion`

## Screenshots

<div align="center">

<img src="docs/screenshots/previews.png" alt="Live window previews in Aero Dock, showing real DWM thumbnails of open File Explorer windows" width="820" />

<em>Live window previews. Real DWM thumbnails, so you see what each window is doing.</em>

<img src="docs/screenshots/settings.png" alt="Aero Dock settings window with theme picker and glass sliders" width="820" />

<em>Settings, in the same glass as the dock.</em>

</div>

## Install

Grab the installer from the
[latest release](https://github.com/TheAgencyMGE/aero-dock/releases/latest) and
run it. It installs per user, so no admin rights.

Aero Dock lives in your system tray. Left click the tray icon to show or hide
the dock, right click for settings and quit.

> The installer is not code signed, because certificates cost money this
> project does not have. Windows will show a "Windows protected your PC" box
> the first time. Click **More info**, then **Run anyway**. If you would rather
> not trust a binary, [build it yourself](#building-from-source).

### Requirements

- Windows 10 version 1809 or later, or Windows 11
- x64
- WebView2 runtime, already present on Windows 11 and current Windows 10

## Usage

| Action | How |
| ------ | --- |
| Launch an app | Click its icon |
| Focus a running app | Click it, then click again to cycle or minimize |
| See window previews | Hover an app that has windows open |
| Pin something | Drag it from Explorer onto the dock |
| Reorder | Drag an icon along the dock |
| Group into a stack | Right click an icon, then **Stack with previous item** |
| Search | Click the magnifier |
| Settings | Click the gear, or right click the tray icon |
| Show or hide the dock | Left click the tray icon |

First launch offers to import a starter set of your apps, or to start empty.

## Privacy

Aero Dock makes no network requests. No telemetry, no analytics, no crash
reporting, no update check, no account.

The one outbound action is opening a URL in your browser, and only when you
click something that obviously does that, like the GitHub button in Settings.

Your config is a single file:

```
%APPDATA%\com.aerodock.desktop\settings.json
```

Extracted icons are cached as PNGs next to it. Delete that folder to reset.

## Building from source

You need Rust (stable, MSVC), Visual Studio Build Tools with the "Desktop
development with C++" workload, Node.js 22+, and pnpm 10+.

```sh
git clone https://github.com/TheAgencyMGE/aero-dock.git
cd aero-dock
pnpm install
pnpm tauri:dev      # run with hot reload
pnpm tauri:build    # NSIS installer in src-tauri/target/release/bundle/nsis
pnpm check          # typecheck, clippy, Rust tests, production build
```

## Troubleshooting

**Nothing appeared after install.** Check the system tray. Left click the icon.

**Some icons are letters.** Windows could not extract an icon for that target,
so the dock falls back to the app's initial. Usually the shortcut points at
something that no longer exists.

**Previews are blank.** Some apps render with their own compositor and produce
no DWM thumbnail.

**Store app windows group oddly.** Packaged apps all run under
`ApplicationFrameHost.exe`, so Aero Dock identifies them by AppUserModelID.
That covers most cases and misses a few.

**Wrong monitor.** Settings, then Dock, then Monitor. The picker shows up with
two or more displays.

**Settings will not open.** Quit from the tray and start it again. If it keeps
happening, [open an issue](https://github.com/TheAgencyMGE/aero-dock/issues)
with your Windows build.

## Known limitations

- Windows only. The platform layer is isolated so a port is realistic, but no
  macOS or Linux backend exists.
- UWP window grouping does not resolve for every app.
- The installer is unsigned, so expect SmartScreen on first run.
- Memory sits around 250MB, which is heavy for a dock. That is the cost of the
  WebView2 rendering stack.

## Contributing

Pull requests welcome. [CONTRIBUTING.md](CONTRIBUTING.md) has the setup and the
house rules. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) maps the codebase and
is worth reading before anything non trivial.

A macOS or Linux backend is a well shaped place to start. The platform layer is
already isolated behind `src-tauri/src/platform/`.

## Built with

[Tauri 2](https://tauri.app), Rust with
[windows-rs](https://github.com/microsoft/windows-rs), React 19, TypeScript,
Vite, [motion](https://motion.dev), [PixiJS](https://pixijs.com),
[zustand](https://github.com/pmndrs/zustand)

## License

[MIT](LICENSE) © Ryan Panda
