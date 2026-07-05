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
import { buildDockItems, useDockIcons, type DockItemView } from "../state/dockStore";
import { useRunning } from "../state/runningStore";
import { useSettings } from "../state/settingsStore";
import { useState } from "react";

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

  // first-run onboarding lives in DockBar (Welcome card)

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

  // resolve icons for everything visible (pinned + running + stack children)
  useEffect(() => {
    const targets = items.filter((i) => !i.iconSrc && i.target).map((i) => i.target);
    for (const item of items) {
      item.children.forEach((c, idx) => {
        if (c.path && !item.childIcons[idx]) targets.push(c.path);
      });
    }
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
