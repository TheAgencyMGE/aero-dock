/**
 * The toast stack: small glass pills that rise beside the dock when an
 * action fails, then dissolve. Click one to dismiss it early.
 */

import { AnimatePresence, motion } from "motion/react";
import { springs } from "../../engine/animation/springs";
import type { DockEdge } from "../../ipc/types";
import { bloomOffset, edgePanelStyle } from "../dock/menuStore";
import { useToasts } from "./toastStore";
import "./toasts.css";

export function Toasts({ edge }: { edge: DockEdge }) {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);

  return (
    <div
      className="toast-stack"
      style={{
        ...edgePanelStyle(edge, "calc(var(--icon-size) * 1.2 + 42px)"),
        zIndex: 120,
      }}
      role="status"
      aria-live="polite"
    >
      <AnimatePresence>
        {items.map((toast) => (
          <motion.button
            key={toast.id}
            className="toast glass"
            data-tone={toast.tone}
            initial={{ opacity: 0, scale: 0.86, ...bloomOffset(edge) }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, filter: "blur(5px)", transition: { duration: 0.2 } }}
            transition={springs.bloom}
            onClick={() => dismiss(toast.id)}
            title="Dismiss"
          >
            {toast.message}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
