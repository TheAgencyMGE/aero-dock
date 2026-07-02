/**
 * Dock window root: hydrates settings, applies appearance tokens,
 * performs the first-run app import, resolves icons, and renders the bar.
 */

import { useEffect, useMemo } from "react";
import { DockBar } from "../features/dock/DockBar";
import { applyAppearance } from "../engine/themes/applyTheme";
import { ipc } from "../ipc/commands";
import type { PinnedItem } from "../ipc/types";
import { toDockItems, useDockIcons, type DockItemView } from "../state/dockStore";
import { useSettings } from "../state/settingsStore";

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
  let index = 0;
  for (const app of picked.values()) {
    const item: PinnedItem = {
      id: `pin-${crypto.randomUUID()}`,
      kind: "app",
      path: app.targetPath,
      name: app.name,
      icon: app.icon,
      children: [],
    };
    await ipc.pinItem(item, index++);
  }
  const settings = await ipc.getSettings();
  settings.onboardingComplete = true;
  await ipc.setSettings(settings);
}

export function DockApp() {
  const { settings, hydrate } = useSettings();
  const { iconUrls, resolveIcons } = useDockIcons();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // appearance tokens track settings
  useEffect(() => {
    if (settings) applyAppearance(settings);
  }, [settings]);

  // first run: import a starter set so launch #1 already looks alive
  useEffect(() => {
    if (settings && !settings.onboardingComplete && settings.pinned.length === 0) {
      firstRunImport().catch((e) => console.error("first-run import failed", e));
    }
  }, [settings]);

  // resolve icons for whatever is pinned
  useEffect(() => {
    if (!settings) return;
    const targets = settings.pinned.map((p) => p.path).filter(Boolean);
    if (targets.length) resolveIcons(targets);
  }, [settings, resolveIcons]);

  const items = useMemo(
    () => (settings ? toDockItems(settings.pinned, iconUrls) : []),
    [settings, iconUrls],
  );

  if (!settings) return null;

  const launch = (item: DockItemView) => {
    ipc.launch(item.target, item.args).catch((e) => console.error("launch failed", e));
  };

  return <DockBar settings={settings} items={items} onLaunch={launch} />;
}
