/**
 * Aero context menu: a glass sheet that blooms open above the icon and
 * dissolves closed. Window list on top (for running apps), then actions.
 */

import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { springs } from "../../engine/animation/springs";
import { ipc } from "../../ipc/commands";
import type { Settings } from "../../ipc/types";
import type { DockItemView } from "../../state/dockStore";
import { useMenu } from "./menuStore";
import "./contextmenu.css";

const MENU_WIDTH = 240;

interface ContextMenuProps {
  settings: Settings;
  edge: Settings["dock"]["edge"];
}

interface Action {
  label: string;
  danger?: boolean;
  separatorAbove?: boolean;
  run: () => void | Promise<unknown>;
}

function buildActions(item: DockItemView, settings: Settings): Action[] {
  const actions: Action[] = [];

  actions.push({
    label: item.windows.length > 0 ? "New window" : "Open",
    run: () => ipc.launch(item.target, item.args),
  });
  actions.push({
    label: "Run as administrator",
    run: () => ipc.launchAsAdmin(item.target, item.args),
  });
  actions.push({
    label: "Open file location",
    run: () => ipc.openFileLocation(item.target),
  });

  if (item.pinned) {
    actions.push({
      label: "Unpin from Dock",
      separatorAbove: true,
      run: () => ipc.unpinItem(item.id),
    });
  } else {
    actions.push({
      label: "Pin to Dock",
      separatorAbove: true,
      run: () =>
        ipc.pinItem(
          {
            id: `pin-${crypto.randomUUID()}`,
            kind: "app",
            path: item.target,
            name: item.name,
            icon: null,
            children: [],
          },
          settings.pinned.length,
        ),
    });
  }

  if (item.windows.length === 1) {
    actions.push({
      label: "Minimize",
      separatorAbove: true,
      run: () => ipc.minimizeWindow(item.windows[0].hwnd),
    });
    actions.push({
      label: "Close window",
      danger: true,
      run: () => ipc.closeWindow(item.windows[0].hwnd),
    });
  } else if (item.windows.length > 1) {
    actions.push({
      label: `Close all (${item.windows.length})`,
      danger: true,
      separatorAbove: true,
      run: () => Promise.all(item.windows.map((w) => ipc.closeWindow(w.hwnd))),
    });
  }

  return actions;
}

export function ContextMenu({ settings, edge }: ContextMenuProps) {
  const { kind, item: openItem, anchor, close } = useMenu();
  const item = kind === "menu" ? openItem : null;

  // close on any click outside / Escape
  useEffect(() => {
    if (!item) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".aero-menu")) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // clicks outside the OS window never reach us, so also dismiss when
    // the cursor leaves the window and doesn't come back promptly
    let leaveTimer: ReturnType<typeof setTimeout> | undefined;
    const onLeave = () => {
      leaveTimer = setTimeout(close, 450);
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
  }, [item, close]);

  // Anchor offsets are measured from the dock's screen edge, which stays
  // put when the window grows to make room — so these remain valid even
  // though innerWidth/innerHeight change after opening.
  // position/width inline: .glass sets position:relative and stylesheet
  // order under HMR is not guaranteed, so don't fight it in CSS
  let style: React.CSSProperties = { position: "absolute", width: MENU_WIDTH, zIndex: 100 };
  let bloomFrom = { x: 0, y: 10 };
  if (anchor) {
    const clampMain = (v: number, max: number) =>
      Math.min(Math.max(v, 8), max - MENU_WIDTH - 8);
    switch (edge) {
      case "bottom":
        style.left = clampMain(anchor.cx - MENU_WIDTH / 2, anchor.winW);
        style.bottom = anchor.winH - anchor.top + 12;
        bloomFrom = { x: 0, y: 10 };
        break;
      case "top":
        style.left = clampMain(anchor.cx - MENU_WIDTH / 2, anchor.winW);
        style.top = anchor.bottom + 12;
        bloomFrom = { x: 0, y: -10 };
        break;
      case "left":
        style.left = anchor.right + 12;
        style.top = Math.max(anchor.cy - 90, 8);
        bloomFrom = { x: -10, y: 0 };
        break;
      case "right":
        style.right = anchor.winW - anchor.left + 12;
        style.top = Math.max(anchor.cy - 90, 8);
        bloomFrom = { x: 10, y: 0 };
        break;
    }
  }

  return (
    <AnimatePresence>
      {item && anchor && (
        <motion.div
          className="aero-menu glass"
          style={style}
          initial={{ opacity: 0, scale: 0.82, ...bloomFrom }}
          animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, filter: "blur(6px)", transition: { duration: 0.18 } }}
          transition={springs.bloom}
        >
          {item.windows.length > 1 && (
            <div className="aero-menu-windows">
              {item.windows.slice(0, 6).map((w) => (
                <button
                  key={w.hwnd}
                  className="aero-menu-item aero-menu-window"
                  onClick={() => {
                    ipc.activateWindow(w.hwnd);
                    close();
                  }}
                >
                  <span className="aero-menu-window-title">{w.title}</span>
                </button>
              ))}
              <div className="aero-menu-separator" />
            </div>
          )}
          {buildActions(item, settings).map((action) => (
            <div key={action.label}>
              {action.separatorAbove && <div className="aero-menu-separator" />}
              <button
                className="aero-menu-item"
                data-danger={action.danger}
                onClick={() => {
                  Promise.resolve(action.run()).catch((e) =>
                    console.error(`menu action "${action.label}" failed`, e),
                  );
                  close();
                }}
              >
                {action.label}
              </button>
            </div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
