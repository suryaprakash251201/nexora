import { useState } from "react";
import { ListMusic, Play, Pencil, Trash2, Plus, X, Music, Image as ImageIcon, Eye, EyeOff, ChevronDown } from "lucide-react";
import { usePlaylists } from "../store/playlists";
import { usePlayer } from "../store/player";
import { useUI } from "../store";
import { thumbUrl } from "../lib/preview";

function PlaylistCover({ playlist }: { playlist: any }) {
  const [failed, setFailed] = useState(false);
  const hasCover = playlist.cover_root_id && playlist.cover_path;

  if (hasCover && !failed) {
    const item = { root_id: playlist.cover_root_id, path: playlist.cover_path, name: "", extension: "", mime: "image/jpeg", is_dir: false, size: 0, modified: "" };
    return (
      <img
        src={thumbUrl(item)}
        alt=""
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }

  // Gradient fallback
  return (
    <div className="h-full w-full grid place-items-center bg-gradient-to-br from-accent/40 via-purple-500/30 to-pink-500/20">
      <ListMusic className="h-6 w-6 text-white/80" />
    </div>
  );
}

export default function PlaylistsPanel() {
  const playlists = usePlaylists((s) => s.playlists);
  const remove = usePlaylists((s) => s.remove);
  const rename = usePlaylists((s) => s.rename);
  const removeItem = usePlaylists((s) => s.removeItem);
  const addItems = usePlaylists((s) => s.addItems);
  const play = usePlaylists((s) => s.play);
  const playFrom = usePlaylists((s) => s.playFrom);
  const create = usePlaylists((s) => s.create);
  const setCover = usePlaylists((s) => s.setCover);
  const setPublic = usePlaylists((s) => s.setPublic);
  const current = usePlayer((s) => s.current());
  const pushToast = useUI((s) => s.pushToast);
  const [expanded, setExpanded] = useState<string | null>(playlists[0]?.id ?? null);

  const addCurrent = async (id: string) => {
    if (!current) {
      pushToast("info", "Nothing is playing right now");
      return;
    }
    try {
      const result = await addItems(id, [current]);
      const pl = playlists.find((p) => p.id === id);
      if (result.skipped > 0) {
        pushToast("info", `"${current.name}" is already in "${pl?.name ?? "playlist"}"`);
      } else {
        pushToast("success", `Added "${current.name}" to "${pl?.name ?? "playlist"}"`);
      }
    } catch {
      pushToast("error", "Failed to add track");
    }
  };

  const newPlaylist = async () => {
    const name = window.prompt("Playlist name", `Playlist ${playlists.length + 1}`);
    if (name !== null) {
      const pl = await create(name.trim() || `Playlist ${playlists.length + 1}`, []);
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

  const doSetCover = (id: string) => {
    const rootId = window.prompt("Enter the root ID of the cover image:");
    if (!rootId) return;
    const path = window.prompt("Enter the file path of the cover image:");
    if (!path) return;
    setCover(id, rootId.trim(), path.trim());
    pushToast("success", "Cover image updated");
  };

  const doTogglePublic = (id: string, currentState: boolean) => {
    setPublic(id, !currentState);
    pushToast("success", !currentState ? "Playlist is now public" : "Playlist is now private");
  };

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold flex items-center gap-2"><ListMusic className="h-5 w-5 text-accent" /> Playlists</h2>
        <button onClick={newPlaylist} className="flex items-center gap-1.5 px-4 py-2 rounded-xl accent-glass text-sm font-medium"><Plus className="h-4 w-4" /> New playlist</button>
      </div>

      {playlists.length === 0 ? (
        <div className="text-center text-content-muted p-10 glass rounded-2xl">
          <div className="h-16 w-16 mx-auto mb-4 rounded-2xl bg-accent/10 grid place-items-center">
            <ListMusic className="h-8 w-8 text-accent" />
          </div>
          <p className="mb-1 font-medium">No playlists yet.</p>
          <p className="text-sm">Select audio files in the Files view and choose "Add to playlist".</p>
        </div>
      ) : (
        <div className="space-y-4">
          {playlists.map((pl) => (
            <div key={pl.id} className="glass rounded-2xl overflow-hidden border border-border/30 hover:border-accent/20 transition-colors">
              {/* Playlist Header */}
              <div className="flex items-center gap-3 p-3">
                {/* Cover Image */}
                <div
                  className="h-14 w-14 rounded-xl overflow-hidden shrink-0 shadow-md cursor-pointer ring-1 ring-white/10 hover:ring-accent/30 transition-all"
                  onClick={() => doSetCover(pl.id)}
                  title="Click to set cover image"
                >
                  <PlaylistCover playlist={pl} />
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold truncate text-[15px]">{pl.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xs text-content-muted">{pl.items.length} track{pl.items.length === 1 ? "" : "s"}</p>
                    {pl.is_public && (
                      <span className="px-1.5 py-0.5 rounded-md bg-accent/10 text-accent text-[10px] font-bold uppercase">Public</span>
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => addCurrent(pl.id)}
                    disabled={!current}
                    className="p-2 rounded-xl glass-hover disabled:opacity-40"
                    title="Add currently playing track"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => play(pl.id)}
                    disabled={!pl.items.length}
                    className="p-2 rounded-xl accent-glass disabled:opacity-40"
                    title="Play all"
                  >
                    <Play className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => doTogglePublic(pl.id, pl.is_public)}
                    className={`p-2 rounded-xl glass-hover ${pl.is_public ? "text-accent" : "text-content-muted"}`}
                    title={pl.is_public ? "Make private" : "Make public"}
                  >
                    {pl.is_public ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                  <button onClick={() => doRename(pl.id, pl.name)} className="p-2 rounded-xl glass-hover" title="Rename"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => doRemove(pl.id, pl.name)} className="p-2 rounded-xl glass-hover text-red-500 hover:bg-red-500/10" title="Delete"><Trash2 className="h-4 w-4" /></button>
                  <button
                    onClick={() => setExpanded((e) => (e === pl.id ? null : pl.id))}
                    className="p-2 rounded-xl glass-hover"
                    title={expanded === pl.id ? "Collapse" : "Expand"}
                  >
                    <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${expanded === pl.id ? "rotate-180" : ""}`} />
                  </button>
                </div>
              </div>

              {/* Track List */}
              {expanded === pl.id && (
                <div className="border-t glass-divider">
                  {pl.items.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-content-muted">Empty. Add audio from the Files view → "Add to playlist".</p>
                  ) : (
                    pl.items.map((it, i) => (
                      <div
                        key={it.path + i}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/5 cursor-pointer transition-colors"
                        onClick={() => playFrom(pl.id, i)}
                      >
                        <span className="text-xs text-content-muted/60 w-6 text-right font-mono shrink-0">{i + 1}</span>
                        <Music className="h-4 w-4 text-content-muted shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm truncate font-medium">{it.name}</p>
                          <p className="text-[11px] text-content-muted/70 truncate">{it.path}</p>
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
