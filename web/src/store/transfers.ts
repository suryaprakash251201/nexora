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
}

export const useTransfers = create<TransfersState>((set, get) => ({
  transfers: [],
  add: (t) => set({ transfers: [t, ...get().transfers] }),
  update: (id, patch) =>
    set({ transfers: get().transfers.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),
  remove: (id) => set({ transfers: get().transfers.filter((t) => t.id !== id) }),
  clearFinished: () =>
    set({ transfers: get().transfers.filter((t) => t.status === "active" || t.status === "paused") }),
}));

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}
