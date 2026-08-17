import { Trash2, Plus, Share2, Clock, Star, Search, Shield, ListMusic, Home, PanelLeftClose, PanelLeftOpen, LogOut } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { Root } from "../api/types";
import { memo } from "react";
import { rootIcon } from "../lib/rootIcons";
import { get } from "../api/client";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { formatBytes } from "../lib/format";

export type SidebarView = "home" | "files" | "trash" | "favorites" | "recents" | "shares" | "playlists" | "search" | "admin" | "video" | "image" | "analytics" | "photos";

const viewColors: Record<string, string> = {
  home: "#5B8CFF",
  search: "#35D3FF",
  files: "#2DD4BF",
  favorites: "#A78BFA",
  recents: "#2DD4BF",
  shares: "#FBBF24",
  playlists: "#F472B6",
  trash: "#FB7185",
  admin: "#F87171",
  video: "#818CF8",
  image: "#34D399",
  photos: "#F43F5E"
};

const NavItem = ({ v, icon, label, isActive, badge, collapsed, onSelectView, onHoverView }: { v: SidebarView; icon: React.ReactNode; label: string; isActive: boolean; badge?: number; collapsed: boolean; onSelectView: (v: SidebarView) => void; onHoverView?: (v: SidebarView) => void; }) => {
  const accent = viewColors[v] || "#5B8CFF";
  return (
    <button onClick={() => onSelectView(v)} onMouseEnter={() => onHoverView?.(v)} title={collapsed ? label : undefined}
      className={cn("relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition-all duration-200 min-h-[44px] group overflow-hidden active:scale-[0.98]", 
        collapsed ? "justify-center px-0" : "",
        isActive ? "bg-glass-bg-subtle shadow-sm" : "hover:bg-glass-bg-subtle/50"
      )}
    >
      {isActive && (
        <motion.div layoutId="sidebar-active"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full"
          style={{ backgroundColor: accent, boxShadow: `1px 0 10px ${accent}80` }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        />
      )}
      <div className={cn("flex items-center gap-3 w-full rounded-lg transition-all duration-200", collapsed ? "justify-center" : "pl-2")}
        style={isActive ? { color: accent } : undefined}
      >
        <span className={cn("shrink-0 transition-transform duration-200 relative", isActive ? "scale-110" : "group-hover:scale-110")}
          style={isActive ? { color: accent } : undefined}>
          {icon}
          {collapsed && badge !== undefined && badge > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-accent text-[9px] font-bold text-white grid place-items-center">
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </span>
        <AnimatePresence>
          {!collapsed && (
            <motion.span initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }} className="truncate flex-1">
              {label}
            </motion.span>
          )}
        </AnimatePresence>
        {!collapsed && badge !== undefined && badge > 0 && (
          <span className="ml-auto px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-glass-bg-subtle text-text-tertiary border border-glass-border-soft">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </div>
    </button>
  );
};

export default memo(function Sidebar({
  roots, activeRoot, view, isAdmin, collapsed, onToggleCollapse, onSelectRoot, onSelectView, onNewRoot, onLogout, onHoverView,
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
  onHoverView?: (v: SidebarView) => void;
}) {
  const version = useQuery({ queryKey: ["version"], queryFn: () => get<{ version: string }>("/version") });
  const usage = useQuery({ queryKey: ["storage-usage"], queryFn: () => get<{ total: number; used: number; available: number }>("/admin/usage"), enabled: isAdmin, });
  const usedPercent = usage.data && usage.data.total > 0 ? Math.round((usage.data.used / usage.data.total) * 100) : 0;

  const trashCount = useQuery({ queryKey: ["trash-count"], queryFn: () => get<{ items: unknown[] }>("/trash").then(d => d.items?.length ?? 0), staleTime: 30000 });
  const sharesCount = useQuery({ queryKey: ["shares-count"], queryFn: () => get<{ shares: unknown[] }>("/shares").then(d => d.shares?.length ?? 0), staleTime: 30000 });
  const favsCount = useQuery({ queryKey: ["favs-count"], queryFn: () => get<{ favorites: unknown[] }>("/favorites").then(d => d.favorites?.length ?? 0), staleTime: 30000 });

  const badgeCounts: Partial<Record<SidebarView, number>> = {
    trash: typeof trashCount.data === "number" ? trashCount.data : 0,
    shares: typeof sharesCount.data === "number" ? sharesCount.data : 0,
    favorites: typeof favsCount.data === "number" ? favsCount.data : 0,
  };

  return (
    <>
      <motion.aside
        animate={{ width: collapsed ? 72 : 256 }}
        transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
        className={cn("shrink-0 glass-strong flex-col h-full z-50 overflow-hidden border-r border-glass-border-soft relative hidden md:flex", collapsed ? "items-center" : "")}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] via-transparent to-transparent pointer-events-none" />
        <div className={cn("flex items-center gap-3 mb-4 mt-3", collapsed ? "justify-center px-0" : "px-4 w-full")}>
          <svg viewBox="0 0 36 36" width="64" height="64" xmlns="http://www.w3.org/2000/svg" className="shrink-0 drop-shadow-[0_2px_8px_rgba(139,92,246,0.5)]">
            <defs>
              <linearGradient id="sg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#3B82F6"/>
                <stop offset="25%" stopColor="#6366F1"/>
                <stop offset="50%" stopColor="#8B5CF6"/>
                <stop offset="75%" stopColor="#D946EF"/>
                <stop offset="100%" stopColor="#EC4899"/>
              </linearGradient>
              <linearGradient id="shine" x1="50%" y1="0%" x2="50%" y2="100%">
                <stop offset="0%" stopColor="white" stopOpacity="0.5"/>
                <stop offset="40%" stopColor="white" stopOpacity="0.15"/>
                <stop offset="100%" stopColor="white" stopOpacity="0"/>
              </linearGradient>
            </defs>
            <path d="M18 2 L32 8 L32 20 C32 29 26 34 18 36 C10 34 4 29 4 20 L4 8 Z" fill="url(#sg)"/>
            <path d="M18 2 L32 8 L32 20 C32 29 26 34 18 36 C10 34 4 29 4 20 L4 8 Z" fill="url(#shine)"/>
            <path d="M18 5 L29 10 L29 20 C29 27 24.5 32 18 33.5 C11.5 32 7 27 7 20 L7 10 Z" fill="none" stroke="white" strokeOpacity="0.15" strokeWidth="0.5"/>
            <text x="18" y="26.5" textAnchor="middle" fill="white" fontSize="21" fontWeight="900" fontFamily="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" letterSpacing="-0.05em">N</text>
          </svg>
          <AnimatePresence>
            {!collapsed && (
              <motion.div initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: "auto" }} exit={{ opacity: 0, width: 0 }} transition={{ duration: 0.15 }} className="flex items-center gap-1 overflow-hidden">
                <span className="font-bold text-lg tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-accent via-accent-secondary to-accent-tertiary whitespace-nowrap">Nexora</span>
              </motion.div>
            )}
          </AnimatePresence>
          {!collapsed && <button onClick={onToggleCollapse} className="ml-auto p-1.5 rounded-lg hover:bg-glass-bg transition-colors" aria-label="Collapse sidebar"><PanelLeftClose className="h-4 w-4 text-text-tertiary" /></button>}
        </div>

        {collapsed && <button onClick={onToggleCollapse} title="Expand sidebar" aria-label="Expand sidebar" className="mb-4 p-2.5 rounded-xl hover:bg-glass-bg transition-colors min-h-[44px] min-w-[44px]"><PanelLeftOpen className="h-4 w-4 text-text-tertiary mx-auto" /></button>}

        <nav aria-label="Main navigation" className={cn("flex-1 overflow-y-auto space-y-0.5 hide-scrollbar", collapsed ? "px-2 w-full" : "px-2 w-full")}>
          <NavItem v="home" icon={<Home className="w-[18px] h-[18px]" />} label="Home" isActive={view === "home"} collapsed={collapsed} onSelectView={onSelectView} onHoverView={onHoverView} />
          <NavItem v="search" icon={<Search className="w-[18px] h-[18px]" />} label="Search" isActive={view === "search"} collapsed={collapsed} onSelectView={onSelectView} onHoverView={onHoverView} />
          <NavItem v="analytics" icon={<svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18" /></svg>} label="Analytics" isActive={view === "analytics"} collapsed={collapsed} onSelectView={onSelectView} onHoverView={onHoverView} />
          <NavItem v="photos" icon={<svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeWidth={2}/><circle cx="8.5" cy="8.5" r="1.5" strokeWidth={2}/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 15l-5-5L5 21" /></svg>} label="Photos" isActive={view === "photos"} collapsed={collapsed} onSelectView={onSelectView} onHoverView={onHoverView} />
          <div className="my-1.5 mx-3 h-px bg-glass-border-soft" />
          <NavItem v="recents" icon={<Clock className="w-[18px] h-[18px]" />} label="Recent" isActive={view === "recents"} collapsed={collapsed} onSelectView={onSelectView} onHoverView={onHoverView} />
          <NavItem v="favorites" icon={<Star className="w-[18px] h-[18px]" />} label="Favorites" isActive={view === "favorites"} badge={badgeCounts.favorites} collapsed={collapsed} onSelectView={onSelectView} onHoverView={onHoverView} />
          <NavItem v="shares" icon={<Share2 className="w-[18px] h-[18px]" />} label="Shared" isActive={view === "shares"} badge={badgeCounts.shares} collapsed={collapsed} onSelectView={onSelectView} onHoverView={onHoverView} />
          <NavItem v="playlists" icon={<ListMusic className="w-[18px] h-[18px]" />} label="Playlists" isActive={view === "playlists"} collapsed={collapsed} onSelectView={onSelectView} onHoverView={onHoverView} />
        
          <div className="my-1.5 mx-3 h-px bg-glass-border-soft" />
          <NavItem v="trash" icon={<Trash2 className="w-[18px] h-[18px]" />} label="Trash" isActive={view === "trash"} badge={badgeCounts.trash} collapsed={collapsed} onSelectView={onSelectView} onHoverView={onHoverView} />

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
        </nav>

        <div className={cn("mt-auto flex flex-col gap-2 w-full", collapsed ? "p-2" : "p-2")}>
          {!collapsed && (
            <div className="px-3 py-2.5 rounded-xl glass-subtle border border-glass-border-soft mb-1">
              <div className="flex justify-between text-[11px] mb-1.5 font-medium">
                <span className="text-text-tertiary">Storage</span>
                <span className="text-text-secondary">
                  {usage.isLoading ? "…" : usage.data ? `${formatBytes(usage.data.used)} / ${formatBytes(usage.data.total)}` : `${usedPercent}%`}
                </span>
              </div>
              <div className="quota-bar relative">
                <motion.div className="quota-bar-fill"
                  initial={{ width: "0%" }}
                  animate={{ width: usage.isLoading ? "0%" : `${usedPercent}%` }}
                  transition={{ duration: 0.8, ease: [0.25, 0.1, 0.25, 1] }}
                />
              </div>
              <div className="text-[10px] text-text-tertiary mt-1.5">
                {usedPercent}% used
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
            className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition-all duration-200 min-h-[44px] group", collapsed ? "justify-center px-0" : "pl-3", "text-danger/70 hover:bg-danger/10 hover:text-danger")}>
            <LogOut className="h-5 w-5 shrink-0" />
            {!collapsed && <span>Log out</span>}
          </button>

          {!collapsed && (
            <div className="flex items-center justify-center gap-2 mt-1">
              {version.data?.version && (
                <span className="text-[10px] text-text-tertiary font-mono">v{version.data.version}</span>
              )}
              <a
                href="https://github.com/suryaprakash251201/nexora"
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-tertiary hover:text-foreground transition-colors"
                title="Nexora on GitHub"
                aria-label="View source code on GitHub"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                </svg>
              </a>
            </div>
          )}
        </div>
      </motion.aside>
    </>
  );
});
