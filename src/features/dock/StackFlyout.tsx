/**
 * Stack flyout: a pinned group blooms open into a grid of its members.
 */

import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { springs } from "../../engine/animation/springs";
import { ipc } from "../../ipc/commands";
import { notify } from "../feedback/toastStore";
import type { Settings } from "../../ipc/types";
import { useDockIcons } from "../../state/dockStore";
import { bloomOffset, flyoutStyle, useMenu } from "./menuStore";
import "./folderflyout.css";

const FLYOUT_WIDTH = 300;
const COLUMNS = 3;

interface StackFlyoutProps {
  edge: Settings["dock"]["edge"];
}

export function StackFlyout({ edge }: StackFlyoutProps) {
  const { kind, item, anchor, close } = useMenu();
  const { iconUrls, resolveIcons } = useDockIcons();

  const active = kind === "stack" && item !== null && anchor !== null;

  useEffect(() => {
    if (!active || !item) return;
    resolveIcons(item.children.map((c) => c.path).filter(Boolean));
  }, [active, item, resolveIcons]);

  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".folder-flyout")) close();
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

  const style = anchor ? flyoutStyle(edge, anchor, FLYOUT_WIDTH, 14, 320) : {};
  const from = bloomOffset(edge);

  return (
    <AnimatePresence>
      {active && item && (
        <motion.div
          className="folder-flyout glass"
          style={style}
          initial={{ opacity: 0, scale: 0.8, ...from }}
          animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, filter: "blur(6px)", transition: { duration: 0.16 } }}
          transition={springs.bloom}
        >
          <div className="folder-flyout-header">
            <span className="folder-flyout-title">{item.name}</span>
          </div>
          <div
            className="folder-flyout-grid"
            style={{ gridTemplateColumns: `repeat(${COLUMNS}, 1fr)` }}
          >
            {item.children.map((child, i) => (
              <motion.button
                key={child.id}
                className="folder-flyout-item"
                initial={{ opacity: 0, y: 10, scale: 0.85 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ ...springs.bloom, delay: Math.min(i * 0.025, 0.3) }}
                onClick={() => {
                  ipc.launch(child.path).catch(notify.on(`Could not open ${child.name}`));
                  close();
                }}
                title={child.name}
              >
                {iconUrls[child.path] ? (
                  <img src={iconUrls[child.path]} alt="" draggable={false} />
                ) : (
                  <span className="folder-flyout-glyph">▶</span>
                )}
                <span className="folder-flyout-name">{child.name}</span>
              </motion.button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
