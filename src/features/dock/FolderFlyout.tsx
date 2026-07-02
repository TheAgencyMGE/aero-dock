/**
 * Folder flyout: a glass shelf that blooms open above a pinned folder,
 * showing its contents in a grid with staggered icon entrances.
 */

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { springs } from "../../engine/animation/springs";
import { ipc } from "../../ipc/commands";
import type { Settings } from "../../ipc/types";
import { useDockIcons } from "../../state/dockStore";
import { useMenu } from "./menuStore";
import "./folderflyout.css";

const FLYOUT_WIDTH = 340;
const COLUMNS = 4;

interface FolderItem {
  name: string;
  path: string;
  isDir: boolean;
}

interface FolderFlyoutProps {
  edge: Settings["dock"]["edge"];
}

export function FolderFlyout({ edge }: FolderFlyoutProps) {
  const { kind, item, anchor, close } = useMenu();
  const { iconUrls, resolveIcons } = useDockIcons();
  const [entries, setEntries] = useState<FolderItem[] | null>(null);

  const active = kind === "folder" && item !== null && anchor !== null;

  useEffect(() => {
    if (!active || !item) return;
    setEntries(null);
    let cancelled = false;
    ipc
      .listFolder(item.target, 24)
      .then((list) => {
        if (cancelled) return;
        setEntries(list);
        resolveIcons(list.map((e) => e.path));
      })
      .catch((e) => {
        console.error("folder list failed", e);
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
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

  // Same edge-relative positioning contract as ContextMenu.
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
          className="folder-flyout glass"
          style={style}
          initial={{ opacity: 0, scale: 0.8, y: edge === "top" ? -14 : 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, filter: "blur(6px)", transition: { duration: 0.16 } }}
          transition={springs.bloom}
        >
          <div className="folder-flyout-header">
            <span className="folder-flyout-title">{item.name}</span>
            <button
              className="folder-flyout-open"
              onClick={() => {
                ipc.launch(item.target).catch((e) => console.error("open folder failed", e));
                close();
              }}
            >
              Open in Explorer
            </button>
          </div>
          <div className="folder-flyout-grid" style={{ gridTemplateColumns: `repeat(${COLUMNS}, 1fr)` }}>
            {entries === null && <span className="folder-flyout-empty">Loading…</span>}
            {entries?.length === 0 && <span className="folder-flyout-empty">Empty folder</span>}
            {entries?.map((entry, i) => (
              <motion.button
                key={entry.path}
                className="folder-flyout-item"
                initial={{ opacity: 0, y: 10, scale: 0.85 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ ...springs.bloom, delay: Math.min(i * 0.022, 0.35) }}
                onClick={() => {
                  ipc.launch(entry.path).catch((e) => console.error("open item failed", e));
                  close();
                }}
                title={entry.name}
              >
                {iconUrls[entry.path] ? (
                  <img src={iconUrls[entry.path]} alt="" draggable={false} />
                ) : (
                  <span className="folder-flyout-glyph">{entry.isDir ? "📁" : "📄"}</span>
                )}
                <span className="folder-flyout-name">{entry.name}</span>
              </motion.button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
