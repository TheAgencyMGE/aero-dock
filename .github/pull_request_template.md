## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- What problem does it solve, or what does it make better? -->

## Checklist

- [ ] `pnpm check` passes (typecheck, clippy, cargo test, production build)
- [ ] Ran it with `pnpm tauri:dev` and confirmed the change on-screen
- [ ] New colors go through tokens in `src/styles/tokens.css`, not raw hex
- [ ] Rust IPC types and their `src/ipc/types.ts` mirrors changed together
- [ ] No new network calls, telemetry, or analytics

## Screenshots

<!-- Required for anything visual. Before/after is ideal. -->
