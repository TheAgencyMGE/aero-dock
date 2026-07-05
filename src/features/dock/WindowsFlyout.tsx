/**
 * Window previews: hover (or click) an app with open windows and a
 * glass shelf rises with LIVE miniatures of each window — real DWM
 * thumbnails composited by Windows into our dock window, zero-copy.
 * Click a preview to focus that window; ✕ closes it.
 */

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { springs } from "../../engine/animation/springs";
import { ipc } from "../../ipc/commands";
import type { Settings } from "../../ipc/types";
import { targetKey, useRunning, windowKey } from "../../state/runningStore";
import { useMenu } from "./menuStore";
import "./windowsflyout.css";

const SLOT_W = 200;
const SLOT_H = 120;
const COLS_MAX = 2;

interface WindowsFlyoutProps {
  edge: Settings["dock"]["edge"];
}

export function WindowsFlyout({ edge }: WindowsFlyoutProps) {
  const { kind, item, anchor, close } = useMenu();
  const allWindows = useRunning((s) => s.windows);
  const focused = useRunning((s) => s.focused);
  const slotRefs = useRef(new Map<number, HTMLDivElement>());

  const active = kind === "windows" && item !== null && anchor !== null;

  // live view of this app's windows; flyout dissolves when they're gone
  const windows = useMemo(() => {
    if (!item) return [];
    const key = targetKey(item.target);
    return allWindows.filter((w) => windowKey(w) === key);
  }, [item, allWindows]);

  useEffect(() => {
    if (active && windows.length === 0) close();
  }, [active, windows.length, close]);

  /** Measure slot rects and hand them to DWM (physical px). */
  const placeThumbnails = useCallback(() => {
    const scale = window.devicePixelRatio;
    const slots = windows
      .map((w) => {
        const el = slotRefs.current.get(w.hwnd);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          hwnd: w.hwnd,
          x: Math.round(r.left * scale),
          y: Math.round(r.top * scale),
          w: Math.round(r.width * scale),
          h: Math.round(r.height * scale),
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
    if (slots.length) {
      ipc.showWindowPreviews(slots).catch((e) => console.error("previews failed", e));
    }
  }, [windows]);

  // tear down live previews whenever the flyout goes away
  useEffect(() => {
    if (!active) return;
    return () => {
      ipc.hideWindowPreviews().catch(() => undefined);
    };
  }, [active]);

  // window set changed while open → re-place
  useEffect(() => {
    if (active && windows.length > 0) {
      const t = setTimeout(placeThumbnails, 60);
      return () => clearTimeout(t);
    }
  }, [active, windows, placeThumbnails]);

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

  const cols = Math.min(windows.length, COLS_MAX);
  const flyoutWidth = cols * (SLOT_W + 10) + 18;

  // same edge-relative anchoring contract as the other flyouts
  const style: React.CSSProperties = { position: "absolute", width: flyoutWidth, zIndex: 100 };
  if (anchor) {
    const clamped = Math.min(
      Math.max(anchor.cx - flyoutWidth / 2, 8),
      anchor.winW - flyoutWidth - 8,
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
          exit={{ opacity: 0, scale: 0.93, transition: { duration: 0.15 } }}
          transition={springs.bloom}
          onAnimationComplete={placeThumbnails}
        >
          <div className="windows-flyout-title">{item.name}</div>
          <div
            className="windows-flyout-grid"
            style={{ gridTemplateColumns: `repeat(${cols}, ${SLOT_W}px)` }}
          >
            {windows.map((w) => (
              <div key={w.hwnd} className="windows-preview" data-focused={w.hwnd === focused}>
                <div
                  className="windows-preview-frame"
                  style={{ height: SLOT_H }}
                  ref={(el) => {
                    if (el) slotRefs.current.set(w.hwnd, el);
                    else slotRefs.current.delete(w.hwnd);
                  }}
                  onClick={() => {
                    ipc.activateWindow(w.hwnd);
                    close();
                  }}
                  title={w.title}
                />
                <div className="windows-preview-caption">
                  <span className="windows-preview-title">{w.title}</span>
                  <button
                    className="windows-flyout-close"
                    title="Close window"
                    onClick={() => ipc.closeWindow(w.hwnd)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
