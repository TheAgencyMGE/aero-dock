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
import { useCallback, useEffect, useRef, useState } from "react";
import { idleFloat, springs } from "../../engine/animation/springs";
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
  onLaunch: (item: DockItemView) => void;
}

export function DockIcon({
  item,
  mouseAxis,
  iconSize,
  magnify,
  magScale,
  vertical,
  index,
  onLaunch,
}: DockIconProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);

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

  // launch bounce (offset perpendicular to the dock edge)
  const bounce = useMotionValue(0);

  // idle float: phase-offset sine drift so the dock feels alive
  const float = useMotionValue(0);
  useEffect(() => {
    let raf = 0;
    let running = true;
    const phase = index * 0.9;
    const tick = (t: number) => {
      if (!running) return;
      float.set(Math.sin((t / 1000 / idleFloat.period) * Math.PI * 2 + phase) * idleFloat.amplitude);
      raf = requestAnimationFrame(tick);
    };
    const onVisibility = () => {
      running = document.visibilityState === "visible";
      if (running) raf = requestAnimationFrame(tick);
      else cancelAnimationFrame(raf);
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      raf = requestAnimationFrame(tick);
    }
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [float, index]);

  const y = useTransform<number, number>([bounce, float], ([b, f]) =>
    vertical ? 0 : (b as number) + (f as number),
  );
  const x = useTransform<number, number>([bounce, float], ([b, f]) =>
    vertical ? (b as number) + (f as number) : 0,
  );

  const handleClick = useCallback(() => {
    // water-drop bounce away from the edge, then settle
    animate(bounce, vertical ? -14 : -22, springs.bounce).then(() =>
      animate(bounce, 0, springs.bounce),
    );
    onLaunch(item);
  }, [bounce, item, onLaunch, vertical]);

  const initial = item.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <motion.button
      ref={ref}
      className="dock-icon"
      style={vertical ? { height: width, width: "var(--icon-size)", x, y } : { width, x, y }}
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
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
      {item.iconSrc ? (
        <img src={item.iconSrc} alt="" draggable={false} />
      ) : (
        <span className="dock-icon-glyph">{initial}</span>
      )}
    </motion.button>
  );
}
