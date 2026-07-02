/**
 * The dock bar: a glass shelf of icons. Owns the cursor motion value the
 * icons magnify against, drag-reordering of the pinned section, and the
 * deterministic window-size report to Rust (window = dock + magnification
 * headroom + tooltip space + flyout space when a menu is open).
 */

import { Reorder, useMotionValue } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { springs } from "../../engine/animation/springs";
import { ipc } from "../../ipc/commands";
import type { Settings } from "../../ipc/types";
import type { DockItemView } from "../../state/dockStore";
import { ContextMenu } from "./ContextMenu";
import { DockIcon } from "./DockIcon";
import { useMenu, type MenuAnchor } from "./menuStore";
import "./dock.css";

const GAP = 6;
const PAD_MAIN = 18; // dock padding along the axis
const PAD_CROSS = 10; // dock padding across the axis
const LABEL_SPACE = 44; // tooltip pill above icons
const EDGE_SLACK = 24; // window slack so magnified end-icons never clip
const MENU_SPACE = 360; // extra cross-axis room while a context menu is open

interface DockBarProps {
  settings: Settings;
  items: DockItemView[];
  onLaunch: (item: DockItemView) => void;
}

export function DockBar({ settings, items, onLaunch }: DockBarProps) {
  const { edge, iconSize, magnification, magnificationScale } = settings.dock;
  const vertical = edge === "left" || edge === "right";
  const mouseAxis = useMotionValue(Infinity);
  const menu = useMenu();
  const draggingRef = useRef(false);

  const pinnedItems = useMemo(() => items.filter((i) => i.pinned), [items]);
  const runningItems = useMemo(() => items.filter((i) => !i.pinned), [items]);

  // Local order during a drag; resynced from settings between drags.
  const [order, setOrder] = useState<string[]>(() => pinnedItems.map((i) => i.id));
  useEffect(() => {
    if (!draggingRef.current) setOrder(pinnedItems.map((i) => i.id));
  }, [pinnedItems]);

  const orderedPinned = useMemo(() => {
    const byId = new Map(pinnedItems.map((i) => [i.id, i]));
    const seq = order.map((id) => byId.get(id)).filter(Boolean) as DockItemView[];
    for (const item of pinnedItems) if (!order.includes(item.id)) seq.push(item);
    return seq;
  }, [order, pinnedItems]);

  const peak = magnification ? magnificationScale : 1;
  const menuOpen = menu.item !== null;

  // Deterministic window size: no ResizeObserver, no feedback loops.
  const windowSize = useMemo(() => {
    const n = Math.max(items.length, 1);
    const dividers = runningItems.length > 0 ? 1 : 0;
    const mainBase = n * iconSize + (n - 1 + dividers) * GAP + dividers * 8 + PAD_MAIN * 2;
    // neighbors near the cursor grow too; ~2.5 icons' worth covers the worst case
    const mainGrowth = iconSize * (peak - 1) * 2.5;
    const main = mainBase + mainGrowth + EDGE_SLACK;
    const cross = iconSize * peak + PAD_CROSS * 2 + LABEL_SPACE + (menuOpen ? MENU_SPACE : 0);
    return vertical ? { width: cross, height: main } : { width: main, height: cross };
  }, [items.length, runningItems.length, iconSize, peak, vertical, menuOpen]);

  useEffect(() => {
    ipc.resizeDock(windowSize.width, windowSize.height).catch((e) => {
      console.error("resize_dock failed", e);
    });
  }, [windowSize.width, windowSize.height]);

  const handleMove = useCallback(
    (e: React.MouseEvent) => {
      if (!draggingRef.current) mouseAxis.set(vertical ? e.clientY : e.clientX);
    },
    [mouseAxis, vertical],
  );

  const handleLeave = useCallback(() => {
    mouseAxis.set(Infinity);
  }, [mouseAxis]);

  const openMenu = useCallback(
    (item: DockItemView, target: HTMLElement) => {
      const r = target.getBoundingClientRect();
      const anchor: MenuAnchor = {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        winW: window.innerWidth,
        winH: window.innerHeight,
      };
      menu.open(item, anchor);
    },
    [menu],
  );

  const launchGuarded = useCallback(
    (item: DockItemView) => {
      if (!draggingRef.current) onLaunch(item);
    },
    [onLaunch],
  );

  const iconProps = {
    mouseAxis,
    iconSize,
    magnify: magnification,
    magScale: magnificationScale,
    vertical,
    onLaunch: launchGuarded,
    onContext: openMenu,
  };

  return (
    <div className="dock-viewport" data-edge={edge}>
      <div
        className="dock-bar glass"
        data-vertical={vertical}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        <Reorder.Group
          as="div"
          className="dock-section"
          axis={vertical ? "y" : "x"}
          values={order}
          onReorder={setOrder}
        >
          {orderedPinned.map((item, i) => (
            <Reorder.Item
              as="div"
              key={item.id}
              value={item.id}
              transition={springs.drag}
              onDragStart={() => {
                draggingRef.current = true;
                mouseAxis.set(Infinity);
              }}
              onDragEnd={() => {
                ipc.reorderPinned(order).catch((e) => console.error("reorder failed", e));
                // let the trailing click event pass before re-enabling launch
                setTimeout(() => {
                  draggingRef.current = false;
                }, 50);
              }}
            >
              <DockIcon item={item} index={i} {...iconProps} />
            </Reorder.Item>
          ))}
        </Reorder.Group>
        {runningItems.length > 0 && <span className="dock-divider" aria-hidden />}
        {runningItems.map((item, i) => (
          <DockIcon key={item.id} item={item} index={orderedPinned.length + i} {...iconProps} />
        ))}
      </div>
      <ContextMenu settings={settings} edge={edge} />
    </div>
  );
}
