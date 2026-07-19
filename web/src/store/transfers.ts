import { create } from "zustand";

export type TransferStatus = "active" | "done" | "error" | "paused";

export interface Transfer {
  id: string;
  name: string;
  kind: "upload" | "download";
  rootId: string;
  path: string;
  loaded: number;
  total: number;
  speed: number;
  status: TransferStatus;
  error?: string;
}

interface TransfersState {
  transfers: Transfer[];
  add: (t: Transfer) => void;
  update: (id: string, patch: Partial<Transfer>) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
  _timers: Record<string, number>;
}

// Completed transfers auto-dismiss after this delay so the panel doesn't linger.
const DONE_AUTO_DISMISS_MS = 30_000;

export const useTransfers = create<TransfersState>((set, get) => ({
  transfers: [],
  add: (t) => set({ transfers: [t, ...get().transfers] }),
  update: (id, patch) => {
    const next = get().transfers.map((t) => (t.id === id ? { ...t, ...patch } : t));
    set({ transfers: next });
    // When a transfer finishes, schedule its automatic dismissal.
    if ((patch.status === "done" || patch.status === "error") && !get()._timers[id]) {
      const timers = get()._timers;
      timers[id] = window.setTimeout(() => {
        const t = get()._timers[id];
        if (t) window.clearTimeout(t);
        delete get()._timers[id];
        set({ transfers: get().transfers.filter((x) => x.id !== id) });
      }, DONE_AUTO_DISMISS_MS);
    }
  },
  remove: (id) => {
    const t = get()._timers[id];
    if (t) { window.clearTimeout(t); delete get()._timers[id]; }
    set({ transfers: get().transfers.filter((x) => x.id !== id) });
  },
  clearFinished: () =>
    set({ transfers: get().transfers.filter((t) => t.status === "active" || t.status === "paused") }),
  _timers: {},
}));

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}
