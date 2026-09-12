/**
 * The Modes tile and its flyout.
 *
 * Switching is one click: the tile shows which mode is loaded, the
 * flyout lists the rest. Everything the switch actually does happens in
 * Rust (pins, per-app audio, and the window layout when that is turned
 * on); this only reports what came back.
 */

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { springs } from "../../engine/animation/springs";
import { ipc } from "../../ipc/commands";
import type { DockEdge, Settings } from "../../ipc/types";
import { notify } from "../feedback/toastStore";
// the glyph rules are shared with the settings picker so both ends agree
import { isPictorial, resolveGlyph } from "../settings/ModeIconPicker";
import { bloomOffset, flyoutStyle, type MenuAnchor, anchorFor } from "./menuStore";
import "./modes.css";

/** Width of the flyout, and the room the dock window has to reserve. */
export const MODE_FLYOUT_WIDTH = 232;
export const MODE_FLYOUT_HEIGHT = 300;

interface SwitcherState {
  open: boolean;
  anchor: MenuAnchor | null;
  setOpen: (open: boolean, anchor?: MenuAnchor | null) => void;
}

/** Lives outside the component so DockBar can size the window for it. */
export const useModeSwitcher = create<SwitcherState>((set) => ({
  open: false,
  anchor: null,
  setOpen: (open, anchor) => set({ open, anchor: open ? (anchor ?? null) : null }),
}));

/** Say what a switch did without making the user read numbers. */
function describe(report: {
  modeName: string;
  audioApplied: number;
  windowsMoved: number;
  appsLaunched: number;
}): string {
  const bits: string[] = [];
  if (report.windowsMoved > 0) {
    bits.push(`${report.windowsMoved} window${report.windowsMoved === 1 ? "" : "s"} placed`);
  }
  if (report.appsLaunched > 0) {
    bits.push(`${report.appsLaunched} app${report.appsLaunched === 1 ? "" : "s"} opened`);
  }
  if (report.audioApplied > 0) {
    bits.push("volumes set");
  }
  return bits.length > 0 ? `${report.modeName}: ${bits.join(", ")}` : report.modeName;
}

export function ModeSwitcher({ settings, edge }: { settings: Settings; edge: DockEdge }) {
  const { open, anchor, setOpen } = useModeSwitcher();
  const ref = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);

  const active = settings.modes.modes.find((m) => m.id === settings.modes.activeId);

  // dismiss on a click elsewhere or Escape, same as the context menu
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest(".mode-flyout") && !el.closest(".mode-tile")) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  if (!settings.modes.enabled || settings.modes.modes.length === 0) return null;

  const switchTo = (id: string) => {
    if (busy) return;
    setBusy(true);
    setOpen(false);
    ipc
      .switchMode(id)
      .then((report) => notify.info(describe(report)))
      .catch(notify.on("Could not switch mode"))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <button
        ref={ref}
        className="mode-tile"
        data-busy={busy}
        aria-label={`Mode: ${active?.name ?? "none"}`}
        aria-expanded={open}
        title={active ? `Mode: ${active.name}` : "Modes"}
        onClick={() => {
          const el = ref.current;
          setOpen(!open, el ? anchorFor(el) : null);
        }}
      >
        <span
          className="mode-tile-glyph"
          data-emoji={active ? isPictorial(resolveGlyph(active.name, active.glyph)) : false}
        >
          {active ? resolveGlyph(active.name, active.glyph) : "M"}
        </span>
      </button>

      <AnimatePresence>
        {open && anchor && (
          <motion.div
            className="mode-flyout glass"
            style={flyoutStyle(edge, anchor, MODE_FLYOUT_WIDTH, 12, MODE_FLYOUT_HEIGHT)}
            initial={{ opacity: 0, scale: 0.86, ...bloomOffset(edge) }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, filter: "blur(6px)", transition: { duration: 0.16 } }}
            transition={springs.bloom}
          >
            <div className="mode-flyout-title">Modes</div>
            {settings.modes.modes.map((mode) => (
              <button
                key={mode.id}
                className="mode-row"
                data-active={mode.id === settings.modes.activeId}
                onClick={() => switchTo(mode.id)}
              >
                <span
                  className="mode-row-glyph"
                  data-emoji={isPictorial(resolveGlyph(mode.name, mode.glyph))}
                >
                  {resolveGlyph(mode.name, mode.glyph)}
                </span>
                <span className="mode-row-body">
                  <span className="mode-row-name">{mode.name}</span>
                  <span className="mode-row-meta">
                    {mode.pinned.length} pinned
                    {mode.workspace.windows.length > 0 &&
                      ` · ${mode.workspace.windows.length} windows`}
                  </span>
                </span>
              </button>
            ))}
            <div className="mode-flyout-separator" />
            <button
              className="mode-row mode-row-plain"
              onClick={() => {
                ipc
                  .captureWorkspace()
                  .then(() => notify.info(`Saved this desktop to ${active?.name ?? "the mode"}`))
                  .catch(notify.on("Could not save the workspace"));
                setOpen(false);
              }}
            >
              Save windows to this mode
            </button>
            <button
              className="mode-row mode-row-plain"
              onClick={() => {
                ipc.openSettings().catch(notify.on("Could not open settings"));
                setOpen(false);
              }}
            >
              Manage modes…
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
