import { HardDrive, Trash2, Moon, Sun, Plus, Share2, Clock, Star } from "lucide-react";
import type { Root } from "../api/types";
import { useUI } from "../store";

export default function Sidebar({
  roots,
  activeRoot,
  view,
  onSelectRoot,
  onSelectTrash,
  onNewRoot,
}: {
  roots: Root[];
  activeRoot: string | null;
  view: "files" | "trash";
  onSelectRoot: (id: string) => void;
  onSelectTrash: () => void;
  onNewRoot: () => void;
}) {
  const theme = useUI((s) => s.theme);
  const toggleTheme = useUI((s) => s.toggleTheme);

  return (
    <aside className="w-60 shrink-0 border-r bg-surface-muted/40 flex flex-col h-full">
      <div className="h-14 flex items-center gap-2 px-4 border-b">
        <div className="h-8 w-8 rounded-lg bg-accent grid place-items-center text-accent-fg font-bold">N</div>
        <span className="font-semibold text-lg">Nexora</span>
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        <p className="px-2 pt-2 pb-1 text-xs uppercase tracking-wide text-content-muted">Storage</p>
        {roots.map((r) => (
          <button
            key={r.id}
            onClick={() => onSelectRoot(r.id)}
            className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm ${
              view === "files" && activeRoot === r.id ? "bg-accent/15 text-accent" : "hover:bg-surface-muted"
            }`}
          >
            <HardDrive className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate">{r.name}</span>
            {r.read_only && <span className="text-[10px] uppercase text-content-muted">ro</span>}
          </button>
        ))}
        <button
          onClick={onNewRoot}
          className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm text-content-muted hover:bg-surface-muted"
        >
          <Plus className="h-4 w-4" /> New storage root
        </button>

        <p className="px-2 pt-4 pb-1 text-xs uppercase tracking-wide text-content-muted">Workspace</p>
        <button
          onClick={onSelectTrash}
          className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm ${
            view === "trash" ? "bg-accent/15 text-accent" : "hover:bg-surface-muted"
          }`}
        >
          <Trash2 className="h-4 w-4" /> Trash
        </button>
        <button className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm text-content-muted hover:bg-surface-muted" disabled>
          <Star className="h-4 w-4" /> Favorites
        </button>
        <button className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm text-content-muted hover:bg-surface-muted" disabled>
          <Clock className="h-4 w-4" /> Recent
        </button>
        <button className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm text-content-muted hover:bg-surface-muted" disabled>
          <Share2 className="h-4 w-4" /> Shared
        </button>
      </nav>

      <div className="p-2 border-t flex items-center justify-between">
        <span className="text-xs text-content-muted">v1.0</span>
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg hover:bg-surface-muted"
          title="Toggle theme"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  );
}
