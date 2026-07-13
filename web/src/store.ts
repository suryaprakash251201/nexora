import { create } from "zustand";

export type Theme = "light" | "dark" | "system";
export type ViewMode = "list" | "grid";

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
}

interface UIState {
  theme: Theme;
  viewMode: ViewMode;
  selection: Set<string>;
  drawerPath: string | null; // relative path currently shown in details drawer
  mobileNavOpen: boolean;
  toasts: Toast[];
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setViewMode: (v: ViewMode) => void;
  toggleSelect: (path: string) => void;
  clearSelection: () => void;
  setSelection: (paths: string[]) => void;
  openDrawer: (path: string | null) => void;
  setMobileNav: (open: boolean) => void;
  pushToast: (kind: Toast["kind"], message: string) => void;
  dismissToast: (id: number) => void;
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
}

function loadTheme(): Theme {
  const t = (localStorage.getItem("nexora.theme") as Theme) || "system";
  return t;
}

let toastSeq = 1;

export const useUI = create<UIState>((set, get) => ({
  theme: loadTheme(),
  viewMode: (localStorage.getItem("nexora.view") as ViewMode) || "list",
  selection: new Set<string>(),
  drawerPath: null,
  mobileNavOpen: false,
  toasts: [],
  setTheme: (t) => {
    localStorage.setItem("nexora.theme", t);
    applyTheme(t);
    set({ theme: t });
  },
  toggleTheme: () => {
    const cur = get().theme;
    const next = cur === "dark" ? "light" : "dark";
    get().setTheme(next);
  },
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
  openDrawer: (path) => set({ drawerPath: path }),
  setMobileNav: (open) => set({ mobileNavOpen: open }),
  pushToast: (kind, message) => {
    const id = toastSeq++;
    set({ toasts: [...get().toasts, { id, kind, message }] });
    setTimeout(() => get().dismissToast(id), 4000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

// Apply initial theme.
applyTheme(loadTheme());
