import { useState, useEffect, useMemo, useRef } from "react";
import { ListMusic, Play, Pencil, Trash2, Plus, X, Music, ArrowLeft, Download, Share2, Users, UserPlus, Search, LoaderCircle, MoreVertical, Image as ImageIcon, Globe, Lock } from "lucide-react";
import { usePlayer } from "../store/player";
import { useUI } from "../store";
import { thumbUrl } from "../lib/preview";
import { startDownload } from "../lib/transfer";
import { Modal } from "./Modal";
import { Button } from "./ui/Button";
import CoverPickerModal from "./CoverPickerModal";
import ShareDialog from "./ShareDialog";
import type { User } from "../api/types";
;
import { usersApi } from "../api/endpoints";
import {
  usePlaylists,
  usePublicPlaylists,
  useCreatePlaylist,
  useDeletePlaylist,
  useRenamePlaylist,
  useAddPlaylistItems,
  useRemovePlaylistItem,
  useSetPlaylistCover,
  useSetPlaylistPublic,
  usePlaylistCollaborators,
  useAddCollaborator,
  useRemoveCollaborator,
  type Playlist as StorePlaylist,
} from "../hooks/usePlaylists";
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
// ── Playlist dot menu (⋯) ────────────────────────────────────────────────
function PlaylistDotMenu({
  playlist,
  onSetCover,
  onTogglePublic,
  onRename,
  onDelete,
}: {
  playlist: { id: string; name: string; is_public: boolean };
  onSetCover: () => void;
  onTogglePublic: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-2 rounded-xl glass-hover text-content-muted hover:text-content"
        title="More options"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-xl bg-surface border border-border/50 shadow-xl py-1 animate-scale-in">
          <button
            onClick={() => { onSetCover(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-content hover:bg-accent/10 transition-colors"
          >
            <ImageIcon className="h-4 w-4 text-content-muted" /> Set Cover Photo
          </button>
          <button
            onClick={() => { onTogglePublic(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-content hover:bg-accent/10 transition-colors"
          >
            {playlist.is_public ? (
              <><Lock className="h-4 w-4 text-warning" /> Make Private</>
            ) : (
              <><Globe className="h-4 w-4 text-accent" /> Make Public</>
            )}
          </button>
          <div className="my-1 border-t border-border/50" />
          <button
            onClick={() => { onRename(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-content hover:bg-accent/10 transition-colors"
          >
            <Pencil className="h-4 w-4 text-content-muted" /> Rename
          </button>
          <button
            onClick={() => { onDelete(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-danger hover:bg-danger/10 transition-colors"
          >
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}
// ── Collaborator management modal ──────────────────────────────────────────
function CollaboratorModal({ playlist, onClose }: { playlist: { id: string; name: string }; onClose: () => void }) {
  const pushToast = useUI((s) => s.pushToast);
  const { data: collabData, isLoading: loading } = usePlaylistCollaborators(playlist.id);
  const addCollabMut = useAddCollaborator();
  const removeCollabMut = useRemoveCollaborator();
  const collabs = collabData?.collaborators ?? [];
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; username: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const search = async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await usersApi.search(q.trim());
      setResults(res.users || []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };
  const add = async (userId: string, username: string) => {
    try {
      await addCollabMut.mutateAsync({ id: playlist.id, userId, role });
      setResults([]);
      setQuery("");
      pushToast("success", `Added ${username} as ${role}`);
    } catch (e: any) {
      pushToast("error", e.message || "Could not add collaborator");
    }
  };
  const remove = async (userId: string, username: string) => {
    try {
      await removeCollabMut.mutateAsync({ id: playlist.id, userId });
      pushToast("info", `Removed ${username}`);
    } catch (e: any) {
      pushToast("error", e.message || "Could not remove collaborator");
    }
  };
  return (
    <Modal title="Collaborators" description={`Who can access "${playlist.name}"`} onClose={onClose} icon={<Users className="h-5 w-5 text-accent" />}>
      <div className="py-2 space-y-4">
        {/* Add collaborator */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-content-muted uppercase tracking-wider">Add by username</label>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
            <input
              value={query}
              onChange={(e) => search(e.target.value)}
              placeholder="Search users…"
              className="w-full rounded-lg glass-input pl-9 pr-3 py-2 outline-none text-sm"
            />
            {searching && <LoaderCircle className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-content-muted" />}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "editor" | "viewer")}
              className="rounded-lg glass-input px-2 py-1.5 outline-none text-xs font-medium"
              title="Collaborator role"
            >
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
            <span className="text-[11px] text-content-muted">Editors can add tracks & rename; viewers can only listen.</span>
          </div>
          {results.length > 0 && (
            <div className="rounded-xl border border-border/50 bg-surface/60 overflow-hidden divide-y divide-border/40">
              {results.map((u) => {
                const already = collabs.some((c) => c.user_id === u.id);
                return (
                  <button
                    key={u.id}
                    disabled={already}
                    onClick={() => add(u.id, u.username)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-surface/70 transition-colors ${already ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="h-6 w-6 rounded-full bg-accent/15 text-accent grid place-items-center text-[10px] font-bold uppercase">{u.username.slice(0, 2)}</span>
                      <span className="font-medium">{u.username}</span>
                    </span>
                    {already ? (
                      <span className="text-[10px] uppercase font-bold text-content-muted">Added</span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-accent"><UserPlus className="h-3.5 w-3.5" /> Add</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {/* Current collaborators */}
        <div>
          <label className="text-xs font-bold text-content-muted uppercase tracking-wider mb-2 block">Current collaborators</label>
          {loading ? (
            <div className="space-y-2">
              <div className="skeleton h-10 rounded-lg" />
              <div className="skeleton h-10 rounded-lg" />
            </div>
          ) : collabs.length === 0 ? (
            <p className="text-sm text-content-muted py-4 text-center border border-dashed border-border/50 rounded-xl">
              No collaborators yet — this playlist is private to you.
            </p>
          ) : (
            <div className="rounded-xl border border-border/50 bg-surface/60 overflow-hidden divide-y divide-border/40">
              {collabs.map((c) => (
                <div key={c.user_id} className="flex items-center justify-between px-3 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-6 w-6 rounded-full bg-accent/15 text-accent grid place-items-center text-[10px] font-bold uppercase shrink-0">
                      {(c.username || "?").slice(0, 2)}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{c.username || "Unknown user"}</p>
                      <p className="text-[10px] uppercase tracking-wider font-bold text-content-muted">{c.role}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => remove(c.user_id, c.username || c.user_id)}
                    className="p-1.5 rounded-lg glass-hover text-content-muted hover:text-red-500 transition-colors"
                    title="Remove collaborator"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
export default function PlaylistsPanel({ user }: { user?: User }) {
  const { data: playlistsData } = usePlaylists();
  const playlists = playlistsData?.items ?? [];
  const { data: publicData } = usePublicPlaylists();
  const createMutation = useCreatePlaylist();
  const deleteMutation = useDeletePlaylist();
  const renameMutation = useRenamePlaylist();
  const addItemsMutation = useAddPlaylistItems();
  const removeItemMutation = useRemovePlaylistItem();
  const setCoverMutation = useSetPlaylistCover();
  const setPublicMutation = useSetPlaylistPublic();
  const current = usePlayer((s) => s.current());
  const pushToast = useUI((s) => s.pushToast);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newModal, setNewModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [coverModal, setCoverModal] = useState<{ id: string } | null>(null);
  const [collabModal, setCollabModal] = useState(false);
  const [shareTarget, setShareTarget] = useState<{ item: any; rootId: string } | null>(null);
  const selected = selectedId ? playlists.find((p) => p.id === selectedId) : null;
  const canEditSelected = !!selected && (selected.is_owner || selected.can_edit);
  const isOwnerSelected = !!selected && !!selected.is_owner;
  const publicPlaylists = useMemo(() => {
    const list = publicData?.items || [];
    // Exclude playlists the user already sees in mine/shared
    const ownedIds = new Set(playlists.map(p => p.id));
    return list.filter(p => !ownedIds.has(p.id));
  }, [publicData, playlists]);
  // Playback helpers (previously on Zustand store)
  const play = (id: string) => {
    const pl = playlists.find((p) => p.id === id);
    if (pl?.items.length) usePlayer.getState().play(pl.items as any, 0);
  };
  const playFrom = (id: string, index: number) => {
    const pl = playlists.find((p) => p.id === id);
    if (pl?.items.length) usePlayer.getState().play(pl.items as any, Math.max(0, Math.min(index, pl.items.length - 1)));
  };
  const create = (name: string, items: any[]) => createMutation.mutateAsync({ name, items });
  const remove = (id: string) => deleteMutation.mutateAsync(id);
  const rename = (id: string, name: string) => renameMutation.mutateAsync({ id, name });
  const addItems = (id: string, items: any[]) => addItemsMutation.mutateAsync({ id, items });
  const removeItem = (id: string, path: string) => {
    const pl = playlists.find((p) => p.id === id);
    const itemToRemove: any = pl?.items.find((i: any) => i.path === path);
    const apiItemId = itemToRemove?.id;
    if (!apiItemId) {
      pushToast("error", "Cannot remove item without its server ID");
      return Promise.resolve();
    }
    return removeItemMutation.mutateAsync({ playlistId: id, itemId: apiItemId });
  };
  const setCover = (id: string, coverRootId: string, coverPath: string) =>
    setCoverMutation.mutateAsync({ id, coverRootId, coverPath });
  const setPublic = (id: string, isPublic: boolean) =>
    setPublicMutation.mutateAsync({ id, isPublic });
  // Group into "My Playlists" and "Shared with me".
  const { mine, shared } = useMemo(() => {
    const mine: StorePlaylist[] = [];
    const shared: StorePlaylist[] = [];
    for (const p of playlists as unknown as StorePlaylist[]) {
      if (p.is_owner) mine.push(p);
      else shared.push(p);
    }
    return { mine, shared };
  }, [playlists]);
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
  const newPlaylist = () => {
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
      <div className="flex-1 overflow-auto p-4 pb-24 md:pb-20">
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
            <div className="flex items-center gap-2 mt-1.5 text-sm text-content-muted flex-wrap">
              <span>{selected.items.length} track{selected.items.length === 1 ? "" : "s"}</span>
              <span className="text-content-muted/60">·</span>
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {selected.is_owner ? "Owned by you" : `Shared by ${selected.owner_username || "someone"}`}
              </span>
              {!selected.is_owner && (
                <span className="px-1.5 py-0.5 rounded-md bg-surface border border-border/50 text-[10px] font-bold uppercase text-content-muted">
                  {selected.can_edit ? "Editor" : "Viewer"}
                </span>
              )}
              {selected.is_public && (
                <span className="px-1.5 py-0.5 rounded-md bg-accent/10 text-accent text-[10px] font-bold uppercase">Public</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-4 flex-wrap">
              <Button
                variant="primary"
                onClick={() => play(selected.id)}
                disabled={!selected.items.length}
              >
                <Play className="h-4 w-4" /> Play All
              </Button>
              <button
                onClick={() => addCurrent(selected.id)}
                disabled={!current || !canEditSelected}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl glass-hover border border-border/50 text-sm font-medium disabled:opacity-40"
                title={!canEditSelected ? "Only owners and editors can add tracks" : undefined}
              >
                <Plus className="h-4 w-4" /> Add Current
              </button>
              {isOwnerSelected && (
                <button
                  onClick={() => setCollabModal(true)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl glass-hover border border-border/50 text-sm font-medium"
                >
                  <Users className="h-4 w-4" /> Collaborate
                </button>
              )}
              {isOwnerSelected && (
                <PlaylistDotMenu
                  playlist={selected}
                  onSetCover={() => doSetCover(selected.id)}
                  onTogglePublic={() => doTogglePublic(selected.id, selected.is_public)}
                  onRename={() => doRename(selected.id, selected.name)}
                  onDelete={() => doRemove(selected.id, selected.name)}
                />
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
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); startDownload(it.root_id, it.path, it.name); }}
                      className="p-1.5 rounded-lg glass-hover text-content-muted hover:text-accent"
                      title="Download track"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShareTarget({ item: { ...it, is_dir: false }, rootId: it.root_id }); }}
                      className="p-1.5 rounded-lg glass-hover text-content-muted hover:text-accent"
                      title="Share track"
                    >
                      <Share2 className="h-4 w-4" />
                    </button>
                    {canEditSelected && (
                      <button
                        onClick={(e) => { e.stopPropagation(); doRemoveItem(selected.id, it.path); }}
                        className="p-1.5 rounded-lg glass-hover text-content-muted hover:text-red-500"
                        title="Remove from playlist"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {collabModal && <CollaboratorModal playlist={selected} onClose={() => setCollabModal(false)} />}
        {shareTarget && (
          <ShareDialog item={shareTarget.item} rootId={shareTarget.rootId} onClose={() => setShareTarget(null)} />
        )}
        {renameTarget && (
          <Modal title="Rename playlist" onClose={() => setRenameTarget(null)}
            footer={<Button variant="primary" size="sm" onClick={doRenameConfirm}>Rename</Button>}>
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
  const renderGrid = (list: StorePlaylist[]) => (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {list.map((pl) => (
        <button
          key={pl.id}
          onClick={() => setSelectedId(pl.id)}
          className="group text-left outline-none"
        >
          <div className="aspect-square rounded-2xl overflow-hidden mb-2.5 shadow-md ring-1 ring-white/10 group-hover:ring-accent/40 transition-all duration-300 relative bg-surface-muted/30">
            <PlaylistCover playlist={pl} className="group-hover:scale-105 transition-transform duration-500" />
            <div className="absolute inset-0 bg-black/[0.05] dark:bg-black/10 group-hover:bg-black/[0.12] dark:group-hover:bg-black/30 transition-colors duration-300" />
            <div className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-all duration-300 scale-90 group-hover:scale-100">
              <div className="h-12 w-12 rounded-full bg-accent/90 text-white grid place-items-center shadow-lg backdrop-blur-md">
                <Play className="h-6 w-6 ml-1" />
              </div>
            </div>
            {!pl.is_owner && (
              <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-black/50 backdrop-blur-md text-[9px] font-bold uppercase text-white/90 flex items-center gap-1">
                <Users className="h-2.5 w-2.5" /> Shared
              </div>
            )}
          </div>
          <p className="font-semibold text-sm truncate group-hover:text-accent transition-colors">{pl.name}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-xs text-content-muted">{pl.items.length} track{pl.items.length === 1 ? "" : "s"}</span>
            {!pl.is_owner && pl.owner_username && (
              <span className="text-[10px] text-content-muted/60 truncate">· {pl.owner_username}</span>
            )}
            {pl.is_public && (
              <span className="px-1 py-0.5 rounded bg-accent/10 text-accent text-[9px] font-bold uppercase">Public</span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
  return (
    <div className="flex-1 overflow-auto p-4 pb-24 md:pb-20">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold flex items-center gap-2"><ListMusic className="h-5 w-5 text-accent" /> Playlists</h2>
        <Button variant="primary" onClick={newPlaylist}><Plus className="h-4 w-4" /> New</Button>
      </div>
      {playlists.length === 0 ? (
        <div className="text-center text-content-muted p-10 glass rounded-2xl">
          <div className="h-16 w-16 mx-auto mb-4 rounded-2xl bg-accent/10 grid place-items-center">
            <ListMusic className="h-8 w-8 text-accent" />
          </div>
          <p className="mb-1 font-medium">No playlists yet.</p>
          <p className="text-sm">Create your own playlist or select audio files in the Files view and choose "Add to playlist".</p>
        </div>
      ) : (
        <div className="space-y-8">
          {mine.length > 0 && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-content-muted mb-3 flex items-center gap-1.5">
                <ListMusic className="h-3.5 w-3.5" /> My Playlists ({mine.length})
              </h3>
              {renderGrid(mine)}
            </section>
          )}
          {shared.length > 0 && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-content-muted mb-3 flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" /> Shared with me ({shared.length})
              </h3>
              {renderGrid(shared)}
            </section>
          )}
          {publicPlaylists.length > 0 && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-content-muted mb-3 flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5" /> Public Playlists ({publicPlaylists.length})
              </h3>
              {renderGrid(publicPlaylists as unknown as StorePlaylist[])}
            </section>
          )}
        </div>
      )}
      {newModal && (
        <Modal title="New playlist" onClose={() => setNewModal(false)}
          footer={<Button variant="primary" size="sm" onClick={doCreate}>Create</Button>}>
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