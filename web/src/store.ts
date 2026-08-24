import { create } from "zustand";

export type ViewMode = "list" | "grid";
export type DensityMode = "compact" | "comfortable" | "spacious";

export type ColumnKey = "kind" | "size" | "modified" | "tags";

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
  action?: { label: string; onClick: () => void };
  /** Auto-dismiss delay in ms. Defaults to 4000; use Infinity to pin. */
  duration?: number;
}

interface UIState {
  viewMode: ViewMode;
  density: DensityMode;
  visibleColumns: Record<ColumnKey, boolean>;
  selection: Set<string>;
  selectMode: boolean;
  drawerPath: string | null;
  mobileNavOpen: boolean;
  toasts: Toast[];
  /** Pending clipboard operation (Ctrl+X/C) — paths are root-relative. */
  clipboard: { mode: "copy" | "move"; paths: string[]; rootId: string } | null;
  setClipboard: (c: UIState["clipboard"]) => void;
  setViewMode: (v: ViewMode) => void;
  setDensity: (d: DensityMode) => void;
  toggleColumn: (key: ColumnKey) => void;
  setVisibleColumns: (cols: Record<ColumnKey, boolean>) => void;
  toggleSelect: (path: string) => void;
  clearSelection: () => void;
  setSelection: (paths: string[]) => void;
  selectRange: (paths: string[]) => void;
  setSelectMode: (b: boolean) => void;
  toggleSelectMode: () => void;
  openDrawer: (path: string | null) => void;
  setMobileNav: (open: boolean) => void;
  pushToast: (kind: Toast["kind"], message: string, action?: Toast["action"], duration?: number) => void;
  dismissToast: (id: number) => void;
}

const defaultColumns: Record<ColumnKey, boolean> = {
  kind: true,
  size: true,
  modified: true,
  tags: true,
};

let toastSeq = 1;

/**
 * Safely read the persisted column-visibility prefs. A corrupted value must
 * never crash the app at module load, and missing keys are merged over the
 * defaults so columns can't silently disappear after a version change.
 */
function loadVisibleColumns(): Record<ColumnKey, boolean> {
  try {
    const raw = localStorage.getItem("nexora.columns");
    const parsed = raw ? JSON.parse(raw) : {};
    return { ...defaultColumns, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch {
    return { ...defaultColumns };
  }
}

export const useUI = create<UIState>((set, get) => ({
  viewMode: (localStorage.getItem("nexora.view") as ViewMode) || "list",
  density: (localStorage.getItem("nexora.density") as DensityMode) || "comfortable",
  visibleColumns: loadVisibleColumns(),
  selection: new Set<string>(),
  selectMode: false,
  drawerPath: null,
  mobileNavOpen: false,
  toasts: [],
  clipboard: null,
  setClipboard: (c) => set({ clipboard: c }),
  setViewMode: (v) => {
    localStorage.setItem("nexora.view", v);
    set({ viewMode: v });
  },
  setDensity: (d) => {
    localStorage.setItem("nexora.density", d);
    set({ density: d });
  },
  toggleColumn: (key) => {
    const cols = { ...get().visibleColumns, [key]: !get().visibleColumns[key] };
    localStorage.setItem("nexora.columns", JSON.stringify(cols));
    set({ visibleColumns: cols });
  },
  setVisibleColumns: (cols) => {
    localStorage.setItem("nexora.columns", JSON.stringify(cols));
    set({ visibleColumns: cols });
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
  pushToast: (kind, message, action, duration) => {
    const id = toastSeq++;
    set({ toasts: [...get().toasts, { id, kind, message, action, duration }] });
    // Cap the stack so a burst of errors can't flood the screen.
    const overflow = get().toasts.length - 4;
    if (overflow > 0) {
      for (const t of get().toasts.slice(0, overflow)) get().dismissToast(t.id);
    }
    setTimeout(() => get().dismissToast(id), duration ?? 4000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));