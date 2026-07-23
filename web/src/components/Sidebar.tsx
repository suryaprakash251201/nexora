import { Trash2, Plus, Share2, Clock, Star, Search, Shield, ListMusic, Home, PanelLeftClose, PanelLeftOpen, LogOut, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { Root } from "../api/types";
import { rootIcon } from "../lib/rootIcons";
import { get } from "../api/client";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

export type SidebarView = "home" | "files" | "trash" | "favorites" | "recents" | "shares" | "playlists" | "search" | "admin" | "video";

const viewColors: Record<string, string> = {
  home: "#5B8CFF",
  search: "#35D3FF",
  files: "#2DD4BF",
  favorites: "#A78BFA",
  recents: "#2DD4BF",
  shares: "#FBBF24",
  playlists: "#F472B6",
  trash: "#FB7185",
  admin: "#34D399",
};

export default function Sidebar({
  roots, activeRoot, view, isAdmin, collapsed, onToggleCollapse, onSelectRoot, onSelectView, onNewRoot, onLogout,
}: {
  roots: Root[];
  activeRoot: string | null;
  view: SidebarView;
  isAdmin: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectRoot: (id: string) => void;
  onSelectView: (v: SidebarView) => void;
  onNewRoot: () => void;
  onLogout: () => void;
}) {
  const version = useQuery({ queryKey: ["version"], queryFn: () => get<{ version: string }>("/version") });
  const usage = useQuery({ queryKey: ["storage-usage"], queryFn: () => get<{ total: number; used: number; available: number }>("/admin/usage"), enabled: isAdmin, });
  const usedPercent = usage.data && usage.data.total > 0 ? Math.round((usage.data.used / usage.data.total) * 100) : 0;

  const NavItem = ({ v, icon, label, isActive }: { v: SidebarView; icon: React.ReactNode; label: string; isActive: boolean }) => {
    const accent = viewColors[v] || "#5B8CFF";
    return (
      <button onClick={() => onSelectView(v)} title={collapsed ? label : undefined}
        className={cn("relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition-all duration-200 min-h-[44px] group", collapsed ? "justify-center px-0" : "")}
      >
        {isActive && (
          <motion.div layoutId="sidebar-active"
            className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full"
            style={{ backgroundColor: accent, boxShadow: `0 0 8px ${accent}80` }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          />
        )}
        <div className={cn("flex items-center gap-3 w-full rounded-lg transition-all duration-200", collapsed ? "justify-center" : "pl-2")}
          style={isActive ? { color: accent } : undefined}
        >
          <span className={cn("shrink-0 transition-transform duration-200", isActive ? "scale-110" : "group-hover:scale-110")}
            style={isActive ? { color: accent } : undefined}>
            {icon}
          </span>
          <AnimatePresence>
            {!collapsed && (
              <motion.span initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }} className="truncate">
                {label}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </button>
    );
  };

  return (
    <>
      {!collapsed && <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-md md:hidden sidebar-overlay" onClick={onToggleCollapse} />}
      <motion.aside
        animate={{ width: collapsed ? 72 : 256 }}
        transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
        className={cn("shrink-0 glass-strong flex flex-col h-full z-50 overflow-hidden border-r border-white/[0.06] relative", "fixed inset-y-0 left-0 md:relative", collapsed ? "items-center" : "")}
      >
        {/* Inner highlight gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] via-transparent to-transparent pointer-events-none" />
        {/* Header */}
        <div className={cn("flex items-center gap-3 mb-4 mt-3", collapsed ? "justify-center px-0" : "px-4 w-full")}>
          <motion.div whileHover={{ scale: 1.05 }}
            className="h-9 w-9 rounded-xl bg-gradient-to-br from-accent via-accent-secondary to-accent-tertiary grid place-items-center text-white font-bold shadow-lg shadow-accent-glow shrink-0">
            N
          </motion.div>
          <AnimatePresence>
            {!collapsed && (
              <motion.div initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: "auto" }} exit={{ opacity: 0, width: 0 }} transition={{ duration: 0.15 }} className="flex items-center gap-1 overflow-hidden">
                <span className="font-bold text-lg tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-accent via-accent-secondary to-accent-tertiary whitespace-nowrap">Nexora</span>
              </motion.div>
            )}
          </AnimatePresence>
          {!collapsed && <button onClick={onToggleCollapse} className="ml-auto p-1.5 rounded-lg hover:bg-glass-bg hidden md:block transition-colors" aria-label="Collapse sidebar"><PanelLeftClose className="h-4 w-4 text-text-tertiary" /></button>}
          {!collapsed && <button onClick={onToggleCollapse} className="ml-auto p-1.5 rounded-lg hover:bg-glass-bg md:hidden transition-colors" aria-label="Close sidebar"><X className="h-4 w-4 text-text-tertiary" /></button>}
        </div>

        {collapsed && <button onClick={onToggleCollapse} title="Expand sidebar" aria-label="Expand sidebar" className="mb-4 p-2.5 rounded-xl hover:bg-glass-bg transition-colors min-h-[44px] min-w-[44px]"><PanelLeftOpen className="h-4 w-4 text-text-tertiary mx-auto" /></button>}

        <nav aria-label="Main navigation" className={cn("flex-1 overflow-y-auto space-y-0.5", collapsed ? "px-2 w-full" : "px-2 w-full")}>
          <NavItem v="home" icon={<Home className="h-5 w-5" />} label="Home" isActive={view === "home"} />
          <NavItem v="search" icon={<Search className="h-5 w-5" />} label="Search" isActive={view === "search"} />

          <div className={cn("mt-6 mb-1", collapsed ? "px-0" : "px-3")}>
            <p className={cn("text-[10px] font-semibold uppercase tracking-widest text-text-tertiary", collapsed ? "text-center" : "")}>{collapsed ? "•" : "Storage"}</p>
          </div>

          {roots.map((r) => {
            const Icon = rootIcon(r.icon);
            const isActive = view === "files" && activeRoot === r.id;
            const accent = viewColors.files;
            return (
              <button key={r.id} onClick={() => onSelectRoot(r.id)} title={collapsed ? r.name : undefined}
                className={cn("relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition-all duration-200 min-h-[44px] group", collapsed ? "justify-center px-0" : "")}>
                {isActive && (
                  <motion.div layoutId="sidebar-active-root"
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full"
                    style={{ backgroundColor: accent, boxShadow: `0 0 8px ${accent}80` }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <div className={cn("flex items-center gap-3 w-full rounded-lg transition-all duration-200", collapsed ? "justify-center" : "pl-2")}
                  style={isActive ? { color: accent } : undefined}>
                  <Icon className="h-5 w-5 shrink-0" />
                  {!collapsed && <motion.span initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }} className="flex-1 truncate">{r.name}</motion.span>}
                  {!collapsed && r.read_only && <span className="text-[10px] uppercase bg-glass-bg border border-glass-border px-1.5 py-0.5 rounded-md text-text-tertiary shrink-0">ro</span>}
                </div>
              </button>
            );
          })}

          {!collapsed && isAdmin && (
            <button onClick={onNewRoot}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium text-text-tertiary hover:text-foreground hover:bg-glass-bg transition-all duration-200 border border-dashed border-glass-border mt-1 min-h-[44px] pl-5">
              <Plus className="h-4 w-4 shrink-0" />
              <span>New storage</span>
            </button>
          )}

          <div className={cn("mt-6 mb-1", collapsed ? "px-0" : "px-3")}>
            <p className={cn("text-[10px] font-semibold uppercase tracking-widest text-text-tertiary", collapsed ? "text-center" : "")}>{collapsed ? "•" : "Workspace"}</p>
          </div>

          <NavItem v="favorites" icon={<Star className="h-5 w-5" />} label="Favorites" isActive={view === "favorites"} />
          <NavItem v="recents" icon={<Clock className="h-5 w-5" />} label="Recent" isActive={view === "recents"} />
          <NavItem v="shares" icon={<Share2 className="h-5 w-5" />} label="Shared" isActive={view === "shares"} />
          <NavItem v="playlists" icon={<ListMusic className="h-5 w-5" />} label="Playlists" isActive={view === "playlists"} />
          <NavItem v="trash" icon={<Trash2 className="h-5 w-5" />} label="Trash" isActive={view === "trash"} />
        </nav>

        {/* Footer Area */}
        <div className={cn("mt-auto flex flex-col gap-2 w-full", collapsed ? "p-2" : "p-2")}>
          {!collapsed && (
            <div className="px-3 py-2.5 rounded-xl glass-subtle border border-white/[0.06] mb-1">
              <div className="flex justify-between text-[11px] mb-1.5 font-medium">
                <span className="text-text-tertiary">Storage</span>
                <span className="text-text-secondary">{usage.isLoading ? "…" : `${usedPercent}%`}</span>
              </div>
              <div className="quota-bar">
                <motion.div className="quota-bar-fill"
                  initial={{ width: "0%" }}
                  animate={{ width: usage.isLoading ? "0%" : `${usedPercent}%` }}
                  transition={{ duration: 0.8, ease: [0.25, 0.1, 0.25, 1] }}
                />
              </div>
            </div>
          )}

          {isAdmin && (
            <button onClick={() => onSelectView("admin")} title={collapsed ? "Admin" : undefined}
              className={cn("relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition-all duration-200 min-h-[44px] group", collapsed ? "justify-center px-0" : "pl-3")}
              style={view === "admin" ? { color: viewColors.admin } : undefined}>
              {view === "admin" && (
                <motion.div layoutId="sidebar-active-admin"
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full"
                  style={{ backgroundColor: viewColors.admin, boxShadow: `0 0 8px ${viewColors.admin}80` }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <Shield className="h-5 w-5 shrink-0" style={view === "admin" ? { color: viewColors.admin } : undefined} />
              {!collapsed && <span>Admin</span>}
            </button>
          )}

          <button onClick={onLogout} title={collapsed ? "Log out" : undefined}
            className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition-all duration-200 min-h-[44px] group", collapsed ? "justify-center px-0" : "pl-3", "text-rose-400/70 hover:bg-rose-500/10 hover:text-rose-400")}>
            <LogOut className="h-5 w-5 shrink-0" />
            {!collapsed && <span>Log out</span>}
          </button>

          {!collapsed && version.data?.version && (
            <div className="text-center mt-1">
              <span className="text-[10px] text-text-tertiary font-mono">v{version.data.version}</span>
            </div>
          )}
        </div>
      </motion.aside>
    </>
  );
}
