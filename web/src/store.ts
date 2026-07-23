import { create } from "zustand";

export type ViewMode = "list" | "grid";

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
}

interface UIState {
  viewMode: ViewMode;
  selection: Set<string>;
  selectMode: boolean;
  drawerPath: string | null;
  mobileNavOpen: boolean;
  toasts: Toast[];
  setViewMode: (v: ViewMode) => void;
  toggleSelect: (path: string) => void;
  clearSelection: () => void;
  setSelection: (paths: string[]) => void;
  selectRange: (paths: string[]) => void;
  setSelectMode: (b: boolean) => void;
  toggleSelectMode: () => void;
  openDrawer: (path: string | null) => void;
  setMobileNav: (open: boolean) => void;
  pushToast: (kind: Toast["kind"], message: string) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 1;

export const useUI = create<UIState>((set, get) => ({
  viewMode: (localStorage.getItem("nexora.view") as ViewMode) || "list",
  selection: new Set<string>(),
  selectMode: false,
  drawerPath: null,
  mobileNavOpen: false,
  toasts: [],
  setViewMode: (v) => {
    localStorage.setItem("nexora.view", v);
    set({ viewMode: v });
  },
  toggleSelect: (path) => {
    const sel = new Set(get().selection);
    if (sel.has(path)) sel.delete(path);
    else sel.add(path);
    set({ selection: sel });
  },
  clearSelection: () => set({ selection: new Set<string>() }),
  setSelection: (paths) => set({ selection: new Set(paths) }),
  selectRange: (paths) => set({ selection: new Set(paths), selectMode: true }),
  setSelectMode: (b) => set({ selectMode: b, ...(b ? {} : { selection: new Set<string>() }) }),
  toggleSelectMode: () => {
    const b = !get().selectMode;
    set({ selectMode: b, ...(b ? {} : { selection: new Set<string>() }) });
  },
  openDrawer: (path) => set({ drawerPath: path }),
  setMobileNav: (open) => set({ mobileNavOpen: open }),
  pushToast: (kind, message) => {
    const id = toastSeq++;
    set({ toasts: [...get().toasts, { id, kind, message }] });
    setTimeout(() => get().dismissToast(id), 4000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
