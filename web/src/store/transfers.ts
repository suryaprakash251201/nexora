import { create } from "zustand";

export type TransferStatus = "queued" | "active" | "done" | "error" | "paused" | "retrying" | "processing";

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
}

// Completed transfers auto-dismiss after this delay so the panel doesn't linger.
const DONE_AUTO_DISMISS_MS = 30_000;

// Timers are pure bookkeeping (never rendered) so they live outside the store
// state — mutating state objects in place bypasses Zustand's change tracking.
const autoDismissTimers = new Map<string, number>();

export const useTransfers = create<TransfersState>((set, get) => ({
  transfers: [],
  add: (t) => set({ transfers: [...get().transfers, t] }),
  update: (id, patch) => {
    const next = get().transfers.map((t) => (t.id === id ? { ...t, ...patch } : t));
    set({ transfers: next });
    // When a transfer finishes, schedule its automatic dismissal.
    if ((patch.status === "done" || patch.status === "error") && !autoDismissTimers.has(id)) {
      autoDismissTimers.set(
        id,
        window.setTimeout(() => {
          const timer = autoDismissTimers.get(id);
          if (timer !== undefined) {
            window.clearTimeout(timer);
            autoDismissTimers.delete(id);
          }
          set({ transfers: get().transfers.filter((x) => x.id !== id) });
        }, DONE_AUTO_DISMISS_MS),
      );
    }
  },
  remove: (id) => {
    const timer = autoDismissTimers.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      autoDismissTimers.delete(id);
    }
    set({ transfers: get().transfers.filter((x) => x.id !== id) });
  },
  clearFinished: () =>
    set({
      transfers: get().transfers.filter(
        // Keep every row that still has a live job behind it — queued/retrying/
        // processing rows belong to jobs waiting in lib/transfer.ts's queue,
        // and dropping them here would orphan those jobs' progress updates.
        (t) => t.status === "active" || t.status === "paused" || t.status === "queued" || t.status === "retrying" || t.status === "processing",
      ),
    }),
}));

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}
