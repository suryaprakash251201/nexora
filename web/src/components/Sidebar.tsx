import { Trash2, Plus, Share2, Clock, Star, Search, Shield, ListMusic, Home, PanelLeftClose, PanelLeftOpen, LogOut, X } from "lucide-react";
import type { Root } from "../api/types";
import { useUI } from "../store";
import { usePlaylists } from "../store/playlists";
import { rootIcon } from "../lib/rootIcons";
import { get } from "../api/client";
import { useQuery } from "@tanstack/react-query";

export type SidebarView = "home" | "files" | "trash" | "favorites" | "recents" | "shares" | "playlists" | "search" | "admin";

export default function Sidebar({
  roots,
  activeRoot,
  view,
  isAdmin,
  collapsed,
  onToggleCollapse,
  onSelectRoot,
  onSelectView,
  onNewRoot,
  onLogout,
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
  const playlists = usePlaylists((s) => s.playlists);

  const version = useQuery({
    queryKey: ["version"],
    queryFn: () => get<{ version: string }>("/version"),
  });

  const navBtn = (v: SidebarView, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => onSelectView(v)}
      title={collapsed ? label : undefined}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition-colors ${
        view === v ? "bg-accent/15 text-accent" : "glass-hover text-content hover:text-accent"
      } ${collapsed ? "justify-center" : ""}`}
    >
      {icon} {!collapsed && label}
    </button>
  );

  return (
    <>
      {/* Mobile overlay */}
      {!collapsed && (
        <div 
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden sidebar-overlay"
          onClick={onToggleCollapse}
        />
      )}

      <aside className={`shrink-0 border-r border-glass-border-soft glass-strong flex flex-col h-full transition-all duration-300 z-50
        ${collapsed ? "w-[72px] items-center py-4 hidden md:flex" : "w-64 fixed inset-y-0 left-0 md:relative"}`}>
        
        {/* Header */}
        <div className={`flex items-center gap-3 mb-6 ${collapsed ? "px-0" : "px-5 w-full"}`}>
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-accent to-purple-500 grid place-items-center text-white font-bold shadow-lg shadow-accent/20 shrink-0">N</div>
          {!collapsed && (
            <>
              <span className="font-bold text-xl tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-accent to-purple-500">Nexora</span>
              <button onClick={onToggleCollapse} className="ml-auto p-1.5 rounded-lg glass-hover md:hidden">
                <X className="h-4 w-4" />
              </button>
              <button onClick={onToggleCollapse} className="ml-auto p-1.5 rounded-lg glass-hover hidden md:block">
                <PanelLeftClose className="h-4 w-4 text-content-muted" />
              </button>
            </>
          )}
        </div>

        {/* Expand button when collapsed */}
        {collapsed && (
          <button onClick={onToggleCollapse} title="Expand sidebar" className="mb-4 p-2.5 rounded-xl glass-hover">
            <PanelLeftOpen className="h-4 w-4 text-content-muted" />
          </button>
        )}

        {/* Navigation */}
        <nav className={`flex-1 overflow-y-auto space-y-1.5 custom-scrollbar ${collapsed ? "px-2 w-full" : "px-3 w-full"}`}>
          {navBtn("home", <Home className="h-5 w-5 shrink-0" />, "Home")}
          {navBtn("search", <Search className="h-5 w-5 shrink-0" />, "Search")}

          <div className={`mt-6 mb-2 ${collapsed ? "px-0 text-center hidden" : "px-3"}`}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-content-muted/70">Storage</p>
          </div>
          
          {roots.map((r) => {
            const Icon = rootIcon(r.icon);
            return (
              <button
                key={r.id}
                onClick={() => onSelectRoot(r.id)}
                title={collapsed ? r.name : undefined}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition-colors ${
                  view === "files" && activeRoot === r.id ? "bg-accent/15 text-accent" : "glass-hover text-content hover:text-accent"
                } ${collapsed ? "justify-center" : ""}`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {!collapsed && (
                  <>
                    <span className="flex-1 truncate">{r.name}</span>
                    {r.read_only && <span className="text-[10px] uppercase bg-surface border px-1.5 py-0.5 rounded-md text-content-muted">ro</span>}
                  </>
                )}
              </button>
            );
          })}
          
          {!collapsed && isAdmin && (
            <button onClick={onNewRoot} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium text-content-muted glass-hover hover:text-accent border border-dashed border-border/50 mt-2">
              <Plus className="h-5 w-5 shrink-0" /> New storage
            </button>
          )}

          <div className={`mt-6 mb-2 ${collapsed ? "px-0 text-center hidden" : "px-3"}`}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-content-muted/70">Workspace</p>
          </div>
          
          {navBtn("favorites", <Star className="h-5 w-5 shrink-0" />, "Favorites")}
          {navBtn("recents", <Clock className="h-5 w-5 shrink-0" />, "Recent")}
          {navBtn("shares", <Share2 className="h-5 w-5 shrink-0" />, "Shared")}
          {navBtn("playlists", <ListMusic className="h-5 w-5 shrink-0" />, "Playlists")}
          {navBtn("trash", <Trash2 className="h-5 w-5 shrink-0" />, "Trash")}
        </nav>

        {/* Footer Area */}
        <div className={`mt-auto flex flex-col gap-2 w-full ${collapsed ? "p-2" : "p-3"}`}>
          {!collapsed && (
            <div className="px-3 py-3 rounded-xl bg-surface/50 border border-border/50 mb-2">
              <div className="flex justify-between text-xs mb-1.5 font-medium">
                <span>Storage usage</span>
                <span className="text-content-muted">75%</span>
              </div>
              <div className="quota-bar">
                <div className="quota-bar-fill" style={{ width: '75%' }} />
              </div>
            </div>
          )}

          {isAdmin && (
            <button
              onClick={() => onSelectView("admin")}
              title={collapsed ? "Admin" : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition-colors ${view === "admin" ? "bg-accent/15 text-accent" : "glass-hover text-content"} ${collapsed ? "justify-center" : ""}`}
            >
              <Shield className="h-5 w-5 shrink-0" />
              {!collapsed && <span>Admin</span>}
            </button>
          )}
          
          <button
            onClick={onLogout}
            title={collapsed ? "Log out" : undefined}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium text-danger/80 glass-hover hover:bg-danger/10 hover:text-danger transition-colors ${collapsed ? "justify-center" : ""}`}
          >
            <LogOut className="h-5 w-5 shrink-0" />
            {!collapsed && <span>Log out</span>}
          </button>
          
          {!collapsed && version.data?.version && (
             <div className="text-center mt-2">
               <span className="text-[10px] text-content-muted/50 font-mono">v{version.data.version}</span>
             </div>
          )}
        </div>
      </aside>
    </>
  );
}
