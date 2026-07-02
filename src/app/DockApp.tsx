/**
 * Dock window root: hydrates settings + running windows, applies
 * appearance tokens, performs the first-run app import, resolves icons,
 * and renders the bar.
 */

import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useMemo } from "react";
import { DockBar } from "../features/dock/DockBar";
import { EffectsLayer } from "../engine/effects/EffectsLayer";
import { applyAppearance } from "../engine/themes/applyTheme";
import { ipc } from "../ipc/commands";
import type { PinnedItem } from "../ipc/types";
import { buildDockItems, useDockIcons, type DockItemView } from "../state/dockStore";
import { useRunning } from "../state/runningStore";
import { useSettings } from "../state/settingsStore";
import { useState } from "react";

/** Apps most people actually keep on a dock, matched by shortcut name. */
const STARTER_APP_HINTS = [
  "microsoft edge",
  "google chrome",
  "firefox",
  "brave",
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

async function firstRunImport(): Promise<void> {
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
  // single atomic transaction on the Rust side; re-entry is a no-op
  await ipc.firstRunImport(items);
}

export function DockApp() {
  const { settings, hydrate } = useSettings();
  const { windows, focused, hydrate: hydrateRunning } = useRunning();
  const { iconUrls, resolveIcons } = useDockIcons();

  useEffect(() => {
    hydrate();
    hydrateRunning();
  }, [hydrate, hydrateRunning]);

  // pin files/shortcuts dropped onto the dock from Explorer
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type !== "drop") return;
      for (const path of event.payload.paths) {
        try {
          const entry = await ipc.resolveDrop(path);
          const current = await ipc.getSettings();
          const exists = current.pinned.some(
            (p) => p.path.toLowerCase() === entry.targetPath.toLowerCase(),
          );
          if (exists) continue;
          await ipc.pinItem({
            id: `pin-${crypto.randomUUID()}`,
            kind: entry.source === "folder" ? "folder" : "app",
            path: entry.targetPath,
            name: entry.name,
            icon: entry.icon,
            children: [],
          });
        } catch (e) {
          console.error(`could not pin dropped file ${path}`, e);
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // wallpaper accent, fetched when sync is enabled
  const [accent, setAccent] = useState<string | null>(null);
  useEffect(() => {
    if (settings?.appearance.wallpaperSync) {
      ipc
        .getWallpaperAccent()
        .then(setAccent)
        .catch((e) => console.warn("wallpaper accent unavailable", e));
    } else {
      setAccent(null);
    }
  }, [settings?.appearance.wallpaperSync]);

  // appearance tokens track settings
  useEffect(() => {
    if (settings) applyAppearance(settings, accent);
  }, [settings, accent]);

  // first run: import a starter set so launch #1 already looks alive
  useEffect(() => {
    if (settings && !settings.onboardingComplete && settings.pinned.length === 0) {
      firstRunImport().catch((e) => console.error("first-run import failed", e));
    }
  }, [settings]);

  const items = useMemo(
    () =>
      settings
        ? buildDockItems(
            settings.pinned,
            windows,
            focused,
            iconUrls,
            settings.dock.showRunningApps,
          )
        : [],
    [settings, windows, focused, iconUrls],
  );

  // resolve icons for everything visible (pinned + running)
  useEffect(() => {
    const targets = items.filter((i) => !i.iconSrc && i.target).map((i) => i.target);
    if (targets.length) resolveIcons(targets);
  }, [items, resolveIcons]);

  if (!settings) return null;

  const activate = (item: DockItemView) => {
    if (item.windows.length === 0) {
      ipc.launch(item.target, item.args).catch((e) => console.error("launch failed", e));
      return;
    }
    // running: focus it; if already focused, cycle windows (or minimize a single one)
    const focusedIdx = item.windows.findIndex((w) => w.hwnd === focused);
    if (focusedIdx === -1) {
      ipc.activateWindow(item.windows[0].hwnd);
    } else if (item.windows.length === 1) {
      ipc.minimizeWindow(item.windows[0].hwnd);
    } else {
      const next = item.windows[(focusedIdx + 1) % item.windows.length];
      ipc.activateWindow(next.hwnd);
    }
  };

  return (
    <>
      <EffectsLayer settings={settings} />
      <DockBar settings={settings} items={items} onLaunch={activate} />
    </>
  );
}
