/**
 * The dock bar: a glass shelf of icons. Owns the cursor motion value the
 * icons magnify against, drag-reordering of the pinned section, and the
 * deterministic window-size report to Rust (window = dock + magnification
 * headroom + tooltip space + flyout space when a menu is open).
 */

import { AnimatePresence, motion, Reorder, useMotionValue } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { springs } from "../../engine/animation/springs";
import { ipc } from "../../ipc/commands";
import type { Settings } from "../../ipc/types";
import type { DockItemView } from "../../state/dockStore";
import { useAmbient } from "../../state/ambientStore";
import { Welcome } from "../onboarding/Welcome";
import { SearchOverlay, useSearch } from "../search/SearchOverlay";
import { WidgetCluster } from "../widgets/WidgetCluster";
import { ContextMenu } from "./ContextMenu";
import { DockIcon } from "./DockIcon";
import { FolderFlyout } from "./FolderFlyout";
import { StackFlyout } from "./StackFlyout";
import { WindowsFlyout } from "./WindowsFlyout";
import { anchorFor, useMenu } from "./menuStore";
import "./dock.css";

const GAP = 6;
const PAD_MAIN = 18; // dock padding along the axis
const PAD_CROSS = 10; // dock padding across the axis
const LABEL_SPACE = 44; // tooltip pill above icons
const EDGE_SLACK = 24; // window slack so magnified end-icons never clip
const MENU_SPACE = 360; // extra cross-axis room while a context menu is open
const WIDGET_SPACE = 190; // clock + status glyphs + search & gear buttons
const REVEAL_STRIP = 8; // window height while auto-hidden (mouse sensor)
const HIDE_DELAY_MS = 1400;
const HIDE_ANIM_MS = 380;
// ambient animations (float, sweep) pause after this much no-interaction
// so an idle dock costs ~zero GPU; they wake the moment the cursor returns
const SLEEP_AFTER_MS = 45_000;

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
  const searchOpen = useSearch((s) => s.open);
  const setSearchOpen = useSearch((s) => s.setOpen);
  const welcomeOpen = !settings.onboardingComplete && pinnedItems.length === 0;
  const menuOpen = menu.item !== null || searchOpen || welcomeOpen;

  // ---- auto-hide state machine ----
  // hidden=false + hover/menu keeps it visible; idle slides it out,
  // then the window shrinks to a reveal strip; any mouse contact with
  // the strip brings it back.
  const [hidden, setHidden] = useState(false);
  const [windowShrunk, setWindowShrunk] = useState(false);
  const [pointerInside, setPointerInside] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shrinkTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ambient-motion sleep: cheap idle, alive on approach
  const asleep = useAmbient((s) => s.asleep);
  const setAsleep = useAmbient((s) => s.setAsleep);
  const sleepTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(sleepTimer.current);
    if (pointerInside || menuOpen) {
      setAsleep(false);
      return;
    }
    sleepTimer.current = setTimeout(() => setAsleep(true), SLEEP_AFTER_MS);
    return () => clearTimeout(sleepTimer.current);
  }, [pointerInside, menuOpen, setAsleep]);

  const autoHide = settings.dock.autoHide;
  useEffect(() => {
    clearTimeout(hideTimer.current);
    clearTimeout(shrinkTimer.current);
    if (!autoHide) {
      setHidden(false);
      setWindowShrunk(false);
      return;
    }
    if (pointerInside || menuOpen) {
      setHidden(false);
      setWindowShrunk(false);
      return;
    }
    hideTimer.current = setTimeout(() => {
      setHidden(true);
      // shrink the OS window only after the slide-out finishes
      shrinkTimer.current = setTimeout(() => setWindowShrunk(true), HIDE_ANIM_MS);
    }, HIDE_DELAY_MS);
    return () => {
      clearTimeout(hideTimer.current);
      clearTimeout(shrinkTimer.current);
    };
  }, [autoHide, pointerInside, menuOpen]);

  // Deterministic window size: no ResizeObserver, no feedback loops.
  const windowSize = useMemo(() => {
    const n = Math.max(items.length, 1);
    const dividers = runningItems.length > 0 ? 1 : 0;
    const mainBase = n * iconSize + (n - 1 + dividers) * GAP + dividers * 8 + PAD_MAIN * 2;
    // neighbors near the cursor grow too; ~2.5 icons' worth covers the worst case
    const mainGrowth = iconSize * (peak - 1) * 2.5;
    const main = mainBase + mainGrowth + EDGE_SLACK + WIDGET_SPACE;
    const crossFull = iconSize * peak + PAD_CROSS * 2 + LABEL_SPACE + (menuOpen ? MENU_SPACE : 0);
    const cross = windowShrunk ? REVEAL_STRIP : crossFull;
    return vertical ? { width: cross, height: main } : { width: main, height: cross };
  }, [items.length, runningItems.length, iconSize, peak, vertical, menuOpen, windowShrunk]);

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
      menu.open("menu", item, anchorFor(target));
    },
    [menu],
  );

  const launchGuarded = useCallback(
    (item: DockItemView, target?: HTMLElement) => {
      if (draggingRef.current) return;
      if (item.kind === "folder" && target) {
        menu.open("folder", item, anchorFor(target));
        return;
      }
      if (item.kind === "stack" && target) {
        menu.open("stack", item, anchorFor(target));
        return;
      }
      // several windows: show them instead of blind-cycling
      if (item.windows.length > 1 && target) {
        menu.open("windows", item, anchorFor(target));
        return;
      }
      onLaunch(item);
    },
    [onLaunch, menu],
  );

  const openPreview = useCallback(
    (item: DockItemView, target: HTMLElement) => {
      if (!draggingRef.current) menu.open("windows", item, anchorFor(target));
    },
    [menu],
  );

  const iconProps = {
    mouseAxis,
    iconSize,
    magnify: magnification,
    magScale: magnificationScale,
    vertical,
    onLaunch: launchGuarded,
    onContext: openMenu,
    onHoverPreview: openPreview,
  };

  const slideOut = vertical
    ? { x: edge === "left" ? "-118%" : "118%", y: 0 }
    : { y: edge === "top" ? "-118%" : "118%", x: 0 };

  return (
    <div
      className="dock-viewport"
      data-edge={edge}
      data-asleep={asleep}
      onMouseEnter={() => setPointerInside(true)}
      onMouseLeave={() => setPointerInside(false)}
    >
      <motion.div
        className="dock-bar glass"
        data-vertical={vertical}
        animate={hidden ? { ...slideOut, opacity: 0.6 } : { x: 0, y: 0, opacity: 1 }}
        transition={springs.slide}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        <button
          className="dock-search-btn"
          title="Search apps and files"
          onClick={() => setSearchOpen(!searchOpen)}
        >
          <svg viewBox="0 0 24 24" fill="none">
            <circle cx="10.5" cy="10.5" r="6" stroke="#1c5f8f" strokeWidth="2.4" />
            <line x1="15" y1="15" x2="20.5" y2="20.5" stroke="#1c5f8f" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
        </button>
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
        <span className="dock-divider" aria-hidden />
        <WidgetCluster />
        <button
          className="dock-search-btn"
          title="Aero Dock settings"
          onClick={() => ipc.openSettings().catch((e) => console.error("open settings", e))}
        >
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M12 8.6 a3.4 3.4 0 1 0 0 6.8 a3.4 3.4 0 0 0 0-6.8 z M12 3.5 l1 2.4 a6.6 6.6 0 0 1 2.4 1 l2.5-.8 1.4 2.4 -1.7 1.9 a6.6 6.6 0 0 1 0 2.7 l1.7 1.9 -1.4 2.4 -2.5-.8 a6.6 6.6 0 0 1 -2.4 1 l-1 2.4 h-2.8 l-.9-2.4 a6.6 6.6 0 0 1 -2.4-1 l-2.5.8 -1.4-2.4 1.7-1.9 a6.6 6.6 0 0 1 0-2.7 L2.3 8.5 3.7 6.1 l2.5.8 a6.6 6.6 0 0 1 2.4-1 l.9-2.4 z"
              stroke="#1c5f8f"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </motion.div>
      <ContextMenu settings={settings} edge={edge} />
      <FolderFlyout edge={edge} />
      <StackFlyout edge={edge} />
      <WindowsFlyout edge={edge} />
      <SearchOverlay />
      <AnimatePresence>{welcomeOpen && <Welcome />}</AnimatePresence>
    </div>
  );
}
