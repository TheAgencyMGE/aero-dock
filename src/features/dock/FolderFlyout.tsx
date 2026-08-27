/**
 * Folder flyout: a glass shelf that blooms open above a pinned folder,
 * showing its contents in a grid with staggered icon entrances.
 */

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { springs } from "../../engine/animation/springs";
import { ipc } from "../../ipc/commands";
import { notify } from "../feedback/toastStore";
import type { Settings } from "../../ipc/types";
import { useDockIcons } from "../../state/dockStore";
import { bloomOffset, flyoutStyle, useMenu } from "./menuStore";
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
  const [failed, setFailed] = useState(false);

  const active = kind === "folder" && item !== null && anchor !== null;

  useEffect(() => {
    if (!active || !item) return;
    setEntries(null);
    setFailed(false);
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
        if (cancelled) return;
        setEntries([]);
        setFailed(true);
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
            <button
              className="folder-flyout-open"
              onClick={() => {
                ipc.launch(item.target).catch(notify.on(`Could not open ${item.name}`));
                close();
              }}
            >
              Open in Explorer
            </button>
          </div>
          <div className="folder-flyout-grid" style={{ gridTemplateColumns: `repeat(${COLUMNS}, 1fr)` }}>
            {entries === null && (
              <span className="folder-flyout-empty">
                <span className="flyout-spinner" aria-hidden />
                Reading folder…
              </span>
            )}
            {entries?.length === 0 && (
              <span className="folder-flyout-empty" data-tone={failed ? "error" : undefined}>
                {failed ? "This folder could not be read" : "Nothing in this folder"}
              </span>
            )}
            {entries?.map((entry, i) => (
              <motion.button
                key={entry.path}
                className="folder-flyout-item"
                initial={{ opacity: 0, y: 10, scale: 0.85 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ ...springs.bloom, delay: Math.min(i * 0.022, 0.35) }}
                onClick={() => {
                  ipc.launch(entry.path).catch(notify.on(`Could not open ${entry.name}`));
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
