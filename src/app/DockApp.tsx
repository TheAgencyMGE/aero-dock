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
import { notify } from "../features/feedback/toastStore";
import { ipc } from "../ipc/commands";
import { useAppAudio } from "../state/audioStore";
import { buildDockItems, useDockIcons, type DockItemView } from "../state/dockStore";
import { useFileDrag } from "../state/dragStore";
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

  // Read the mixer whenever the set of running apps changes. Sessions
  // appear and disappear with the apps that own them, and this is the
  // only signal for that; there is no polling anywhere.
  const refreshAudio = useAppAudio((a) => a.refresh);
  useEffect(() => {
    void refreshAudio();
  }, [refreshAudio, windows.length]);

  // Auto-switching: when the foreground app changes, ask Rust whether a
  // mode claims it. Rust owns the decision so the rules live in exactly
  // one place, and it answers null when nothing should happen.
  const autoSwitch = settings?.modes.enabled && settings.modes.autoSwitch;
  const focusedExe = useMemo(
    () => windows.find((w) => w.hwnd === focused)?.exe ?? "",
    [windows, focused],
  );
  useEffect(() => {
    if (!autoSwitch || !focusedExe) return;
    let cancelled = false;
    // a short settle avoids switching on windows that are only passing
    // through the foreground during a restore or an alt-tab sweep
    const timer = setTimeout(() => {
      ipc
        .foregroundChanged(focusedExe)
        .then((report) => {
          if (cancelled || !report) return;
          // the new settings arrive on their own through
          // `settings://changed`; this only says what happened
          notify.info(`Switched to ${report.modeName}`);
        })
        .catch((e) => console.warn("auto mode switch failed", e));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [autoSwitch, focusedExe]);

  // pin files/shortcuts dropped onto the dock from Explorer
  useEffect(() => {
    const setOverDock = useFileDrag.getState().setOverDock;
    const unlisten = getCurrentWebview().onDragDropEvent(async (event) => {
      // Hold the dock open while a drag is in flight. Sliding away from
      // the thing someone is aiming at is the worst moment to auto-hide.
      if (event.payload.type === "enter" || event.payload.type === "over") {
        setOverDock(true);
        return;
      }
      if (event.payload.type === "leave") {
        setOverDock(false);
        return;
      }
      if (event.payload.type !== "drop") return;
      setOverDock(false);
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
          notify.error(`Could not pin ${path.split("\\").pop()}`, e);
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
    if (targets.length) resolveIcons(targets).catch(() => undefined);
  }, [items, resolveIcons]);

  if (!settings) return null;

  const activate = (item: DockItemView) => {
    if (item.windows.length === 0) {
      ipc.launch(item.target, item.args).catch(notify.on(`Could not open ${item.name}`));
      return;
    }
    // running: focus it; if already focused, cycle windows (or minimize a single one)
    const focusedIdx = item.windows.findIndex((w) => w.hwnd === focused);
    if (focusedIdx === -1) {
      ipc.activateWindow(item.windows[0].hwnd).catch(notify.on("Could not focus that window"));
    } else if (item.windows.length === 1) {
      ipc.minimizeWindow(item.windows[0].hwnd).catch(notify.on("Could not minimize that window"));
    } else {
      const next = item.windows[(focusedIdx + 1) % item.windows.length];
      ipc.activateWindow(next.hwnd).catch(notify.on("Could not focus that window"));
    }
  };

  return (
    <>
      <EffectsLayer settings={settings} />
      <DockBar settings={settings} items={items} onLaunch={activate} />
    </>
  );
}
