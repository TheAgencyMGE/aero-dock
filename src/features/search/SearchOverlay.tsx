/**
 * Search overlay: a glass spotlight above the dock. Searches installed
 * apps and recent files; keyboard-first (type, ↑↓, Enter, Esc).
 *
 * The dock window is normally focus-immune (WS_EX_NOACTIVATE); opening
 * the overlay temporarily lifts that so the input can take keystrokes.
 */

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { springs } from "../../engine/animation/springs";
import { ipc } from "../../ipc/commands";
import type { AppEntry, DockEdge, RecentFile } from "../../ipc/types";
import { bloomOffset, edgePanelStyle } from "../dock/menuStore";
import { useDockIcons } from "../../state/dockStore";
import { notify } from "../feedback/toastStore";
import "./search.css";

interface SearchState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useSearch = create<SearchState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

interface ResultRow {
  kind: "app" | "recent";
  name: string;
  detail: string;
  path: string;
  args?: string;
}

const MAX_RESULTS = 9;

function filterResults(query: string, apps: AppEntry[], recent: RecentFile[]): ResultRow[] {
  const q = query.trim().toLowerCase();
  const rows: ResultRow[] = [];
  if (q) {
    for (const a of apps) {
      if (a.name.toLowerCase().includes(q)) {
        rows.push({ kind: "app", name: a.name, detail: "Application", path: a.targetPath, args: a.args });
        if (rows.length >= MAX_RESULTS) return rows;
      }
    }
    for (const r of recent) {
      if (r.name.toLowerCase().includes(q)) {
        rows.push({ kind: "recent", name: r.name, detail: r.path, path: r.path });
        if (rows.length >= MAX_RESULTS) return rows;
      }
    }
  } else {
    // empty query: show recent files as the default surface
    for (const r of recent.slice(0, MAX_RESULTS)) {
      rows.push({ kind: "recent", name: r.name, detail: r.path, path: r.path });
    }
  }
  return rows;
}

export function SearchOverlay({ edge }: { edge: DockEdge }) {
  const { open, setOpen } = useSearch();
  const { iconUrls, resolveIcons } = useDockIcons();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [recent, setRecent] = useState<RecentFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // load sources + take keyboard focus while open
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    ipc.setDockFocusable(true).catch(() => undefined);
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    setLoading(true);
    setFailed(false);
    Promise.allSettled([ipc.listApps(), ipc.listRecentFiles(20)])
      .then(([appsResult, recentResult]) => {
        if (appsResult.status === "fulfilled") setApps(appsResult.value);
        else console.error("app list failed", appsResult.reason);
        if (recentResult.status === "fulfilled") setRecent(recentResult.value);
        else console.error("recent files failed", recentResult.reason);
        setFailed(appsResult.status === "rejected");
        setLoading(false);
      });
    return () => {
      clearTimeout(t);
      ipc.setDockFocusable(false).catch(() => undefined);
    };
  }, [open]);

  const results = useMemo(() => filterResults(query, apps, recent), [query, apps, recent]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  // resolve icons for visible rows
  useEffect(() => {
    if (!open || results.length === 0) return;
    resolveIcons(results.map((r) => r.path)).catch(() => undefined);
  }, [open, results, resolveIcons]);

  const launch = useCallback(
    (row: ResultRow) => {
      ipc.launch(row.path, row.args).catch(notify.on(`Could not open ${row.name}`));
      setOpen(false);
    },
    [setOpen],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && results[selected]) {
      launch(results[selected]);
    }
  };

  // dismiss when clicking outside / cursor leaves the window
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".search-overlay")) setOpen(false);
    };
    let leaveTimer: ReturnType<typeof setTimeout> | undefined;
    const onLeave = () => {
      leaveTimer = setTimeout(() => setOpen(false), 600);
    };
    const onEnter = () => clearTimeout(leaveTimer);
    window.addEventListener("mousedown", onDown);
    document.documentElement.addEventListener("mouseleave", onLeave);
    document.documentElement.addEventListener("mouseenter", onEnter);
    return () => {
      clearTimeout(leaveTimer);
      window.removeEventListener("mousedown", onDown);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      document.documentElement.removeEventListener("mouseenter", onEnter);
    };
  }, [open, setOpen]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="search-overlay glass"
          style={{
            ...edgePanelStyle(edge, "calc(var(--icon-size) * 1.2 + 44px)"),
            width: 440,
            zIndex: 110,
          }}
          initial={{ opacity: 0, scale: 0.86, ...bloomOffset(edge) }}
          animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
          exit={{
            opacity: 0,
            scale: 0.93,
            filter: "blur(6px)",
            transition: { duration: 0.16 },
          }}
          transition={springs.bloom}
        >
          <input
            ref={inputRef}
            className="search-input"
            placeholder="Search apps and recent files…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
          />
          <div className="search-results">
            {results.length === 0 && (
              <div className="search-empty" data-tone={failed ? "error" : undefined}>
                {loading ? (
                  <>
                    <span className="flyout-spinner" aria-hidden /> Looking through your apps…
                  </>
                ) : failed ? (
                  "Could not read your installed apps"
                ) : query ? (
                  `No matches for "${query}"`
                ) : (
                  "Start typing to find an app"
                )}
              </div>
            )}
            {results.map((row, i) => (
              <button
                key={`${row.kind}-${row.path}`}
                className="search-row"
                data-selected={i === selected}
                onMouseEnter={() => setSelected(i)}
                onClick={() => launch(row)}
              >
                {iconUrls[row.path] ? (
                  <img src={iconUrls[row.path]} alt="" draggable={false} />
                ) : (
                  <span className="search-row-glyph">{row.kind === "app" ? "▶" : "📄"}</span>
                )}
                <span className="search-row-text">
                  <span className="search-row-name">{row.name}</span>
                  <span className="search-row-detail">{row.detail}</span>
                </span>
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
