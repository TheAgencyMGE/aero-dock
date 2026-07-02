/**
 * The dock bar: a glass shelf of icons. Owns the cursor motion value the
 * icons magnify against, and reports its deterministic content size to
 * Rust so the OS window always fits (window = dock + magnification
 * headroom + tooltip space, nothing more — transparent overhang is kept
 * small so it doesn't swallow desktop clicks).
 */

import { useMotionValue } from "motion/react";
import { useCallback, useEffect, useMemo } from "react";
import { ipc } from "../../ipc/commands";
import type { Settings } from "../../ipc/types";
import type { DockItemView } from "../../state/dockStore";
import { DockIcon } from "./DockIcon";
import "./dock.css";

const GAP = 6;
const PAD_MAIN = 18; // dock padding along the axis
const PAD_CROSS = 10; // dock padding across the axis
const LABEL_SPACE = 44; // tooltip pill above icons
const EDGE_SLACK = 24; // window slack so magnified end-icons never clip

interface DockBarProps {
  settings: Settings;
  items: DockItemView[];
  onLaunch: (item: DockItemView) => void;
}

export function DockBar({ settings, items, onLaunch }: DockBarProps) {
  const { edge, iconSize, magnification, magnificationScale } = settings.dock;
  const vertical = edge === "left" || edge === "right";
  const mouseAxis = useMotionValue(Infinity);

  const peak = magnification ? magnificationScale : 1;

  // Deterministic window size: no ResizeObserver, no feedback loops.
  const windowSize = useMemo(() => {
    const n = Math.max(items.length, 1);
    const mainBase = n * iconSize + (n - 1) * GAP + PAD_MAIN * 2;
    // neighbors near the cursor grow too; ~2 icons' worth covers the worst case
    const mainGrowth = iconSize * (peak - 1) * 2.5;
    const main = mainBase + mainGrowth + EDGE_SLACK;
    const cross = iconSize * peak + PAD_CROSS * 2 + LABEL_SPACE;
    return vertical ? { width: cross, height: main } : { width: main, height: cross };
  }, [items.length, iconSize, peak, vertical]);

  useEffect(() => {
    ipc.resizeDock(windowSize.width, windowSize.height).catch((e) => {
      console.error("resize_dock failed", e);
    });
  }, [windowSize.width, windowSize.height]);

  const handleMove = useCallback(
    (e: React.MouseEvent) => {
      mouseAxis.set(vertical ? e.clientY : e.clientX);
    },
    [mouseAxis, vertical],
  );

  const handleLeave = useCallback(() => {
    mouseAxis.set(Infinity);
  }, [mouseAxis]);

  return (
    <div className="dock-viewport" data-edge={edge}>
      <div
        className="dock-bar glass"
        data-vertical={vertical}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        {items.map((item, i) => (
          <DockIcon
            key={item.id}
            item={item}
            index={i}
            mouseAxis={mouseAxis}
            iconSize={iconSize}
            magnify={magnification}
            magScale={magnificationScale}
            vertical={vertical}
            onLaunch={onLaunch}
          />
        ))}
      </div>
    </div>
  );
}
