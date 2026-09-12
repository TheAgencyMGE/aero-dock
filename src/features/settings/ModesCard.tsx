/**
 * Managing Dock Modes from the settings window.
 *
 * A mode owns its pins, its saved window layout and its per-app volumes.
 * Everything here goes through a Rust command and comes back as the full
 * settings struct on `settings://changed`, so nothing is mirrored twice.
 */

import { useState } from "react";
import { ipc } from "../../ipc/commands";
import type { DockMode, Settings } from "../../ipc/types";
import { ModeIconPicker, isPictorial, resolveGlyph } from "./ModeIconPicker";
import { AeroToggle } from "./controls";

interface Props {
  settings: Settings;
  onStatus: (tone: "ok" | "error", text: string) => void;
}

/** "just now", "12 minutes ago", "3 days ago". */
function savedAgo(capturedAt: number): string {
  if (capturedAt === 0) return "nothing saved yet";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - capturedAt);
  if (seconds < 60) return "saved just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `saved ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `saved ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `saved ${days} day${days === 1 ? "" : "s"} ago`;
}

function ModeRow({
  mode,
  active,
  onStatus,
}: {
  mode: DockMode;
  active: boolean;
  onStatus: Props["onStatus"];
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(mode.name);
  const [glyph, setGlyph] = useState(mode.glyph);
  const [apps, setApps] = useState(mode.autoSwitchApps.join(", "));

  const fail = (what: string) => (e: unknown) => onStatus("error", `${what}: ${e}`);

  return (
    <div className="mode-card" data-active={active}>
      <div className="mode-card-head">
        <span
          className="mode-card-glyph"
          data-emoji={isPictorial(resolveGlyph(mode.name, mode.glyph))}
        >
          {resolveGlyph(mode.name, mode.glyph)}
        </span>
        <div className="mode-card-title">
          <strong>{mode.name}</strong>
          <span className="mode-card-meta">
            {mode.pinned.length} pinned · {mode.workspace.windows.length} windows ·{" "}
            {mode.audio.length} volumes
          </span>
        </div>
        {active ? (
          <span className="mode-card-badge">Active</span>
        ) : (
          <button
            className="aero-button"
            onClick={() =>
              ipc
                .switchMode(mode.id)
                .then((r) => onStatus("ok", `Switched to ${r.modeName}.`))
                .catch(fail("Could not switch"))
            }
          >
            Switch to
          </button>
        )}
      </div>

      <p className="settings-note">Workspace: {savedAgo(mode.workspace.capturedAt)}</p>

      <div className="mode-card-actions">
        <button
          className="aero-button"
          onClick={() =>
            ipc
              .captureWorkspace(mode.id)
              .then(() => onStatus("ok", `Saved the open windows to ${mode.name}.`))
              .catch(fail("Could not save the workspace"))
          }
        >
          Save windows
        </button>
        <button
          className="aero-button"
          disabled={mode.workspace.windows.length === 0}
          onClick={() =>
            ipc
              .restoreWorkspace(mode.id)
              .then((r) =>
                onStatus(
                  "ok",
                  `Placed ${r.moved} window${r.moved === 1 ? "" : "s"}` +
                    (r.launched > 0 ? `, opened ${r.launched}` : "") +
                    (r.missing > 0 ? `, ${r.missing} could not be restored` : "") +
                    ".",
                ),
              )
              .catch(fail("Could not restore the workspace"))
          }
        >
          Restore windows
        </button>
        <button
          className="aero-button"
          disabled={mode.workspace.windows.length === 0}
          onClick={() =>
            ipc
              .clearWorkspace(mode.id)
              .then(() => onStatus("ok", `Cleared the saved windows for ${mode.name}.`))
              .catch(fail("Could not clear the workspace"))
          }
        >
          Clear
        </button>
        <button className="aero-button" onClick={() => setEditing((v) => !v)}>
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      {editing && (
        <div className="mode-card-edit">
          <label className="ctl-row">
            <span className="ctl-label">Name</span>
            <input
              className="ctl-text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() =>
                ipc
                  .renameMode(mode.id, name, glyph)
                  .catch(fail("Could not rename"))
              }
            />
          </label>
          <div className="mode-icon-field">
            <span className="ctl-label">Tile icon</span>
            <ModeIconPicker
              name={name}
              glyph={glyph}
              onChange={(next) => {
                setGlyph(next);
                ipc.renameMode(mode.id, name, next).catch(fail("Could not save the icon"));
              }}
            />
          </div>
          <label className="ctl-row ctl-row-stacked">
            <span className="ctl-label">Switch to this mode for</span>
            <input
              className="ctl-text"
              value={apps}
              placeholder="code.exe, slack.exe"
              onChange={(e) => setApps(e.target.value)}
              onBlur={() =>
                ipc
                  .setModeApps(
                    mode.id,
                    apps
                      .split(",")
                      .map((a) => a.trim())
                      .filter(Boolean),
                  )
                  .catch(fail("Could not save the app list"))
              }
            />
          </label>
          <p className="settings-note">
            Comma separated executable names. Bringing one of them to the front
            switches to this mode while automatic switching is on.
          </p>
          <div className="mode-card-actions">
            <button
              className="aero-button aero-button-danger"
              onClick={() =>
                ipc
                  .deleteMode(mode.id)
                  .then(() => onStatus("ok", `Deleted ${mode.name}.`))
                  .catch(fail("Could not delete the mode"))
              }
            >
              Delete mode
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ModesCard({ settings, onStatus }: Props) {
  const [newName, setNewName] = useState("");
  const modes = settings.modes;

  return (
    <section className="settings-card glass">
      <h2>Modes</h2>
      <AeroToggle
        label="Use modes"
        checked={modes.enabled}
        hint="Each mode keeps its own pinned apps, window layout and per-app volumes"
        onChange={(v) =>
          ipc
            .enableModes(v)
            .then(() =>
              onStatus(
                "ok",
                v
                  ? "Modes are on. Your current dock became the first one."
                  : "Modes are off. The dock keeps the pins it is showing.",
              ),
            )
            .catch((e) => onStatus("error", `Could not change modes: ${e}`))
        }
      />

      {modes.enabled && (
        <>
          <AeroToggle
            label="Also put windows back when switching"
            checked={modes.restoreWorkspaceOnSwitch}
            hint="Moves open windows and reopens closed apps to match the mode"
            onChange={(v) =>
              ipc
                .setRestoreWorkspaceOnSwitch(v)
                .catch((e) => onStatus("error", `Could not change that: ${e}`))
            }
          />
          <AeroToggle
            label="Switch automatically by app"
            checked={modes.autoSwitch}
            hint="Follows the app you bring to the front into the mode that claims it"
            onChange={(v) =>
              ipc
                .setAutoSwitch(v)
                .catch((e) => onStatus("error", `Could not change that: ${e}`))
            }
          />
          {modes.autoSwitch && (
            <p className="settings-note">
              An automatic switch changes pins and volumes only. It never moves
              your windows, which would fight the app you just clicked on.
            </p>
          )}

          <div className="mode-list">
            {modes.modes.map((mode) => (
              <ModeRow
                key={mode.id}
                mode={mode}
                active={mode.id === modes.activeId}
                onStatus={onStatus}
              />
            ))}
          </div>

          <div className="ctl-row">
            <span className="ctl-label">New mode</span>
            <div className="ctl-actions">
              <input
                className="ctl-text ctl-text-mid"
                value={newName}
                placeholder="Gaming"
                onChange={(e) => setNewName(e.target.value)}
              />
              <button
                className="aero-button"
                disabled={!newName.trim()}
                onClick={() =>
                  ipc
                    .createMode(newName.trim(), null, false)
                    .then(() => {
                      onStatus("ok", `Added ${newName.trim()}.`);
                      setNewName("");
                    })
                    .catch((e) => onStatus("error", `Could not add the mode: ${e}`))
                }
              >
                Add empty
              </button>
              <button
                className="aero-button"
                disabled={!newName.trim()}
                onClick={() =>
                  ipc
                    .createMode(newName.trim(), null, true)
                    .then(() => {
                      onStatus("ok", `Added ${newName.trim()} with the current pins.`);
                      setNewName("");
                    })
                    .catch((e) => onStatus("error", `Could not add the mode: ${e}`))
                }
              >
                Copy current
              </button>
            </div>
          </div>
          <p className="settings-note">
            A new mode starts with the first letter of its name on the tile.
            Open <strong>Edit</strong> on it to pick an icon.
          </p>
        </>
      )}
    </section>
  );
}
