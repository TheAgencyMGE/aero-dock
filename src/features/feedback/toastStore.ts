/**
 * Toasts: the dock has no console and no title bar, so a failed action
 * would otherwise vanish silently. Anything the user personally asked
 * for (launch, pin, empty the bin, import settings) reports here when
 * it fails; background chatter stays in the console.
 */

import { create } from "zustand";

export interface Toast {
  id: number;
  message: string;
  tone: "error" | "info";
}

interface ToastState {
  items: Toast[];
  push: (message: string, tone: Toast["tone"]) => void;
  dismiss: (id: number) => void;
}

const LIFETIME_MS = 5200;
const MAX_VISIBLE = 3;
let nextId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  items: [],
  push: (message, tone) => {
    const id = nextId++;
    set((s) => ({ items: [...s.items, { id, message, tone }].slice(-MAX_VISIBLE) }));
    setTimeout(() => get().dismiss(id), LIFETIME_MS);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

/** Turn an unknown thrown value into one readable line. */
function describe(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

export const notify = {
  /** Report a failed user action, and keep the detail in the console. */
  error(what: string, error?: unknown): void {
    if (error !== undefined) console.error(what, error);
    useToasts
      .getState()
      .push(error === undefined ? what : `${what}: ${describe(error)}`, "error");
  },
  info(message: string): void {
    useToasts.getState().push(message, "info");
  },
  /** `.catch(notify.on("Couldn't launch Notepad"))` */
  on(what: string) {
    return (error: unknown) => notify.error(what, error);
  },
};
