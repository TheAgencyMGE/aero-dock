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
import type { DockEdge, Settings } from "../../ipc/types";
import { useSettings } from "../../state/settingsStore";
import { AeroSegmented, AeroSlider, AeroToggle } from "./controls";
import "./settings.css";

const pctFmt = (v: number) => `${Math.round(v * 100)}%`;

export function SettingsApp() {
  const { settings, hydrate, apply } = useSettings();
  const [exportedTo, setExportedTo] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // settings window uses the same token system for its own glass
  useEffect(() => {
    if (settings) applyAppearance(settings);
  }, [settings]);

  if (!settings) return null;
  const { dock, appearance } = settings;

  const set = (fn: (draft: Settings) => void) => {
    apply(fn).catch((e) => console.error("settings update failed", e));
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
    }
  };

  const doImport = async (file: File) => {
    try {
      const json = await file.text();
      await ipc.importSettings(json);
    } catch (e) {
      console.error("import failed", e);
      alert(`Could not import settings: ${e}`);
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
              ipc.setTaskbarHidden(v).catch((e) => console.error("taskbar toggle failed", e));
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
                    .then(setExportedTo)
                    .catch((e) => console.error("export failed", e))
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
          {exportedTo && <p className="settings-note">Saved to {exportedTo}</p>}
        </section>

        <footer className="settings-footer">Aero Dock 0.1.0 — made with light, water, and glass.</footer>
      </main>
    </div>
  );
}
