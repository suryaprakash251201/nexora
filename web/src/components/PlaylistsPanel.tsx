import { useState } from "react";
import { ListMusic, Play, Pencil, Trash2, Plus, X, Music } from "lucide-react";
import { usePlaylists } from "../store/playlists";
import { useUI } from "../store";

export default function PlaylistsPanel() {
  const playlists = usePlaylists((s) => s.playlists);
  const remove = usePlaylists((s) => s.remove);
  const rename = usePlaylists((s) => s.rename);
  const removeItem = usePlaylists((s) => s.removeItem);
  const play = usePlaylists((s) => s.play);
  const playFrom = usePlaylists((s) => s.playFrom);
  const create = usePlaylists((s) => s.create);
  const pushToast = useUI((s) => s.pushToast);
  const [expanded, setExpanded] = useState<string | null>(playlists[0]?.id ?? null);

  const newPlaylist = () => {
    const name = window.prompt("Playlist name", `Playlist ${playlists.length + 1}`);
    if (name !== null) {
      const pl = create(name.trim() || `Playlist ${playlists.length + 1}`, []);
      setExpanded(pl.id);
    }
  };

  const doRename = (id: string, current: string) => {
    const name = window.prompt("Rename playlist", current);
    if (name && name.trim()) rename(id, name.trim());
  };

  const doRemove = (id: string, name: string) => {
    if (confirm(`Delete playlist "${name}"?`)) remove(id);
  };

  const doRemoveItem = (id: string, path: string) => {
    removeItem(id, path);
    pushToast("info", "Track removed");
  };

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2"><ListMusic className="h-5 w-5 text-accent" /> Playlists</h2>
        <button onClick={newPlaylist} className="flex items-center gap-1 px-3 py-1.5 rounded-lg accent-glass text-sm"><Plus className="h-4 w-4" /> New playlist</button>
      </div>

      {playlists.length === 0 ? (
        <div className="text-center text-content-muted p-10">
          <p className="mb-1">No playlists yet.</p>
          <p className="text-sm">Select audio files in the Files view and choose “Add to playlist”.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {playlists.map((pl) => (
            <div key={pl.id} className="glass rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 px-3 py-3">
                <div className="h-10 w-10 rounded-lg grid place-items-center bg-accent/15 text-accent shrink-0">
                  <ListMusic className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{pl.name}</p>
                  <p className="text-xs text-content-muted">{pl.items.length} track{pl.items.length === 1 ? "" : "s"}</p>
                </div>
                <button
                  onClick={() => play(pl.id)}
                  disabled={!pl.items.length}
                  className="p-2 rounded-full accent-glass disabled:opacity-40"
                  title="Play"
                >
                  <Play className="h-4 w-4" />
                </button>
                <button onClick={() => doRename(pl.id, pl.name)} className="p-2 rounded-lg glass-hover" title="Rename"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => doRemove(pl.id, pl.name)} className="p-2 rounded-lg glass-hover text-red-500 hover:bg-red-500/10" title="Delete"><Trash2 className="h-4 w-4" /></button>
                <button
                  onClick={() => setExpanded((e) => (e === pl.id ? null : pl.id))}
                  className="p-2 rounded-lg glass-hover"
                  title={expanded === pl.id ? "Collapse" : "Expand"}
                >
                  <span className={`transition-transform ${expanded === pl.id ? "rotate-180" : ""}`}>▾</span>
                </button>
              </div>

              {expanded === pl.id && (
                <div className="border-t glass-divider">
                  {pl.items.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-content-muted">Empty. Add audio from the Files view → “Add to playlist”.</p>
                  ) : (
                    pl.items.map((it, i) => (
                      <div
                        key={it.path + i}
                        className="flex items-center gap-3 px-3 py-2 hover:bg-accent/5 cursor-pointer"
                        onClick={() => playFrom(pl.id, i)}
                      >
                        <Music className="h-4 w-4 text-content-muted shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm truncate">{it.name}</p>
                          <p className="text-[11px] text-content-muted truncate">{it.path}</p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); doRemoveItem(pl.id, it.path); }}
                          className="p-1.5 rounded-lg glass-hover text-content-muted hover:text-red-500"
                          title="Remove from playlist"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
