import { Trash2, Plus, Share2, Clock, Star, Search, Shield, ListMusic, Home, PanelLeftClose, PanelLeftOpen, LogOut } from "lucide-react";
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
      className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm glass-hover ${
        view === v ? "bg-accent/15 text-accent" : ""
      }`}
    >
      {icon} {!collapsed && label}
    </button>
  );

  if (collapsed) {
    return (
      <aside className="w-14 shrink-0 border-r glass flex flex-col h-full items-center py-3 gap-2">
        <div className="h-8 w-8 rounded-lg bg-accent grid place-items-center text-accent-fg font-bold">N</div>
        <button onClick={() => onSelectView("home")} title="Home" className={`p-2 rounded-lg glass-hover ${view === "home" ? "bg-accent/15 text-accent" : ""}`}><Home className="h-4 w-4" /></button>
        <button onClick={() => onSelectView("search")} title="Search" className={`p-2 rounded-lg glass-hover ${view === "search" ? "bg-accent/15 text-accent" : ""}`}><Search className="h-4 w-4" /></button>
        <div className="w-8 h-px glass-divider my-1" />
        {roots.map((r) => {
          const Icon = rootIcon(r.icon);
          return (
            <button
              key={r.id}
              onClick={() => onSelectRoot(r.id)}
              title={r.name}
              className={`p-2 rounded-lg glass-hover ${view === "files" && activeRoot === r.id ? "bg-accent/15 text-accent" : ""}`}
            >
              <Icon className="h-4 w-4 shrink-0" />
            </button>
          );
        })}
        <div className="w-8 h-px glass-divider my-1" />
        {navBtn("favorites", <Star className="h-4 w-4" />, "Favorites")}
        {navBtn("recents", <Clock className="h-4 w-4" />, "Recent")}
        {navBtn("shares", <Share2 className="h-4 w-4" />, "Shared")}
        {navBtn("playlists", <ListMusic className="h-4 w-4" />, "Playlists")}
        {navBtn("trash", <Trash2 className="h-4 w-4" />, "Trash")}
        <div className="flex-1" />
        {isAdmin && (
          <button onClick={() => onSelectView("admin")} title="Admin" className={`p-2 rounded-lg glass-hover ${view === "admin" ? "bg-accent/15 text-accent" : ""}`}><Shield className="h-4 w-4" /></button>
        )}
        <button onClick={onLogout} title="Log out" className="p-2 rounded-lg glass-hover text-red-500"><LogOut className="h-4 w-4" /></button>
        <button onClick={onToggleCollapse} title="Expand sidebar" className="p-2 rounded-lg glass-hover"><PanelLeftOpen className="h-4 w-4" /></button>
      </aside>
    );
  }

  return (
    <aside className="w-60 shrink-0 border-r glass flex flex-col h-full">
      <div className="h-14 flex items-center gap-2 px-4 border-b">
        <div className="h-8 w-8 rounded-lg bg-accent grid place-items-center text-accent-fg font-bold">N</div>
        <span className="font-semibold text-lg">Nexora</span>
        <button onClick={onToggleCollapse} title="Collapse sidebar" aria-label="Collapse sidebar" className="ml-auto p-1.5 rounded-lg glass-hover">
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {navBtn("home", <Home className="h-4 w-4" />, "Home")}
        {navBtn("search", <Search className="h-4 w-4" />, "Search")}

        <p className="px-2 pt-3 pb-1 text-xs uppercase tracking-wide text-content-muted">Storage</p>
        {roots.map((r) => {
          const Icon = rootIcon(r.icon);
          return (
            <button
              key={r.id}
              onClick={() => onSelectRoot(r.id)}
              className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm glass-hover ${
                view === "files" && activeRoot === r.id ? "bg-accent/15 text-accent" : ""
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate">{r.name}</span>
              {r.read_only && <span className="text-[10px] uppercase text-content-muted">ro</span>}
            </button>
          );
        })}
        {isAdmin && (
          <button onClick={onNewRoot} className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm text-content-muted glass-hover">
            <Plus className="h-4 w-4" /> New storage root
          </button>
        )}

        <p className="px-2 pt-4 pb-1 text-xs uppercase tracking-wide text-content-muted">Workspace</p>
        {navBtn("favorites", <Star className="h-4 w-4" />, "Favorites")}
        {navBtn("recents", <Clock className="h-4 w-4" />, "Recent")}
        {navBtn("shares", <Share2 className="h-4 w-4" />, "Shared")}
        {navBtn("playlists", <ListMusic className="h-4 w-4" />, "Playlists")}
        {navBtn("trash", <Trash2 className="h-4 w-4" />, "Trash")}
      </nav>

      <div className="p-2 border-t flex flex-col gap-1">
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="text-xs text-content-muted">{version.data?.version ? `v${version.data.version}` : ""}</span>
        </div>
        {isAdmin && (
          <button
            onClick={() => onSelectView("admin")}
            className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm glass-hover ${view === "admin" ? "bg-accent/15 text-accent" : ""}`}
          >
            <Shield className="h-4 w-4" /> Admin
          </button>
        )}
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm text-content-muted glass-hover hover:text-red-500"
        >
          <LogOut className="h-4 w-4" /> Log out
        </button>
      </div>
    </aside>
  );
}
