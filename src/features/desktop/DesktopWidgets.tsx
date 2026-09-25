/**
 * The widget overlay: one transparent window across the whole desktop,
 * with every widget positioned inside it.
 *
 * One window rather than one per widget, because a second webview costs
 * roughly what the dock costs in memory, and five would undo the work in
 * 1.2.1. The cost of sharing is that the window covers the whole screen,
 * so it has to be told which parts of itself are real: the hit region is
 * the union of the widget rectangles, and everything else passes straight
 * through to the desktop.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyAppearance } from "../../engine/themes/applyTheme";
import { ipc } from "../../ipc/commands";
import type { HitRect, WidgetInstance } from "../../ipc/types";
import { useSettings } from "../../state/settingsStore";
import { WIDGET_RADIUS, WidgetFrame } from "./WidgetFrame";
import "./desktop.css";

/** Editing chrome (resize grips) shows while the cursor is over a widget. */
function useHover(): [boolean, (v: boolean) => void] {
  const [hover, setHover] = useState(false);
  return [hover, setHover];
}

export function DesktopWidgets() {
  const { settings, hydrate } = useSettings();
  const [hover, setHover] = useHover();
  const dragging = useRef(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // The overlay carries no material of its own; each widget picks one. It
  // still needs the theme tokens, so it borrows the dock's appearance.
  useEffect(() => {
    if (settings) applyAppearance(settings, null, "dock");
  }, [settings]);

  const stored = useMemo(() => settings?.widgets.widgets ?? [], [settings]);

  /** Live geometry during a drag, before anything is persisted. */
  const [draft, setDraft] = useState<Record<string, Partial<WidgetInstance>>>({});
  const widgets = useMemo(
    () => stored.map((w) => ({ ...w, ...(draft[w.id] ?? {}) })),
    [stored, draft],
  );

  // A settled drag has nothing left to override, and leaving stale entries
  // would pin a widget to where it was dropped even after a later edit.
  useEffect(() => {
    setDraft((d) => (Object.keys(d).length === 0 ? d : {}));
  }, [stored]);

  const onGeometry = useCallback(
    (id: string, x: number, y: number, width: number, height: number) => {
      setDraft((d) => ({ ...d, [id]: { x, y, width, height } }));
    },
    [],
  );

  /** Tell Windows which parts of the overlay are solid. */
  const syncRegion = useCallback((list: WidgetInstance[]) => {
    const dpr = window.devicePixelRatio || 1;
    const rects: HitRect[] = list.map((w) => ({
      x: Math.round(w.x * dpr),
      y: Math.round(w.y * dpr),
      width: Math.round(w.width * dpr),
      height: Math.round(w.height * dpr),
      radius: Math.round(WIDGET_RADIUS * dpr),
    }));
    ipc.setWidgetHitRects(rects).catch((e) => console.warn("hit region failed", e));
  }, []);

  useEffect(() => {
    if (dragging.current) return;
    syncRegion(widgets);
  }, [widgets, syncRegion]);

  const onDragState = useCallback(
    (isDragging: boolean) => {
      dragging.current = isDragging;
      if (isDragging) {
        // open the whole window up so the pointer cannot escape the region
        ipc.setWidgetDragMode(true).catch(() => undefined);
      } else {
        syncRegion(widgets);
      }
    },
    [widgets, syncRegion],
  );

  if (!settings) return null;

  return (
    <div
      className="aero-desktop"
      onPointerOver={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      {widgets.map((widget) => (
        <WidgetFrame
          key={widget.id}
          widget={widget}
          editing={hover}
          onGeometry={onGeometry}
          onDragState={onDragState}
        />
      ))}
    </div>
  );
}
