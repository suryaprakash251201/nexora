import { useState } from "react";
import { ListMusic, Play, Pencil, Trash2, Plus, X, Music, Eye, EyeOff, ArrowLeft } from "lucide-react";
import { usePlaylists } from "../store/playlists";
import { usePlayer } from "../store/player";
import { useUI } from "../store";
import { thumbUrl } from "../lib/preview";
import { Modal } from "./Modal";
import CoverPickerModal from "./CoverPickerModal";
import type { User } from "../api/types";

function PlaylistCover({ playlist, className = "" }: { playlist: any; className?: string }) {
  const [failed, setFailed] = useState(false);
  const hasCover = playlist.cover_root_id && playlist.cover_path;

  if (hasCover && !failed) {
    const item = { root_id: playlist.cover_root_id, path: playlist.cover_path, name: "", extension: "", mime: "image/jpeg", is_dir: false, size: 0, modified: "" };
    return (
      <img
        src={thumbUrl(item)}
        alt=""
        className={`h-full w-full object-cover ${className}`}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className={`h-full w-full grid place-items-center bg-gradient-to-br from-accent/40 via-purple-500/30 to-pink-500/20 ${className}`}>
      <ListMusic className="h-8 w-8 text-white/80" />
    </div>
  );
}

export default function PlaylistsPanel({ user }: { user?: User }) {
  const isAdmin = user?.role === "admin";
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newModal, setNewModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [coverModal, setCoverModal] = useState<{ id: string } | null>(null);

  const selected = selectedId ? playlists.find((p) => p.id === selectedId) : null;

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
    setNewName(`Playlist ${playlists.length + 1}`);
    setNewModal(true);
  };

  const doCreate = async () => {
    if (!newName.trim()) return;
    const pl = await create(newName.trim(), []);
    setSelectedId(pl.id);
    setNewModal(false);
  };

  const doRename = (id: string, current: string) => {
    setRenameTarget({ id, name: current });
  };

  const doRenameConfirm = () => {
    if (renameTarget && renameTarget.name.trim()) {
      rename(renameTarget.id, renameTarget.name.trim());
      setRenameTarget(null);
    }
  };

  const doRemove = (id: string, name: string) => {
    setDeleteTarget({ id, name });
  };

  const doRemoveItem = (id: string, path: string) => {
    removeItem(id, path);
    pushToast("info", "Track removed");
  };

  const doSetCover = (id: string) => {
    setCoverModal({ id });
  };

  const doCoverConfirm = (rootId: string, path: string) => {
    if (!coverModal) return;
    setCover(coverModal.id, rootId, path);
    pushToast("success", "Cover image updated");
    setCoverModal(null);
  };

  const doTogglePublic = (id: string, currentState: boolean) => {
    setPublic(id, !currentState);
    pushToast("success", !currentState ? "Playlist is now public" : "Playlist is now private");
  };

  if (selected) {
    return (
      <div className="flex-1 overflow-auto p-4">
        <button onClick={() => setSelectedId(null)} className="flex items-center gap-1.5 text-sm text-content-muted hover:text-content transition-colors mb-4">
          <ArrowLeft className="h-4 w-4" /> Playlists
        </button>

        <div className="flex flex-col md:flex-row gap-6 mb-8">
          <div className="w-full md:w-56 lg:w-64 shrink-0">
            <div className="aspect-square rounded-2xl overflow-hidden shadow-xl ring-1 ring-white/10">
              <PlaylistCover playlist={selected} className="rounded-2xl" />
            </div>
          </div>

          <div className="flex-1 min-w-0 flex flex-col justify-end">
            <h1 className="text-2xl md:text-3xl font-extrabold truncate">{selected.name}</h1>
            <div className="flex items-center gap-2 mt-1.5 text-sm text-content-muted">
              <span>{selected.items.length} track{selected.items.length === 1 ? "" : "s"}</span>
              {selected.is_public && (
                <span className="px-1.5 py-0.5 rounded-md bg-accent/10 text-accent text-[10px] font-bold uppercase">Public</span>
              )}
            </div>

            <div className="flex items-center gap-2 mt-4 flex-wrap">
              <button
                onClick={() => play(selected.id)}
                disabled={!selected.items.length}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl accent-glass text-sm font-medium disabled:opacity-40"
              >
                <Play className="h-4 w-4" /> Play All
              </button>
              <button
                onClick={() => addCurrent(selected.id)}
                disabled={!current}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl glass-hover border border-border/50 text-sm font-medium disabled:opacity-40"
              >
                <Plus className="h-4 w-4" /> Add Current
              </button>
              {isAdmin && (
                <>
                  <button
                    onClick={() => doSetCover(selected.id)}
                    className="p-2 rounded-xl glass-hover text-content-muted hover:text-content"
                    title="Set cover"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => doTogglePublic(selected.id, selected.is_public)}
                    className={`p-2 rounded-xl glass-hover ${selected.is_public ? "text-accent" : "text-content-muted"}`}
                    title={selected.is_public ? "Make private" : "Make public"}
                  >
                    {selected.is_public ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <button onClick={() => doRename(selected.id, selected.name)} className="p-2 rounded-xl glass-hover text-content-muted hover:text-content" title="Rename">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => doRemove(selected.id, selected.name)} className="p-2 rounded-xl glass-hover text-red-500 hover:bg-red-500/10" title="Delete">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {selected.items.length === 0 ? (
          <div className="text-center text-content-muted py-16 glass rounded-2xl">
            <div className="h-16 w-16 mx-auto mb-4 rounded-2xl bg-accent/10 grid place-items-center">
              <Music className="h-8 w-8 text-accent" />
            </div>
            <p className="font-medium">No tracks yet.</p>
            <p className="text-sm mt-1">Add audio files from the Files view via "Add to playlist".</p>
          </div>
        ) : (
          <div className="glass rounded-2xl overflow-hidden border border-border/30">
            {selected.items.map((it, i) => {
              const nowPlaying = usePlayer.getState().queue[usePlayer.getState().index]?.path === it.path;
              return (
                <div
                  key={it.path + i}
                  className={`group flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                    nowPlaying ? "bg-accent/10" : "hover:bg-accent/5"
                  } border-b border-border/20 last:border-0`}
                  onClick={() => playFrom(selected.id, i)}
                >
                  <span className={`text-xs w-6 text-right font-mono shrink-0 ${nowPlaying ? "text-accent font-bold" : "text-content-muted/60"}`}>
                    {nowPlaying ? "♪" : i + 1}
                  </span>
                  <Music className={`h-4 w-4 shrink-0 ${nowPlaying ? "text-accent" : "text-content-muted"}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm truncate ${nowPlaying ? "font-bold text-accent" : "font-medium"}`}>{it.name}</p>
                    <p className="text-[11px] text-content-muted/70 truncate">{it.path}</p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); doRemoveItem(selected.id, it.path); }}
                    className="p-1.5 rounded-lg glass-hover text-content-muted hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    title="Remove from playlist"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {renameTarget && (
          <Modal title="Rename playlist" onClose={() => setRenameTarget(null)}
            footer={<button onClick={doRenameConfirm} className="px-3 py-1.5 rounded-lg accent-glass text-sm font-medium">Rename</button>}>
            <input
              autoFocus
              value={renameTarget.name}
              onChange={(e) => setRenameTarget({ ...renameTarget, name: e.target.value })}
              className="w-full rounded-lg glass-input px-3 py-2 outline-none text-sm"
              onKeyDown={(e) => { if (e.key === "Enter") doRenameConfirm(); }}
            />
          </Modal>
        )}

        {deleteTarget && (
          <Modal title="Delete playlist" onClose={() => setDeleteTarget(null)}
            description={`Are you sure you want to delete "${deleteTarget.name}"?`}
            footer={
              <>
                <button onClick={() => setDeleteTarget(null)} className="px-3 py-1.5 rounded-lg glass-hover text-sm font-medium">Cancel</button>
                <button onClick={() => { remove(deleteTarget.id); setDeleteTarget(null); setSelectedId(null); pushToast("info", "Playlist deleted"); }} className="px-3 py-1.5 rounded-lg bg-danger text-white text-sm font-medium">Delete</button>
              </>
            }>
            <></>
          </Modal>
        )}

        {coverModal && (
          <CoverPickerModal
            onClose={() => setCoverModal(null)}
            onConfirm={doCoverConfirm}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold flex items-center gap-2"><ListMusic className="h-5 w-5 text-accent" /> Playlists</h2>
        {isAdmin && <button onClick={newPlaylist} className="flex items-center gap-1.5 px-4 py-2 rounded-xl accent-glass text-sm font-medium"><Plus className="h-4 w-4" /> New</button>}
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {playlists.map((pl) => (
            <button
              key={pl.id}
              onClick={() => setSelectedId(pl.id)}
              className="group text-left outline-none"
            >
              <div className="aspect-square rounded-2xl overflow-hidden mb-2.5 shadow-md ring-1 ring-white/10 group-hover:ring-accent/40 transition-all duration-300 relative bg-surface-muted/30">
                <PlaylistCover playlist={pl} className="group-hover:scale-105 transition-transform duration-500" />
                <div className="absolute inset-0 bg-black/10 group-hover:bg-black/30 transition-colors duration-300" />
                <div className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-all duration-300 scale-90 group-hover:scale-100">
                  <div className="h-12 w-12 rounded-full bg-accent/90 text-white grid place-items-center shadow-lg backdrop-blur-md">
                    <Play className="h-6 w-6 ml-1" />
                  </div>
                </div>
              </div>
              <p className="font-semibold text-sm truncate group-hover:text-accent transition-colors">{pl.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-xs text-content-muted">{pl.items.length} track{pl.items.length === 1 ? "" : "s"}</span>
                {pl.is_public && (
                  <span className="px-1 py-0.5 rounded bg-accent/10 text-accent text-[9px] font-bold uppercase">Public</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {newModal && (
        <Modal title="New playlist" onClose={() => setNewModal(false)}
          footer={<button onClick={doCreate} className="px-3 py-1.5 rounded-lg accent-glass text-sm font-medium">Create</button>}>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full rounded-lg glass-input px-3 py-2 outline-none text-sm"
            placeholder="Playlist name"
            onKeyDown={(e) => { if (e.key === "Enter") doCreate(); }}
          />
        </Modal>
      )}
    </div>
  );
}
