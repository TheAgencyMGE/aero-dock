/**
 * A single dock icon: cursor-distance magnification, hover label,
 * launch bounce, idle float. All motion is springs on transform.
 */

import {
  animate,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useCallback, useRef, useState } from "react";
import { springs } from "../../engine/animation/springs";
import { effectsBus } from "../../engine/effects/effectsBus";
import type { DockItemView } from "../../state/dockStore";

interface DockIconProps {
  item: DockItemView;
  /** Cursor position along the dock axis; Infinity = cursor away. */
  mouseAxis: MotionValue<number>;
  iconSize: number;
  magnify: boolean;
  magScale: number;
  vertical: boolean;
  index: number;
  onLaunch: (item: DockItemView, target?: HTMLElement) => void;
  onContext: (item: DockItemView, target: HTMLElement) => void;
  /** Fired after dwelling on an icon that has open windows. */
  onHoverPreview: (item: DockItemView, target: HTMLElement) => void;
}

const PREVIEW_DWELL_MS = 550;

export function DockIcon({
  item,
  mouseAxis,
  iconSize,
  magnify,
  magScale,
  vertical,
  index,
  onLaunch,
  onContext,
  onHoverPreview,
}: DockIconProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // distance from cursor to this icon's center along the dock axis
  const distance = useTransform(mouseAxis, (cursor) => {
    const el = ref.current;
    if (!el || !Number.isFinite(cursor)) return Infinity;
    const rect = el.getBoundingClientRect();
    const center = vertical ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
    return cursor - center;
  });

  const reach = iconSize * 2.6;
  const peak = magnify ? magScale : 1;
  const targetWidth = useTransform(distance, [-reach, 0, reach], [
    iconSize,
    iconSize * peak,
    iconSize,
  ]);
  const width = useSpring(targetWidth, springs.magnify);

  // launch bounce (offset perpendicular to the dock edge); idle float
  // is pure CSS on the inner wrapper — zero JS per frame
  const bounce = useMotionValue(0);
  const y = useTransform(bounce, (b) => (vertical ? 0 : b));
  const x = useTransform(bounce, (b) => (vertical ? b : 0));

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      // water-drop bounce away from the edge, then settle
      animate(bounce, vertical ? -14 : -22, springs.bounce).then(() =>
        animate(bounce, 0, springs.bounce),
      );
      const r = e.currentTarget.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const win = { winW: window.innerWidth, winH: window.innerHeight };
      effectsBus.emit("ripple", { x: cx, y: r.bottom - 4, ...win });
      if (item.windows.length === 0 && item.kind !== "folder") {
        effectsBus.emit("burst", { x: cx, y: r.top + r.height / 2, ...win });
      }
      onLaunch(item, e.currentTarget);
    },
    [bounce, item, onLaunch, vertical],
  );

  const initial = item.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <motion.button
      ref={ref}
      className="dock-icon"
      style={vertical ? { height: width, width: "var(--icon-size)", x, y } : { width, x, y }}
      onClick={handleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onContext(item, e.currentTarget);
      }}
      onMouseEnter={(e) => {
        setHovered(true);
        if (item.windows.length > 0) {
          const el = e.currentTarget;
          dwellTimer.current = setTimeout(() => onHoverPreview(item, el), PREVIEW_DWELL_MS);
        }
      }}
      onMouseLeave={() => {
        setHovered(false);
        clearTimeout(dwellTimer.current);
      }}
      aria-label={item.name}
    >
      {hovered && !vertical && (
        <motion.span
          className="dock-label"
          initial={{ opacity: 0, y: 6, x: "-50%", scale: 0.9 }}
          animate={{ opacity: 1, y: 0, x: "-50%", scale: 1 }}
          transition={springs.bloom}
        >
          {item.name}
        </motion.span>
      )}
      <span
        className="dock-icon-float"
        style={{ animationDelay: `${(index * -0.9).toFixed(2)}s` }}
      >
        {item.kind === "stack" ? (
          <span className="dock-stack">
            {item.children.slice(0, 4).map((child, i) =>
              item.childIcons[i] ? (
                <img key={child.id} src={item.childIcons[i]!} alt="" draggable={false} />
              ) : (
                <span key={child.id} className="dock-stack-slot" />
              ),
            )}
          </span>
        ) : item.iconSrc ? (
          <img src={item.iconSrc} alt="" draggable={false} />
        ) : (
          <span className="dock-icon-glyph">{initial}</span>
        )}
      </span>
      {item.windows.length > 0 && (
        <span className="dock-indicator" data-focused={item.focused} />
      )}
    </motion.button>
  );
}
