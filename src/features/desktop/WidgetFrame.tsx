/**
 * The shell every widget sits in: glass, drag, resize, and the ambient
 * layer underneath.
 *
 * The widget is built in three layers, which is what lets Liquid actually
 * refract out here. The overlay window is transparent, so a backdrop
 * filter has no desktop pixels to bend, exactly like the dock. What it
 * does have is the widget's own ambient layer: bubbles painted at the
 * back, the glass panel above them, and the content on top. The glass
 * bends its own bubbles, so the material reads as glass on the desktop
 * without needing anything from behind the window.
 *
 * The bubbles hold still on purpose. Anything moving behind a refracting
 * panel forces it to redraw every frame, which is the one way this gets
 * expensive.
 */

import { useCallback, useMemo, useRef } from "react";
import { glassBackdrop } from "../../engine/glass/displacement";
import { ipc } from "../../ipc/commands";
import type { WidgetInstance } from "../../ipc/types";
import { definitionFor } from "./registry";

/** Corner radius of a widget, shared with the hit region so the clickable
 *  area matches the glass rather than clipping square corners. */
export const WIDGET_RADIUS = 20;

/** Refraction settings, a little softer than the settings window because
 *  a widget is smaller and the rim would otherwise dominate it. */
const DEPTH = 7;
const STRENGTH = 52;
const ABERRATION = 3;
const BLUR = 3;

/** Matches MAX_SIZE in core/widgets.rs. Clamping here too means a resize
 *  stops at the limit instead of snapping back after it is saved. */
const MAX_SIZE = 1600;
/** Matches KEEP_REACHABLE in commands/widgets.rs. */
const KEEP_REACHABLE = 44;

interface Props {
  widget: WidgetInstance;
  allowNetwork: boolean;
  /** Live geometry during a drag, before it has been persisted. */
  onGeometry: (id: string, x: number, y: number, w: number, h: number) => void;
  onDragState: (dragging: boolean) => void;
  editing: boolean;
}

type Mode = { kind: "move" | "resize"; startX: number; startY: number; ox: number; oy: number; ow: number; oh: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function WidgetFrame({ widget, allowNetwork, onGeometry, onDragState, editing }: Props) {
  const def = definitionFor(widget.kind);
  const mode = useRef<Mode | null>(null);

  // The filter is keyed on size, so it is only rebuilt when the widget is
  // actually resized rather than on every render.
  const backdrop = useMemo(() => {
    if (widget.surface !== "liquid") return undefined;
    return glassBackdrop(
      {
        width: Math.round(widget.width),
        height: Math.round(widget.height),
        radius: WIDGET_RADIUS,
        depth: DEPTH,
        strength: STRENGTH,
        chromaticAberration: ABERRATION,
      },
      BLUR,
    );
  }, [widget.surface, widget.width, widget.height]);

  const begin = useCallback(
    (e: React.PointerEvent, kind: "move" | "resize") => {
      // Primary button only. Right-clicking a widget used to start a drag
      // and carry it off with the pointer, which is not what anyone means
      // by a right-click.
      if (e.button !== 0) return;
      if (widget.locked) return;
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      mode.current = {
        kind,
        startX: e.screenX,
        startY: e.screenY,
        ox: widget.x,
        oy: widget.y,
        ow: widget.width,
        oh: widget.height,
      };
      // The hit region is only the widget, so a drag that leaves it would
      // lose the pointer. Opening the whole overlay up keeps the capture.
      onDragState(true);
    },
    [widget, onDragState],
  );

  const move = useCallback(
    (e: React.PointerEvent) => {
      const m = mode.current;
      if (!m) return;
      const dx = e.screenX - m.startX;
      const dy = e.screenY - m.startY;
      if (m.kind === "move") {
        // Stop a drag at the edge rather than letting the widget leave the
        // desktop, which would leave nothing to grab it by. Rust clamps the
        // saved value too; this is what makes it feel deliberate.
        const keepX = Math.min(KEEP_REACHABLE, m.ow);
        const keepY = Math.min(KEEP_REACHABLE, m.oh);
        const x = clamp(m.ox + dx, keepX - m.ow, window.innerWidth - keepX);
        const y = clamp(m.oy + dy, keepY - m.oh, window.innerHeight - keepY);
        onGeometry(widget.id, x, y, m.ow, m.oh);
      } else {
        const minW = def?.minWidth ?? 120;
        const minH = def?.minHeight ?? 120;
        onGeometry(
          widget.id,
          m.ox,
          m.oy,
          clamp(m.ow + dx, minW, MAX_SIZE),
          clamp(m.oh + dy, minH, MAX_SIZE),
        );
      }
    },
    [widget.id, def, onGeometry],
  );

  const end = useCallback(
    (e: React.PointerEvent) => {
      if (!mode.current) return;
      mode.current = null;
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      onDragState(false);
      ipc
        .placeWidget(widget.id, widget.x, widget.y, widget.width, widget.height)
        .catch((err) => console.warn("could not save the widget position", err));
    },
    [widget.id, widget.x, widget.y, widget.width, widget.height, onDragState],
  );

  const Body = def?.component;

  return (
    <div
      className="aero-widget"
      data-surface={widget.surface}
      data-editing={editing}
      data-locked={widget.locked}
      style={{
        left: widget.x,
        top: widget.y,
        width: widget.width,
        height: widget.height,
        opacity: widget.opacity,
        // a per-widget tint overrides the theme accent for its own subtree
        ...(widget.accent ? ({ "--aero-accent": widget.accent } as React.CSSProperties) : {}),
      }}
      onPointerDown={(e) => begin(e, "move")}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {widget.ambient && (
        <span className="aero-widget-ambient" aria-hidden>
          <i style={{ left: "10%", top: "16%", width: "22%", aspectRatio: "1" }} />
          <i style={{ left: "58%", top: "6%", width: "30%", aspectRatio: "1" }} />
          <i style={{ left: "34%", top: "56%", width: "40%", aspectRatio: "1" }} />
          <i style={{ left: "80%", top: "62%", width: "16%", aspectRatio: "1" }} />
        </span>
      )}

      <div className="aero-widget-glass glass" style={backdrop ? { backdropFilter: backdrop } : undefined}>
        <div className="aero-widget-body">
          {Body ? <Body widget={widget} allowNetwork={allowNetwork} /> : null}
        </div>
      </div>

      {editing && !widget.locked && (
        <span
          className="aero-widget-resize"
          title="Drag to resize"
          onPointerDown={(e) => begin(e, "resize")}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      )}
    </div>
  );
}
