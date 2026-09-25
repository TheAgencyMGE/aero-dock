/**
 * Managing desktop widgets from the settings window.
 *
 * Every control here goes through a Rust command and comes back as the
 * whole settings struct on `settings://changed`, so nothing is mirrored
 * twice and the overlay redraws itself.
 */

import { useState } from "react";
import { WIDGETS } from "../desktop/registry";
import { ipc } from "../../ipc/commands";
import type { Settings, SurfaceStyle, WidgetInstance, WidgetKind } from "../../ipc/types";
import { AeroSegmented, AeroSlider, AeroToggle } from "./controls";

interface Props {
  settings: Settings;
  onStatus: (tone: "ok" | "error", text: string) => void;
}

const DEFAULT_ACCENT = "#2f9de3";

function WidgetRow({
  widget,
  allowWeather,
  onStatus,
}: {
  widget: WidgetInstance;
  allowWeather: boolean;
  onStatus: Props["onStatus"];
}) {
  const [open, setOpen] = useState(false);
  const def = WIDGETS.find((w) => w.kind === widget.kind);
  const fail = (what: string) => (e: unknown) => onStatus("error", `${what}: ${e}`);
  const style = (patch: Parameters<typeof ipc.styleWidget>[1]) =>
    ipc.styleWidget(widget.id, patch).catch(fail("Could not change the widget"));

  const opts = widget.options;

  return (
    <div className="mode-card">
      <div className="mode-card-head">
        <span className="mode-card-glyph">{(def?.label ?? "?").charAt(0)}</span>
        <div className="mode-card-title">
          <strong>{def?.label ?? widget.kind}</strong>
          <span className="mode-card-meta">
            {Math.round(widget.width)} × {Math.round(widget.height)} ·{" "}
            {widget.surface === "liquid" ? "Liquid" : "Classic"}
            {widget.locked && " · locked"}
          </span>
        </div>
        <button className="aero-button" onClick={() => setOpen((v) => !v)}>
          {open ? "Done" : "Edit"}
        </button>
      </div>

      {open && (
        <div className="mode-card-edit">
          <AeroSegmented<SurfaceStyle>
            label="Material"
            value={widget.surface}
            options={[
              { value: "aero", label: "Classic" },
              { value: "liquid", label: "Liquid" },
            ]}
            onChange={(v) => void style({ surface: v })}
          />
          <AeroSlider
            label="Opacity"
            value={widget.opacity}
            min={0.3}
            max={1}
            step={0.02}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => void style({ opacity: v })}
          />
          <div className="ctl-row">
            <span className="ctl-label">Tint</span>
            <div className="ctl-actions">
              <input
                type="color"
                className="ctl-colour"
                aria-label="Widget tint"
                value={widget.accent ?? DEFAULT_ACCENT}
                onChange={(e) => void style({ accent: e.target.value })}
              />
              <button className="aero-button" onClick={() => void style({ accent: null })}>
                Use theme
              </button>
            </div>
          </div>
          <AeroToggle
            label="Ambient bubbles"
            checked={widget.ambient}
            hint="Also what the Liquid material refracts, since the desktop behind cannot be sampled"
            onChange={(v) => void style({ ambient: v })}
          />
          <AeroToggle
            label="Lock in place"
            checked={widget.locked}
            onChange={(v) => void style({ locked: v })}
          />

          {widget.kind === "clock" && (
            <>
              <AeroSegmented<string>
                label="Face"
                value={opts.analog ? "analog" : "digital"}
                options={[
                  { value: "analog", label: "Analogue" },
                  { value: "digital", label: "Digital" },
                ]}
                onChange={(v) => void style({ options: { ...opts, analog: v === "analog" } })}
              />
              <AeroToggle
                label="Show seconds"
                checked={opts.seconds}
                onChange={(v) => void style({ options: { ...opts, seconds: v } })}
              />
              <AeroToggle
                label="24 hour"
                checked={opts.twentyFourHour}
                onChange={(v) => void style({ options: { ...opts, twentyFourHour: v } })}
              />
            </>
          )}

          {widget.kind === "weather" && (
            <>
              <AeroSegmented<string>
                label="Units"
                value={opts.celsius ? "c" : "f"}
                options={[
                  { value: "c", label: "Celsius" },
                  { value: "f", label: "Fahrenheit" },
                ]}
                onChange={(v) => void style({ options: { ...opts, celsius: v === "c" } })}
              />
              <label className="ctl-row">
                <span className="ctl-label">Place name</span>
                <input
                  className="ctl-text"
                  defaultValue={opts.place ?? ""}
                  placeholder="Shown under the temperature"
                  onBlur={(e) => void style({ options: { ...opts, place: e.target.value || null } })}
                />
              </label>
              <div className="ctl-row">
                <span className="ctl-label">Latitude, longitude</span>
                <div className="ctl-actions">
                  <input
                    className="ctl-text ctl-text-short"
                    defaultValue={opts.latitude ?? ""}
                    placeholder="51.5"
                    aria-label="Latitude"
                    onBlur={(e) =>
                      void style({
                        options: {
                          ...opts,
                          latitude: e.target.value.trim() === "" ? null : Number(e.target.value),
                        },
                      })
                    }
                  />
                  <input
                    className="ctl-text ctl-text-short"
                    defaultValue={opts.longitude ?? ""}
                    placeholder="-0.13"
                    aria-label="Longitude"
                    onBlur={(e) =>
                      void style({
                        options: {
                          ...opts,
                          longitude: e.target.value.trim() === "" ? null : Number(e.target.value),
                        },
                      })
                    }
                  />
                </div>
              </div>
              {!allowWeather && (
                <p className="settings-note">
                  Weather stays offline until you allow it below. Nothing is
                  requested before then.
                </p>
              )}
            </>
          )}

          <div className="mode-card-actions">
            <button
              className="aero-button aero-button-danger"
              onClick={() =>
                ipc
                  .removeWidget(widget.id)
                  .then(() => onStatus("ok", `Removed the ${def?.label ?? "widget"}.`))
                  .catch(fail("Could not remove the widget"))
              }
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function WidgetsCard({ settings, onStatus }: Props) {
  const w = settings.widgets;
  const fail = (what: string) => (e: unknown) => onStatus("error", `${what}: ${e}`);
  const hasWeather = w.widgets.some((x) => x.kind === "weather");

  return (
    <section className="settings-card glass">
      <h2>Desktop widgets</h2>
      <AeroToggle
        label="Show widgets on the desktop"
        checked={w.enabled}
        hint="Draggable glass widgets that sit on the wallpaper"
        onChange={(v) =>
          ipc
            .enableWidgets(v)
            .then(() =>
              onStatus("ok", v ? "Widgets are on the desktop." : "Widgets are off."),
            )
            .catch(fail("Could not change widgets"))
        }
      />

      {w.enabled && (
        <>
          <p className="settings-note">
            Drag a widget to move it, and drag its bottom right corner to
            resize. Everywhere else on the desktop keeps working normally.
          </p>

          <div className="mode-list">
            {w.widgets.map((widget) => (
              <WidgetRow
                key={widget.id}
                widget={widget}
                allowWeather={w.allowWeatherNetwork}
                onStatus={onStatus}
              />
            ))}
          </div>

          <div className="ctl-row ctl-row-stacked">
            <span className="ctl-label">Add a widget</span>
            <div className="widget-add">
              {WIDGETS.map((def) => (
                <button
                  key={def.kind}
                  className="aero-button"
                  title={def.description}
                  onClick={() =>
                    ipc
                      .addWidget(def.kind as WidgetKind)
                      .then(() => onStatus("ok", `Added the ${def.label}.`))
                      .catch(fail("Could not add the widget"))
                  }
                >
                  {def.label}
                </button>
              ))}
            </div>
          </div>

          <AeroToggle
            label="Let the weather widget use the network"
            checked={w.allowWeatherNetwork}
            hint="Nothing else in Aero Dock makes any network request"
            onChange={(v) =>
              ipc
                .allowWeatherNetwork(v)
                .then(() =>
                  onStatus(
                    "ok",
                    v ? "Weather may now fetch conditions." : "Weather is offline again.",
                  ),
                )
                .catch(fail("Could not change that"))
            }
          />
          <p className="settings-note">
            Weather is the only widget that leaves your machine. With this on
            it asks Open-Meteo for conditions at the coordinates you set, and
            sends nothing else. There is no account and no key. Everything
            else here runs entirely offline
            {hasWeather ? "." : ", and no weather widget is on the desktop yet."}
          </p>
        </>
      )}
    </section>
  );
}
