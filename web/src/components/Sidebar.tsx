import { Trash2, Plus, Share2, Clock, Star, Search, Shield, ListMusic, Home, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { Root } from "../api/types";
import { memo } from "react";
import { rootIcon } from "../lib/rootIcons";
import { versionApi, adminApi, trashApi, sharesApi, favoritesApi } from "../api/endpoints";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { formatBytes } from "../lib/format";
import NexoraLogo from "./icons/NexoraLogo";

export type SidebarView = "home" | "files" | "trash" | "favorites" | "recents" | "shares" | "playlists" | "search" | "admin" | "video" | "image" | "analytics" | "photos";

const viewColors: Record<string, string> = {
  home: "#5B8CFF",
  search: "#35D3FF",
  files: "#2DD4BF",
  favorites: "#A78BFA",
  recents: "#38BDF8",
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
      aria-current={isActive ? "page" : undefined}
      className={cn("relative w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl text-left text-[15px] font-medium transition-all duration-200 min-h-[48px] group overflow-hidden active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none",
        collapsed ? "justify-center px-0" : "px-4",
        isActive ? "bg-glass-bg-subtle shadow-sm" : "hover:bg-glass-bg-subtle/50 hover:shadow-inner"
      )}
    >
      {isActive && (
        <motion.div layoutId="sidebar-active"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full"
          style={{ backgroundColor: accent, boxShadow: `1px 0 10px ${accent}80` }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        />
      )}
      <div className={cn("flex items-center gap-3.5 w-full rounded-lg transition-all duration-200", collapsed ? "justify-center" : "pl-1")}
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
        {!collapsed && (
          <span className="truncate flex-1">
            {label}
          </span>
        )}
        {!collapsed && badge !== undefined && badge > 0 && (
          <span className="ml-auto px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-glass-bg-subtle text-text-tertiary border border-glass-border-soft">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </div>
    </button>
  );
};

// Section label shown between nav groups.
const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="px-5 pt-5 pb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-text-tertiary/70 flex items-center gap-2">
    <span className="w-1 h-1 rounded-full bg-text-tertiary/40 shrink-0" />
    {children}
  </div>
);

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
  const version = useQuery({ queryKey: ["version"], queryFn: () => versionApi.get() as any });
  const usage = useQuery({ queryKey: ["storage-usage"], queryFn: () => adminApi.getUsage(), enabled: isAdmin, });
  const usedPercent = usage.data && usage.data.total > 0 ? Math.round((usage.data.used / usage.data.total) * 100) : 0;

  // Share queryKeys with Workspace so React Query dedupes identical /trash, /shares, /favorites requests.
  // Previously these used distinct keys (trash-count, shares-count, favs-count) causing redundant fetches.
  const trashCount = useQuery({ queryKey: ["trash"], queryFn: () => trashApi.list() as any, staleTime: 30000, select: (d) => (d as any).items?.length ?? 0 });
  const sharesCount = useQuery({ queryKey: ["shares"], queryFn: () => sharesApi.list() as any, staleTime: 30000, select: (d) => ((d as any).items as unknown[])?.length ?? 0 });
  const favsCount = useQuery({ queryKey: ["favorites"], queryFn: () => favoritesApi.list() as any, staleTime: 30000, select: (d) => (d as any).items?.length ?? 0 });

  const badgeCounts: Partial<Record<SidebarView, number>> = {
    trash: typeof trashCount.data === "number" ? trashCount.data : 0,
    shares: typeof sharesCount.data === "number" ? sharesCount.data : 0,
    favorites: typeof favsCount.data === "number" ? favsCount.data : 0,
  };

  return (
    <>
      {/* Floating rounded navigation panel. Wrapper keeps the collapse/hide
          width animation smooth; the inner card is the rounded glass surface. */}
      <motion.aside
        animate={{ width: collapsed ? 80 : 304 }}
        transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
        className="relative shrink-0 h-full py-3 pl-3 z-40 overflow-visible"
      >
        <div
          className="h-full w-full flex flex-col rounded-[28px] glass-strong border border-glass-border-soft shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-2xl overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] via-transparent to-transparent pointer-events-none rounded-[28px]" />

          {/* Header */}
          <div className={cn("flex items-center gap-3 pt-5 pb-3 shrink-0", collapsed ? "justify-center px-0" : "px-5 w-full")}>
            <NexoraLogo size={44} idPrefix="sb" className="shrink-0 drop-shadow-[0_2px_8px_rgba(139,92,246,0.5)]" />
            <AnimatePresence>
              {!collapsed && (
                <motion.div initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: "auto" }} exit={{ opacity: 0, width: 0 }} transition={{ duration: 0.15 }} className="flex items-center gap-1 overflow-hidden">
                  <span className="font-bold text-lg tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-accent via-accent-secondary to-accent-tertiary whitespace-nowrap">Nexora</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Modern collapse toggle button */}
            {!collapsed && (
              <button
                onClick={onToggleCollapse}
                className="ml-auto group/btn relative p-2 rounded-xl transition-all duration-300 hover:bg-glass-bg active:scale-95"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose className="h-4 w-4 text-text-tertiary group-hover/btn:text-foreground transition-colors duration-300" />
                <span className="absolute inset-0 rounded-xl border border-transparent group-hover/btn:border-white/[0.08] transition-colors duration-300" />
              </button>
            )}
          </div>

          {/* Collapsed state expand button */}
          {collapsed && (
            <div className="flex flex-col items-center py-2 shrink-0">
              <button
                onClick={onToggleCollapse}
                className="group/btn relative p-2.5 rounded-xl transition-all duration-300 hover:bg-glass-bg active:scale-95 min-h-[44px] min-w-[44px]"
                title="Expand sidebar"
                aria-label="Expand sidebar"
              >
                <PanelLeftOpen className="h-4 w-4 text-text-tertiary group-hover/btn:text-foreground transition-colors duration-300 mx-auto" />
                <span className="absolute inset-0 rounded-xl border border-transparent group-hover/btn:border-white/[0.08] transition-colors duration-300" />
              </button>
            </div>
          )}

          {/* Scrollable navigation — hidden scrollbar for clean look */}
          <nav aria-label="Main navigation" className={cn("flex-1 overflow-y-auto pb-2 sidebar-scroll", collapsed ? "px-2 w-full" : "px-2 w-full")}>
            {!collapsed && <SectionLabel>Main</SectionLabel>}
            <NavItem v="home" icon={<Home className="w-5 h-5" />} label="Home" isActive={view === "home"} collapsed={collapsed} onSelectView={onSelectView} onHoverView={onHoverView} />
            <NavItem v="search" icon={<Search className="w-5 h-5" />} label="Search" isActive={view === "search"} collapsed={collapsed} onSelectView={onSelectView} onHoverView={onHoverView} />
            <NavItem v="analytics" icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18" /></svg>} label="Analytics" isActive={view === "analytics"} collapsed={collapsed} onSelectView={onSelectView} onHoverView={onHoverView} />
            <NavItem v="photos" icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeWidth={2}/><circle cx="8.5" cy="8.5" r="1.5" strokeWidth={2}/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 15l-5-5L5 21" /></svg>} label="Photos" isActive={view === "photos"} collapsed={collapsed} onSelectView={onSelectView} onHoverView={onHoverView} />

            {!collapsed && <SectionLabel>Library</SectionLabel>}
            <NavItem v="recents" icon={<Clock className="w-5 h-5" />} label="Recent" isActive={view === "recents"} collapsed={collapsed} onSelectView={onSelectView} onHoverView={onHoverView} />
            <NavItem v="favorites" icon={<Star className="w-5 h-5" />} label="Favorites" isActive={view === "favorites"} badge={badgeCounts.favorites} collapsed={collapsed} onSelectView={onSelectView} onHoverView={onHoverView} />
            <NavItem v="shares" icon={<Share2 className="w-5 h-5" />} label="Shared" isActive={view === "shares"} badge={badgeCounts.shares} collapsed={collapsed} onSelectView={onSelectView} onHoverView={onHoverView} />
            <NavItem v="playlists" icon={<ListMusic className="w-5 h-5" />} label="Playlists" isActive={view === "playlists"} collapsed={collapsed} onSelectView={onSelectView} onHoverView={onHoverView} />

            {!collapsed && <SectionLabel>Storage</SectionLabel>}
            <NavItem v="trash" icon={<Trash2 className="w-5 h-5" />} label="Trash" isActive={view === "trash"} badge={badgeCounts.trash} collapsed={collapsed} onSelectView={onSelectView} onHoverView={onHoverView} />

            {roots.map((r) => {
              const Icon = rootIcon(r.icon);
              const isActive = view === "files" && activeRoot === r.id;
              const accent = viewColors.files;
              return (
                <button key={r.id} onClick={() => onSelectRoot(r.id)} title={collapsed ? r.name : undefined}
                  aria-current={isActive ? "page" : undefined}
                  className={cn("relative w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl text-left text-[15px] font-medium transition-all duration-200 min-h-[48px] group focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none", collapsed ? "justify-center px-0" : "px-4", isActive ? "bg-glass-bg-subtle shadow-sm" : "hover:bg-glass-bg-subtle/50")}>
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
                className="w-full flex items-center gap-3.5 px-4 py-2.5 rounded-xl text-left text-[15px] font-medium text-text-tertiary hover:text-foreground hover:bg-glass-bg transition-all duration-200 border border-dashed border-glass-border mt-1 min-h-[48px] pl-5">
                <Plus className="h-4 w-4 shrink-0" />
                <span>New storage</span>
              </button>
            )}
          </nav>

          {/* Footer */}
          <div className={cn("mt-auto flex flex-col gap-2 w-full shrink-0 border-t border-glass-border-soft/60", collapsed ? "p-2.5" : "p-3")}>
            {!collapsed && (
              <div className="px-3.5 py-3 rounded-xl glass-subtle border border-glass-border-soft mb-0.5">
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
                aria-current={view === "admin" ? "page" : undefined}
                className={cn("relative w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl text-left text-[15px] font-medium transition-all duration-200 min-h-[48px] group focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none", collapsed ? "justify-center px-0" : "px-4")}
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
              className={cn("w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl text-left text-[15px] font-medium transition-all duration-200 min-h-[48px] group", collapsed ? "justify-center px-0" : "px-4", "text-danger/70 hover:bg-danger/10 hover:text-danger")}>
              <LogOut className="h-5 w-5 shrink-0" />
              {!collapsed && <span>Log out</span>}
            </button>

            {!collapsed && (
              <div className="flex items-center justify-center gap-2 mt-0.5">
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
        </div>
      </motion.aside>
    </>
  );
});
