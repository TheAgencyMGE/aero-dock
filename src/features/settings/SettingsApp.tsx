/**
 * The settings window: a Frutiger Aero control panel. Every change goes
 * through the settings store → Rust → broadcast, so the dock restyles
 * live while you drag a slider.
 */

import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useRef, useState } from "react";
import { applyAppearance } from "../../engine/themes/applyTheme";
import { THEMES } from "../../engine/themes/themes";
import { ipc } from "../../ipc/commands";
import type {
  DockEdge,
  MonitorInfoEx,
  Settings,
  StorageInfo,
  SurfaceStyle,
} from "../../ipc/types";
import { useSettings } from "../../state/settingsStore";
import { AudioCard } from "./AudioCard";
import { ModesCard } from "./ModesCard";
import { AeroSegmented, AeroSlider, AeroToggle } from "./controls";
import "./settings.css";

const REPO_URL = "https://github.com/TheAgencyMGE/aero-dock";

const pctFmt = (v: number) => `${Math.round(v * 100)}%`;

/** One inline status line under the settings-file controls. The window
 * has room to say what happened, so nothing here needs a modal. */
interface Status {
  tone: "ok" | "error";
  text: string;
}

export function SettingsApp() {
  const { settings, hydrate, apply } = useSettings();
  const [status, setStatus] = useState<Status | null>(null);
  const [monitors, setMonitors] = useState<MonitorInfoEx[]>([]);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const [hydrateFailed, setHydrateFailed] = useState(false);
  useEffect(() => {
    hydrate().catch((e) => {
      console.error("settings hydrate failed", e);
      setHydrateFailed(true);
    });
    ipc
      .listMonitors()
      .then(setMonitors)
      .catch((e) => console.warn("monitor list unavailable", e));
    ipc
      .storageInfo()
      .then(setStorage)
      .catch((e) => console.warn("storage info unavailable", e));
  }, [hydrate]);

  // settings window uses the same token system for its own glass
  useEffect(() => {
    if (settings) applyAppearance(settings, null, "settings");
  }, [settings]);

  // The window paints its sky immediately; this is what fills it until
  // settings arrive from Rust (or says so if they never do).
  if (!settings) {
    return (
      <div className="settings-root settings-root-centered">
        {hydrateFailed ? (
          <div className="settings-splash">
            <span className="settings-orb" aria-hidden />
            <p>Aero Dock could not read its settings.</p>
            <p className="settings-splash-hint">
              Close this window and restart Aero Dock from the tray icon.
            </p>
          </div>
        ) : (
          <div className="settings-splash">
            <span className="settings-orb settings-orb-pulse" aria-hidden />
            <p>Loading your dock…</p>
          </div>
        )}
      </div>
    );
  }
  const { dock, appearance } = settings;

  const set = (fn: (draft: Settings) => void) => {
    apply(fn).catch((e) => {
      console.error("settings update failed", e);
      setStatus({ tone: "error", text: `Could not save that change: ${e}` });
    });
  };

  const toggleStartup = async (on: boolean) => {
    try {
      if (on) await enable();
      else await disable();
      const actual = await isEnabled();
      set((d) => {
        d.launchAtStartup = actual;
      });
    } catch (e) {
      console.error("autostart toggle failed", e);
      setStatus({ tone: "error", text: `Could not change the startup setting: ${e}` });
    }
  };

  const doImport = async (file: File) => {
    try {
      const json = await file.text();
      await ipc.importSettings(json);
      setStatus({ tone: "ok", text: `Imported settings from ${file.name}.` });
    } catch (e) {
      console.error("import failed", e);
      setStatus({ tone: "error", text: `Could not import that file: ${e}` });
    }
  };

  return (
    <div className="settings-root">
      {/* ambient scenery: slow bubbles rising through the light */}
      <div className="settings-bubbles" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="settings-bubble" style={{ ["--i" as string]: i }} />
        ))}
      </div>
      <header className="settings-header">
        <span className="settings-orb" aria-hidden />
        <div>
          <h1>Aero Dock</h1>
          <p>Bring beauty back to the desktop.</p>
        </div>
      </header>

      <main className="settings-scroll">
        {/* ---- themes ---- */}
        <section className="settings-card glass">
          <h2>Theme</h2>
          <div className="theme-grid">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className="theme-swatch"
                data-active={appearance.theme === t.id}
                onClick={() => set((d) => void (d.appearance.theme = t.id))}
              >
                <span
                  className="theme-swatch-preview"
                  style={{ background: `linear-gradient(150deg, ${t.preview[0]}, ${t.preview[1]})` }}
                />
                <span className="theme-swatch-name">{t.name}</span>
              </button>
            ))}
          </div>

          <AeroSegmented<SurfaceStyle>
            label="Dock material"
            value={appearance.dockSurface}
            options={[
              { value: "aero", label: "Classic" },
              { value: "liquid", label: "Liquid" },
            ]}
            onChange={(v) => set((d) => void (d.appearance.dockSurface = v))}
          />
          <AeroSegmented<SurfaceStyle>
            label="Settings material"
            value={appearance.settingsSurface}
            options={[
              { value: "aero", label: "Classic" },
              { value: "liquid", label: "Liquid" },
            ]}
            onChange={(v) => set((d) => void (d.appearance.settingsSurface = v))}
          />
          <p className="settings-note">
            Classic is the glossy Aero panel. Liquid keeps the same colours but
            renders as thin glass: less tint in the body, the light moved to the
            rim. The two windows are set separately, so you can mix them.
          </p>

        </section>

        {/* ---- dock ---- */}
        <section className="settings-card glass">
          <h2>Dock</h2>
          <AeroSegmented<DockEdge>
            label="Position"
            value={dock.edge}
            options={[
              { value: "bottom", label: "Bottom" },
              { value: "top", label: "Top" },
              { value: "left", label: "Left" },
              { value: "right", label: "Right" },
            ]}
            onChange={(edge) => set((d) => void (d.dock.edge = edge))}
          />
          {monitors.length > 1 && (
            <AeroSegmented<string>
              label="Monitor"
              value={dock.monitor ?? ""}
              options={monitors.map((m) => ({
                value: m.isPrimary ? "" : m.name,
                label: `${m.name.replace(/^\\\\\.\\/, "")}${m.isPrimary ? " (primary)" : ""}`,
              }))}
              onChange={(name) => set((d) => void (d.dock.monitor = name || null))}
            />
          )}
          <AeroSlider
            label="Icon size"
            value={dock.iconSize}
            min={32}
            max={80}
            step={2}
            format={(v) => `${v}px`}
            onChange={(v) => set((d) => void (d.dock.iconSize = v))}
          />
          <AeroToggle
            label="Magnification"
            checked={dock.magnification}
            onChange={(v) => set((d) => void (d.dock.magnification = v))}
          />
          {dock.magnification && (
            <AeroSlider
              label="Magnification amount"
              value={dock.magnificationScale}
              min={1.1}
              max={1.9}
              step={0.05}
              format={(v) => `${Math.round((v - 1) * 100)}%`}
              onChange={(v) => set((d) => void (d.dock.magnificationScale = v))}
            />
          )}
          <AeroToggle
            label="Floating (detached from edge)"
            checked={dock.floating}
            onChange={(v) => set((d) => void (d.dock.floating = v))}
          />
          <AeroToggle
            label="Show running applications"
            checked={dock.showRunningApps}
            onChange={(v) => set((d) => void (d.dock.showRunningApps = v))}
          />
          <AeroToggle
            label="Automatically hide the dock"
            checked={dock.autoHide}
            hint="The dock slides away and returns when you move the mouse to the screen edge"
            onChange={(v) => set((d) => void (d.dock.autoHide = v))}
          />
          {dock.autoHide && (
            <AeroSlider
              label="Hide after"
              value={dock.autoHideDelayMs}
              min={200}
              max={5000}
              step={100}
              format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`)}
              onChange={(v) => set((d) => void (d.dock.autoHideDelayMs = v))}
            />
          )}
        </section>

        {/* ---- what the dock shows ---- */}
        <section className="settings-card glass">
          <h2>Dock items</h2>
          <AeroToggle
            label="Search button"
            checked={dock.showSearchButton}
            onChange={(v) => set((d) => void (d.dock.showSearchButton = v))}
          />
          <AeroToggle
            label="Settings button"
            checked={dock.showSettingsButton}
            onChange={(v) => set((d) => void (d.dock.showSettingsButton = v))}
          />
          <AeroToggle
            label="Clock and date"
            checked={dock.showClock}
            onChange={(v) => set((d) => void (d.dock.showClock = v))}
          />
          <AeroToggle
            label="Battery, network, volume, Recycle Bin"
            checked={dock.showSystemStatus}
            onChange={(v) => set((d) => void (d.dock.showSystemStatus = v))}
          />
        </section>

        {/* ---- appearance ---- */}
        <section className="settings-card glass">
          <h2>Glass &amp; Light</h2>
          <AeroSlider
            label="Opacity"
            value={appearance.transparency}
            min={0.3}
            max={1}
            format={pctFmt}
            onChange={(v) => set((d) => void (d.appearance.transparency = v))}
          />
          <AeroSlider
            label="Glass intensity"
            value={appearance.glassIntensity}
            min={0}
            max={1}
            format={pctFmt}
            onChange={(v) => set((d) => void (d.appearance.glassIntensity = v))}
          />
          <AeroSlider
            label="Bloom"
            value={appearance.bloomAmount}
            min={0}
            max={1}
            format={pctFmt}
            onChange={(v) => set((d) => void (d.appearance.bloomAmount = v))}
          />
          <AeroSlider
            label="Reflections"
            value={appearance.reflectionStrength}
            min={0}
            max={1}
            format={pctFmt}
            onChange={(v) => set((d) => void (d.appearance.reflectionStrength = v))}
          />
          <AeroSegmented<string>
            label="Ambient scene"
            value={appearance.scene}
            options={[
              { value: "none", label: "None" },
              { value: "dust", label: "Dust" },
              { value: "rain", label: "Rain" },
              { value: "snow", label: "Snow" },
              { value: "bubbles", label: "Ocean" },
              { value: "aurora", label: "Aurora" },
            ]}
            onChange={(v) => set((d) => void (d.appearance.scene = v))}
          />
          <AeroSlider
            label="Particles"
            value={appearance.particleDensity}
            min={0}
            max={1}
            format={pctFmt}
            onChange={(v) => set((d) => void (d.appearance.particleDensity = v))}
          />
          <AeroToggle
            label="Tint from wallpaper"
            checked={appearance.wallpaperSync}
            hint="Derives the accent color from your current wallpaper"
            onChange={(v) => set((d) => void (d.appearance.wallpaperSync = v))}
          />
          <AeroSlider
            label="Animation speed"
            value={appearance.animationSpeed}
            min={0.5}
            max={2}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(v) => set((d) => void (d.appearance.animationSpeed = v))}
          />
        </section>

        {/* ---- behavior ---- */}
        <section className="settings-card glass">
          <h2>Behavior</h2>
          <AeroToggle
            label="Start Aero Dock when I sign in"
            checked={settings.launchAtStartup}
            onChange={toggleStartup}
          />
          <AeroToggle
            label="Hide the Windows taskbar"
            checked={settings.hideTaskbar}
            hint="Puts the Windows taskbar into auto-hide so Aero Dock is your bar; restored when you quit"
            onChange={(v) => {
              ipc.setTaskbarHidden(v).catch((e) => {
                console.error("taskbar toggle failed", e);
                setStatus({ tone: "error", text: `Could not change the taskbar: ${e}` });
              });
              set((d) => void (d.hideTaskbar = v));
            }}
          />
          <div className="ctl-row">
            <span className="ctl-label">Settings file</span>
            <div className="ctl-actions">
              <button
                className="aero-button"
                onClick={() =>
                  ipc
                    .exportSettingsFile()
                    .then((path) => setStatus({ tone: "ok", text: `Saved to ${path}` }))
                    .catch((e) => {
                      console.error("export failed", e);
                      setStatus({ tone: "error", text: `Could not export settings: ${e}` });
                    })
                }
              >
                Export…
              </button>
              <button className="aero-button" onClick={() => importRef.current?.click()}>
                Import…
              </button>
              <input
                ref={importRef}
                type="file"
                accept=".json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) doImport(f);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
          <div className="ctl-row">
            <span className="ctl-label">Quit Aero Dock</span>
            <div className="ctl-actions">
              <button
                className="aero-button aero-button-danger"
                onClick={() =>
                  ipc
                    .quitApp()
                    .catch((e) =>
                      setStatus({ tone: "error", text: `Could not quit: ${e}` }),
                    )
                }
              >
                Quit
              </button>
            </div>
          </div>
          <p className="settings-note">
            Also available by right-clicking the Aero Dock tray icon.
          </p>
          {status && (
            <p className="settings-note" data-tone={status.tone} role="status">
              {status.text}
            </p>
          )}
        </section>

        <ModesCard
          settings={settings}
          onStatus={(tone, text) => setStatus({ tone, text })}
        />

        <AudioCard
          settings={settings}
          onStatus={(tone, text) => setStatus({ tone, text })}
        />

        {/* ---- about ---- */}
        <section className="settings-card glass">
          <h2>About</h2>
          <div className="ctl-row">
            <span className="ctl-label">Version</span>
            <span className="settings-about-value">Aero Dock {__APP_VERSION__}</span>
          </div>
          {storage && (
            <>
              <div className="ctl-row">
                <span className="ctl-label">Storage</span>
                <span className="settings-about-value">
                  {storage.portable ? "Portable" : "Installed"}
                </span>
              </div>
              <p className="settings-note settings-path">{storage.dataDir}</p>
            </>
          )}
          <div className="ctl-row">
            <span className="ctl-label">Project</span>
            <div className="ctl-actions">
              <button
                className="aero-button"
                onClick={() =>
                  ipc
                    .launch(REPO_URL)
                    .catch((e) => setStatus({ tone: "error", text: `Could not open the browser: ${e}` }))
                }
              >
                View on GitHub
              </button>
            </div>
          </div>
        </section>

        <footer className="settings-footer">
          Aero Dock {__APP_VERSION__} — made with light, water, and glass.
        </footer>
      </main>
    </div>
  );
}
