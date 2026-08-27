# Contributing to Aero Dock

Thanks for taking a look. Aero Dock is a small, opinionated project — a
Windows dock that takes the Frutiger Aero look seriously — and contributions
that fit that goal are very welcome.

## Getting set up

You'll need:

- **Windows 10 (1809+) or Windows 11** — the platform layer is Win32/COM, so
  the app only builds and runs on Windows today.
- **Rust** (stable, MSVC toolchain) — install via [rustup](https://rustup.rs).
- **Visual Studio Build Tools** with the "Desktop development with C++"
  workload, for the MSVC linker.
- **Node.js 22+** and **pnpm 10+**.
- **WebView2 runtime** — already present on Windows 11 and current Windows 10.

```sh
git clone https://github.com/TheAgencyMGE/aero-dock.git
cd aero-dock
pnpm install
pnpm tauri:dev
```

`pnpm tauri:dev` runs the dock with hot reload. Edit anything under `src/` and
the UI updates in place; edit `src-tauri/` and Cargo rebuilds the Rust core.

## Before you open a pull request

Run the whole gate. It's the same set CI runs:

```sh
pnpm check
```

That is typecheck, `cargo clippy -- -D warnings`, `cargo test`, and the
production frontend build. All four must pass. CI will tell you the same
thing, but locally is faster.

## How the code is organized

`docs/ARCHITECTURE.md` is the real map — read it before a non-trivial change.
The short version:

- `src-tauri/src/platform/windows/` — every Win32 and COM call lives here and
  nowhere else. If you find yourself importing the `windows` crate outside
  this directory, that's the signal to add a function here instead.
- `src-tauri/src/commands/` — the IPC surface, one module per feature.
- `src/ipc/` — the TypeScript mirror of that surface. **Rust types and their
  TypeScript counterparts change in the same commit**, always.
- `src/features/` — one directory per user-facing surface, each owning its own
  CSS.
- `src/engine/` — themes, springs, and the PixiJS effects layer.

## House rules

These aren't style preferences; they're what keeps the app feeling right.

- **Style from tokens, never raw colors.** Components read CSS custom
  properties defined in `src/styles/tokens.css`. A hardcoded hex breaks every
  theme but the one you tested. If you need a new color, add a token and give
  each theme in `src/engine/themes/themes.ts` a value for it.
- **Animate transform and opacity only.** Anything that triggers layout or
  paint per frame will show up as idle CPU. All spring constants live in
  `src/engine/animation/springs.ts` so the app's feel is tuned in one place.
- **Idle must cost nothing.** The Pixi ticker stops when no effect is alive,
  and ambient motion pauses after the dock is left alone. Any new animation
  has to participate in that.
- **Honor `prefers-reduced-motion`.** Decorative motion turns off.
- **No `unwrap()` outside tests.** Commands return `Result<_, AeroError>`.
- **Tell the user when their action fails.** The dock has no console —
  anything the user personally asked for reports through
  `notify.error(...)` (`src/features/feedback/toastStore.ts`). Background
  chatter can stay in the console.
- **No telemetry, no analytics, no network calls.** This is a hard line. Aero
  Dock does not phone home, and pull requests that add it will be declined.
- **No new runtime dependencies without a reason.** The bundle is small and
  should stay that way.

## Reporting bugs

Open an issue with your Windows build (`winver`), your Aero Dock version
(Settings → About), and what you expected versus what happened. A screenshot
helps a lot for anything visual.

## Ideas that fit

- macOS and Linux platform backends — the platform layer is already isolated
  behind `src-tauri/src/platform/`, so this is a real, well-shaped project.
- Better UWP window grouping (see the known limitation in the README).
- New themes and ambient scenes.

## Licensing

By contributing, you agree your work is licensed under the
[MIT License](LICENSE) that covers the project.
