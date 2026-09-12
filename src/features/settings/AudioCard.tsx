/**
 * The volume mixer, mirroring what scrolling a dock icon does.
 *
 * Only apps that currently hold an audio session appear, which is the
 * same rule the Windows mixer follows: an app that is not making sound
 * has no volume to set.
 */

import { useEffect } from "react";
import { ipc } from "../../ipc/commands";
import type { Settings } from "../../ipc/types";
import { useAppAudio } from "../../state/audioStore";
import { AeroSlider } from "./controls";

interface Props {
  settings: Settings;
  onStatus: (tone: "ok" | "error", text: string) => void;
}

export function AudioCard({ settings, onStatus }: Props) {
  const levels = useAppAudio((a) => a.levels);
  const refresh = useAppAudio((a) => a.refresh);
  const setLevel = useAppAudio((a) => a.setLevel);
  const toggleMute = useAppAudio((a) => a.toggleMute);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const apps = Object.values(levels).sort((a, b) => a.name.localeCompare(b.name));
  const activeMode = settings.modes.modes.find((m) => m.id === settings.modes.activeId);

  return (
    <section className="settings-card glass">
      <h2>App volume</h2>
      <p className="settings-note">
        Scroll an app on the dock to change its volume, or middle-click to
        mute it. Right-click an icon to pick an output.
      </p>

      {apps.length === 0 ? (
        <p className="settings-note">
          Nothing is playing audio right now.{" "}
          <button className="aero-button-link" onClick={() => void refresh()}>
            Check again
          </button>
        </p>
      ) : (
        <>
          {apps.map((app) => (
            <div key={app.exe} className="audio-row">
              <AeroSlider
                label={app.name}
                value={app.muted ? 0 : app.volume}
                min={0}
                max={100}
                step={1}
                format={(v) => (app.muted ? "muted" : `${Math.round(v)}%`)}
                onChange={(v) => void setLevel(app.exe, Math.round(v))}
              />
              <button
                className="aero-button"
                onClick={() => void toggleMute(app.exe)}
              >
                {app.muted ? "Unmute" : "Mute"}
              </button>
            </div>
          ))}
          <button className="aero-button" onClick={() => void refresh()}>
            Refresh
          </button>
        </>
      )}

      {activeMode && (
        <p className="settings-note">
          {activeMode.audio.length === 0
            ? `${activeMode.name} has not remembered any volumes yet. Changing one stores it here.`
            : `${activeMode.name} remembers ${activeMode.audio.length} app volume${
                activeMode.audio.length === 1 ? "" : "s"
              } and puts them back when you switch to it.`}
        </p>
      )}

      {!settings.modes.enabled && (
        <p className="settings-note">
          Turn on Modes to have these volumes restored automatically.{" "}
          <button
            className="aero-button-link"
            onClick={() =>
              ipc
                .enableModes(true)
                .then(() => onStatus("ok", "Modes are on."))
                .catch((e) => onStatus("error", `Could not turn on modes: ${e}`))
            }
          >
            Turn on Modes
          </button>
        </p>
      )}
    </section>
  );
}
