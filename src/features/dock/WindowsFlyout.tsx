/**
 * Window-list flyout: click an app with several windows and pick the
 * one you mean — titles live-update from the running tracker, and each
 * row can close its window. Replaces blind window-cycling.
 */

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo } from "react";
import { springs } from "../../engine/animation/springs";
import { ipc } from "../../ipc/commands";
import type { Settings } from "../../ipc/types";
import { useRunning } from "../../state/runningStore";
import { useMenu } from "./menuStore";
import "./windowsflyout.css";

const FLYOUT_WIDTH = 300;

interface WindowsFlyoutProps {
  edge: Settings["dock"]["edge"];
}

export function WindowsFlyout({ edge }: WindowsFlyoutProps) {
  const { kind, item, anchor, close } = useMenu();
  const allWindows = useRunning((s) => s.windows);
  const focused = useRunning((s) => s.focused);

  const active = kind === "windows" && item !== null && anchor !== null;

  // live view of this app's windows; flyout dissolves when they're gone
  const windows = useMemo(() => {
    if (!item) return [];
    const exe = item.target.toLowerCase();
    return allWindows.filter((w) => w.exe.toLowerCase() === exe);
  }, [item, allWindows]);

  useEffect(() => {
    if (active && windows.length === 0) close();
  }, [active, windows.length, close]);

  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".windows-flyout")) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    let leaveTimer: ReturnType<typeof setTimeout> | undefined;
    const onLeave = () => {
      leaveTimer = setTimeout(close, 500);
    };
    const onEnter = () => clearTimeout(leaveTimer);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    document.documentElement.addEventListener("mouseleave", onLeave);
    document.documentElement.addEventListener("mouseenter", onEnter);
    return () => {
      clearTimeout(leaveTimer);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      document.documentElement.removeEventListener("mouseenter", onEnter);
    };
  }, [active, close]);

  // same edge-relative anchoring contract as the other flyouts
  const style: React.CSSProperties = { position: "absolute", width: FLYOUT_WIDTH, zIndex: 100 };
  if (anchor) {
    const clamped = Math.min(
      Math.max(anchor.cx - FLYOUT_WIDTH / 2, 8),
      anchor.winW - FLYOUT_WIDTH - 8,
    );
    switch (edge) {
      case "bottom":
        style.left = clamped;
        style.bottom = anchor.winH - anchor.top + 14;
        break;
      case "top":
        style.left = clamped;
        style.top = anchor.bottom + 14;
        break;
      case "left":
        style.left = anchor.right + 14;
        style.top = 8;
        break;
      case "right":
        style.right = anchor.winW - anchor.left + 14;
        style.top = 8;
        break;
    }
  }

  return (
    <AnimatePresence>
      {active && item && (
        <motion.div
          className="windows-flyout glass"
          style={style}
          initial={{ opacity: 0, scale: 0.84, y: edge === "top" ? -12 : 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.93, filter: "blur(6px)", transition: { duration: 0.15 } }}
          transition={springs.bloom}
        >
          <div className="windows-flyout-title">{item.name}</div>
          {windows.map((w) => (
            <div key={w.hwnd} className="windows-flyout-row" data-focused={w.hwnd === focused}>
              <button
                className="windows-flyout-activate"
                title={w.title}
                onClick={() => {
                  ipc.activateWindow(w.hwnd);
                  close();
                }}
              >
                {w.title}
              </button>
              <button
                className="windows-flyout-close"
                title="Close window"
                onClick={() => ipc.closeWindow(w.hwnd)}
              >
                ✕
              </button>
            </div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
