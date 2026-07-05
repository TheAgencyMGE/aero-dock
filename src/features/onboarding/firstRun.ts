/**
 * First-run import: pick a starter set of recognizable apps so the
 * dock is alive from the first second. Atomic + idempotent on the
 * Rust side.
 */

import { ipc } from "../../ipc/commands";
import type { PinnedItem } from "../../ipc/types";

/** Apps most people actually keep on a dock, matched by shortcut name. */
const STARTER_APP_HINTS = [
  "microsoft edge",
  "google chrome",
  "firefox",
  "brave",
  "opera",
  "file explorer",
  "outlook",
  "word",
  "excel",
  "powerpoint",
  "notepad",
  "visual studio code",
  "spotify",
  "steam",
  "discord",
  "vlc",
  "calculator",
  "terminal",
];

const MAX_STARTER_APPS = 10;

export async function importStarterApps(): Promise<void> {
  const apps = await ipc.listApps();
  const picked = new Map<string, (typeof apps)[number]>();
  for (const hint of STARTER_APP_HINTS) {
    if (picked.size >= MAX_STARTER_APPS) break;
    const match = apps.find((a) => a.name.toLowerCase().includes(hint));
    if (match && !picked.has(match.targetPath)) picked.set(match.targetPath, match);
  }
  // fill remaining slots with start-menu apps so the dock never starts empty
  for (const app of apps) {
    if (picked.size >= Math.min(MAX_STARTER_APPS, 6)) break;
    if (app.source === "start-menu" && !picked.has(app.targetPath)) {
      picked.set(app.targetPath, app);
    }
  }
  const items: PinnedItem[] = [...picked.values()].map((app) => ({
    id: `pin-${crypto.randomUUID()}`,
    kind: "app",
    path: app.targetPath,
    name: app.name,
    icon: app.icon,
    children: [],
  }));
  await ipc.firstRunImport(items);
}

/** Skip the import and start with an empty dock. */
export async function startEmpty(): Promise<void> {
  await ipc.firstRunImport([]);
}
