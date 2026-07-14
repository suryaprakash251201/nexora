import { HardDrive, Trash2, Moon, Sun, Plus, Share2, Clock, Star, Search, Shield, ListMusic, LogOut } from "lucide-react";
import type { Root } from "../api/types";
import { useUI } from "../store";
import { usePlaylists } from "../store/playlists";

export type SidebarView = "files" | "trash" | "favorites" | "recents" | "shares" | "search" | "admin";

export default function Sidebar({
  roots,
  activeRoot,
  view,
  isAdmin,
  onSelectRoot,
  onSelectView,
  onNewRoot,
  onLogout,
}: {
  roots: Root[];
  activeRoot: string | null;
  view: SidebarView;
  isAdmin: boolean;
  onSelectRoot: (id: string) => void;
  onSelectView: (v: SidebarView) => void;
  onNewRoot: () => void;
  onLogout: () => void;
}) {
  const theme = useUI((s) => s.theme);
  const toggleTheme = useUI((s) => s.toggleTheme);
  const playlists = usePlaylists((s) => s.playlists);

  const navBtn = (v: SidebarView, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => onSelectView(v)}
      className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm glass-hover ${
        view === v ? "bg-accent/15 text-accent" : ""
      }`}
    >
      {icon} {label}
    </button>
  );

  return (
    <aside className="w-60 shrink-0 border-r glass flex flex-col h-full">
      <div className="h-14 flex items-center gap-2 px-4 border-b">
        <div className="h-8 w-8 rounded-lg bg-accent grid place-items-center text-accent-fg font-bold">N</div>
        <span className="font-semibold text-lg">Nexora</span>
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {navBtn("search", <Search className="h-4 w-4" />, "Search")}

        <p className="px-2 pt-3 pb-1 text-xs uppercase tracking-wide text-content-muted">Storage</p>
        {roots.map((r) => (
          <button
            key={r.id}
            onClick={() => onSelectRoot(r.id)}
            className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm glass-hover ${
              view === "files" && activeRoot === r.id ? "bg-accent/15 text-accent" : ""
            }`}
          >
            <HardDrive className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate">{r.name}</span>
            {r.read_only && <span className="text-[10px] uppercase text-content-muted">ro</span>}
          </button>
        ))}
        {isAdmin && (
          <button onClick={onNewRoot} className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm text-content-muted glass-hover">
            <Plus className="h-4 w-4" /> New storage root
          </button>
        )}

        <p className="px-2 pt-4 pb-1 text-xs uppercase tracking-wide text-content-muted">Workspace</p>
        {navBtn("favorites", <Star className="h-4 w-4" />, "Favorites")}
        {navBtn("recents", <Clock className="h-4 w-4" />, "Recent")}
        {navBtn("shares", <Share2 className="h-4 w-4" />, "Shared")}
        {navBtn("trash", <Trash2 className="h-4 w-4" />, "Trash")}

        <p className="px-2 pt-4 pb-1 text-xs uppercase tracking-wide text-content-muted">Playlists</p>
        {playlists.length === 0 ? (
          <p className="px-2 text-xs text-content-muted">No playlists yet</p>
        ) : (
          playlists.map((pl) => (
            <button
              key={pl.id}
              onClick={() => usePlaylists.getState().play(pl.id)}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm glass-hover"
            >
              <ListMusic className="h-4 w-4 shrink-0 text-accent" />
              <span className="flex-1 truncate">{pl.name}</span>
              <span className="text-[10px] text-content-muted">{pl.items.length}</span>
            </button>
          ))
        )}

        {isAdmin && (
          <>
            <p className="px-2 pt-4 pb-1 text-xs uppercase tracking-wide text-content-muted">Administration</p>
            {navBtn("admin", <Shield className="h-4 w-4" />, "Admin")}
          </>
        )}
      </nav>

      <div className="p-2 border-t flex flex-col gap-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-content-muted">v1.3</span>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg glass-hover"
            title="Toggle theme"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 px-2 py-2 rounded-lg text-sm text-content-muted glass-hover hover:text-red-500 hover:border-red-500/40"
          title="Log out"
        >
          <LogOut className="h-4 w-4" /> Log out
        </button>
      </div>
    </aside>
  );
}
