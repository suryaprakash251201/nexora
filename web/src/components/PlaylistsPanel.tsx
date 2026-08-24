import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  ListMusic, Play, Pencil, Trash2, Plus, X, Music, ArrowLeft, Download, Share2,
  Users, UserPlus, Search, MoreVertical, Image as ImageIcon, Globe, Lock,
  Shuffle, LayoutGrid, Rows3, GripVertical,
} from "lucide-react";
import { usePlayer } from "../store/player";
import { useUI } from "../store";
import { startDownload } from "../lib/transfer";
import { cleanTrackTitle } from "@nexora/core";
import { Modal } from "./Modal";
import { Button } from "./ui/Button";
import { ViewHeader } from "./ui/ViewHeader";
import CoverPickerModal from "./CoverPickerModal";
import ShareDialog from "./ShareDialog";
import type { User } from "../api/types";
import { usersApi } from "../api/endpoints";
import CreatePlaylistModal from "./playlists/CreatePlaylistModal";
import PlaylistCard, { PlaylistCardSkeleton, PlaylistArtwork } from "./playlists/PlaylistCard";
import { EqualizerBars } from "./LosslessPlayer";
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
  useSetPlaylistDescription,
  useReorderPlaylistItems,
  usePlaylistCollaborators,
  useAddCollaborator,
  useRemoveCollaborator,
  type Playlist as StorePlaylist,
} from "../hooks/usePlaylists";

type ViewMode = "grid" | "list";

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
        aria-label="More playlist options"
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
            {searching && <Search className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 animate-pulse text-content-muted" />}
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

// ── Draggable track row ────────────────────────────────────────────────────
function TrackRow({
  item,
  index,
  nowPlaying,
  isPlaying,
  canEdit,
  draggable,
  onPlay,
  onDownload,
  onShare,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  dropSide,
}: any) {
  const clean = cleanTrackTitle(item.name || "");
  return (
    <div
      data-testid="playlist-track-row"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`group relative flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors duration-150 border-b border-border/20 last:border-0 ${
        nowPlaying ? "bg-accent/[0.08]" : "hover:bg-accent/[0.04]"
      } ${dropSide === "above" ? "shadow-[inset_0_2px_0_0_var(--color-accent)]" : ""} ${
        dropSide === "below" ? "shadow-[inset_0_-2px_0_0_var(--color-accent)]" : ""
      }`}
      onClick={onPlay}
      role="button"
      tabIndex={0}
      onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") onPlay(); }}
      aria-label={`Play ${clean}`}
    >
      {draggable && (
        <span
          className="hidden md:block absolute left-0.5 top-1/2 -translate-y-1/2 cursor-grab opacity-0 group-hover:opacity-40 hover:!opacity-90 text-content-muted"
          title="Drag to reorder"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
      )}
      <span className={`w-8 grid place-items-center shrink-0 ${nowPlaying ? "text-accent" : "text-content-muted/60"}`}>
        {nowPlaying && isPlaying ? (
          <EqualizerBars analyser={null} isPlaying bars={3} className="h-3.5 w-5" barClassName="bg-accent" />
        ) : (
          <span className={`text-xs font-mono tabular-nums ${nowPlaying ? "text-accent font-bold" : ""}`}>{index + 1}</span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm truncate ${nowPlaying ? "font-semibold text-accent" : "font-medium"}`}>{clean}</p>
        <p className="text-[11px] text-content-muted/70 truncate">{item.path}</p>
      </div>
      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onDownload(); }}
          className="p-1.5 rounded-lg glass-hover text-content-muted hover:text-accent"
          title="Download track"
        >
          <Download className="h-4 w-4" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onShare(); }}
          className="p-1.5 rounded-lg glass-hover text-content-muted hover:text-accent"
          title="Share track"
        >
          <Share2 className="h-4 w-4" />
        </button>
        {canEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="p-1.5 rounded-lg glass-hover text-content-muted hover:text-red-500"
            title="Remove from playlist"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export default function PlaylistsPanel({ user }: { user?: User }) {
  const { data: playlistsData, isLoading } = usePlaylists();
  const playlists = playlistsData?.items ?? [];
  const { data: publicData } = usePublicPlaylists();
  const createMutation = useCreatePlaylist();
  const deleteMutation = useDeletePlaylist();
  const renameMutation = useRenamePlaylist();
  const addItemsMutation = useAddPlaylistItems();
  const removeItemMutation = useRemovePlaylistItem();
  const setCoverMutation = useSetPlaylistCover();
  const setPublicMutation = useSetPlaylistPublic();
  const setDescriptionMutation = useSetPlaylistDescription();
  const reorderMutation = useReorderPlaylistItems();

  const current = usePlayer((s) => s.current());
  const isPlaying = usePlayer((s) => s.isPlaying);
  const pushToast = useUI((s) => s.pushToast);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    ((localStorage.getItem("nx-playlists-view") as ViewMode) || "grid"));
  const [createModal, setCreateModal] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [coverModal, setCoverModal] = useState<{ id: string } | null>(null);
  const [collabModal, setCollabModal] = useState(false);
  const [shareTarget, setShareTarget] = useState<{ item: any; rootId: string } | null>(null);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");

  // Drag-and-drop state (indices of rows being reordered)
  const dragIndex = useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ index: number; side: "above" | "below" } | null>(null);

  useEffect(() => {
    localStorage.setItem("nx-playlists-view", viewMode);
  }, [viewMode]);

  const selected = selectedId ? playlists.find((p) => p.id === selectedId) : null;
  const canEditSelected = !!selected && (selected.is_owner || selected.can_edit);
  const isOwnerSelected = !!selected && !!selected.is_owner;

  const publicPlaylists = useMemo(() => {
    const list = publicData?.items || [];
    const ownedIds = new Set(playlists.map((p) => p.id));
    return list.filter((p) => !ownedIds.has(p.id));
  }, [publicData, playlists]);

  // ── Playback ──
  const playFrom = useCallback((id: string, index: number) => {
    const pl = playlists.find((p) => p.id === id);
    if (!pl?.items.length) return;
    usePlayer.getState().setShuffle(false);
    usePlayer.getState().play(pl.items as any, Math.max(0, Math.min(index, pl.items.length - 1)));
  }, [playlists]);

  const shufflePlay = useCallback((id: string) => {
    const pl = playlists.find((p) => p.id === id);
    if (!pl?.items.length) return;
    usePlayer.getState().setShuffle(true);
    const start = Math.floor(Math.random() * pl.items.length);
    usePlayer.getState().play(pl.items as any, start);
  }, [playlists]);

  // ── CRUD helpers ──
  const handleCreate = async ({ name, description, coverRootId, coverPath }: { name: string; description: string; coverRootId?: string; coverPath?: string }) => {
    const pl = await createMutation.mutateAsync({ name, description, items: [] });
    if (coverRootId && coverPath) {
      await setCoverMutation.mutateAsync({ id: pl.id, coverRootId, coverPath }).catch(() => {});
    }
    setSelectedId(pl.id);
    return { id: pl.id, name: pl.name };
  };

  const removeItem = (playlistId: string, itemId: string) => removeItemMutation.mutateAsync({ playlistId, itemId });

  const addCurrent = async (id: string) => {
    if (!current) {
      pushToast("info", "Nothing is playing right now");
      return;
    }
    try {
      const result = await addItemsMutation.mutateAsync({ id, items: [current as any] });
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

  // ── Drag & drop reorder (optimistic, server persists full ordering) ──
  const commitReorder = (from: number, toInsertBefore: number) => {
    if (!selected) return;
    const items = [...(selected.items as any[])];
    if (from === toInsertBefore || from + 1 === toInsertBefore) return; // no-op move
    const [moved] = items.splice(from, 1);
    const insertAt = toInsertBefore > from ? toInsertBefore - 1 : toInsertBefore;
    items.splice(insertAt, 0, moved);
    reorderMutation.mutateAsync({ id: selected.id, orderedItems: items }).catch(() => {
      pushToast("error", "Couldn't save the new order");
    });
  };

  const doTogglePublic = (id: string, currentState: boolean) => {
    setPublicMutation.mutateAsync({ id, isPublic: !currentState })
      .then(() => pushToast("success", !currentState ? "Playlist is now public" : "Playlist is now private"))
      .catch(() => pushToast("error", "Failed to update visibility"));
  };

  // Group into "My Playlists" / "Shared with me" (must run before any early return).
  const { mine, shared } = useMemo(() => {
    const mine: StorePlaylist[] = [];
    const shared: StorePlaylist[] = [];
    for (const p of playlists as unknown as StorePlaylist[]) {
      if (p.is_owner) mine.push(p);
      else shared.push(p);
    }
    return { mine, shared };
  }, [playlists]);

  // ── Detail view ──────────────────────────────────────────────────────────
  if (selected) {
    const items = selected.items as any[];
    const currentPath = current?.path;
    return (
      <div className="flex-1 overflow-auto p-4 pb-24 md:pb-20">
        <button onClick={() => setSelectedId(null)} className="flex items-center gap-1.5 text-sm text-content-muted hover:text-content transition-colors mb-4">
          <ArrowLeft className="h-4 w-4" /> All Playlists
        </button>

        {/* Header */}
        <div className="flex flex-col md:flex-row gap-6 mb-8">
          <div className="w-full max-w-[240px] md:w-56 lg:w-64 mx-auto md:mx-0 shrink-0">
            <div className="aspect-square rounded-2xl overflow-hidden shadow-xl ring-1 ring-white/10">
              <PlaylistArtwork playlist={selected} />
            </div>
          </div>
          <div className="flex-1 min-w-0 flex flex-col justify-end">
            <p className="text-[11px] font-bold uppercase tracking-widest text-content-muted mb-1">Playlist</p>
            <h1 className="text-2xl md:text-3xl font-extrabold break-words">{selected.name}</h1>

            {/* Description with inline edit */}
            {canEditSelected && editingDesc ? (
              <div className="mt-2 space-y-2 max-w-xl">
                <textarea
                  autoFocus
                  rows={2}
                  value={descDraft}
                  maxLength={2000}
                  onChange={(e) => setDescDraft(e.target.value)}
                  placeholder="Add a description…"
                  className="w-full rounded-lg glass-input px-3 py-2 outline-none text-sm resize-none"
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => {
                    setDescriptionMutation.mutateAsync({ id: selected.id, description: descDraft.trim() })
                      .then(() => setEditingDesc(false))
                      .catch(() => pushToast("error", "Failed to update description"));
                  }}>Save</Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditingDesc(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <button
                disabled={!canEditSelected}
                onClick={() => { setDescDraft(selected.description || ""); setEditingDesc(true); }}
                className={`mt-2 text-left text-sm max-w-xl ${canEditSelected ? "text-content-muted hover:text-content transition-colors" : "text-content-muted"} ${!selected.description && canEditSelected ? "italic opacity-60" : ""}`}
                title={canEditSelected ? "Click to edit description" : undefined}
              >
                {selected.description || (canEditSelected ? "Add a description…" : "")}
              </button>
            )}

            <div className="flex items-center gap-2 mt-3 text-sm text-content-muted flex-wrap">
              <span>{items.length} track{items.length === 1 ? "" : "s"}</span>
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
              <Button variant="primary" onClick={() => playFrom(selected.id, 0)} disabled={!items.length}>
                <Play className="h-4 w-4" /> Play All
              </Button>
              <Button variant="secondary" onClick={() => shufflePlay(selected.id)} disabled={!items.length}>
                <Shuffle className="h-4 w-4" /> Shuffle
              </Button>
              <button
                onClick={() => addCurrent(selected.id)}
                disabled={!current || !canEditSelected}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl glass-hover border border-border/50 text-sm font-medium disabled:opacity-40"
                title={!canEditSelected ? "Only owners and editors can add tracks" : "Add the currently playing track"}
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
                  onSetCover={() => setCoverModal({ id: selected.id })}
                  onTogglePublic={() => doTogglePublic(selected.id, selected.is_public)}
                  onRename={() => setRenameTarget({ id: selected.id, name: selected.name })}
                  onDelete={() => setDeleteTarget({ id: selected.id, name: selected.name })}
                />
              )}
            </div>
          </div>
        </div>

        {/* Track list */}
        {items.length === 0 ? (
          <div className="text-center text-content-muted py-16 glass rounded-2xl">
            <div className="h-16 w-16 mx-auto mb-4 rounded-2xl bg-accent/10 grid place-items-center">
              <Music className="h-8 w-8 text-accent" />
            </div>
            <p className="font-medium">No songs yet</p>
            <p className="text-sm mt-1">Add audio files from your Nexora files to start building this playlist.</p>
          </div>
        ) : (
          <div className="glass rounded-2xl overflow-hidden border border-border/30" role="list" aria-label={`${selected.name} tracks`}>
            {items.map((it, i) => {
              const nowPlaying = currentPath === it.path;
              return (
                <TrackRow
                  key={it.path + i}
                  item={it}
                  index={i}
                  nowPlaying={nowPlaying}
                  isPlaying={isPlaying}
                  canEdit={canEditSelected}
                  draggable={canEditSelected}
                  dropSide={dropTarget?.index === i ? dropTarget.side : null}
                  onPlay={() => playFrom(selected.id, i)}
                  onDownload={() => startDownload(it.root_id, it.path, it.name)}
                  onShare={() => setShareTarget({ item: { ...it, is_dir: false }, rootId: it.root_id })}
                  onRemove={() => {
                    if (!it.id) {
                      pushToast("error", "Cannot remove item without its server ID");
                      return;
                    }
                    removeItem(selected.id, it.id)
                      .then(() => pushToast("info", "Track removed"))
                      .catch(() => pushToast("error", "Failed to remove track"));
                  }}
                  onDragStart={(e: React.DragEvent) => {
                    dragIndex.current = i;
                    e.dataTransfer.effectAllowed = "move";
                    try { e.dataTransfer.setData("text/plain", String(i)); } catch {}
                  }}
                  onDragOver={(e: React.DragEvent) => {
                    if (dragIndex.current === null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setDropTarget({ index: i, side: e.clientY < rect.top + rect.height / 2 ? "above" : "below" });
                  }}
                  onDrop={(e: React.DragEvent) => {
                    e.preventDefault();
                    if (dragIndex.current !== null && dropTarget) commitReorder(dragIndex.current, dropTarget.index + (dropTarget.side === "below" ? 1 : 0));
                    dragIndex.current = null;
                    setDropTarget(null);
                  }}
                  onDragEnd={() => { dragIndex.current = null; setDropTarget(null); }}
                />
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
            footer={<Button variant="primary" size="sm" onClick={() => {
              if (renameTarget.name.trim()) {
                renameMutation.mutateAsync({ id: renameTarget.id, name: renameTarget.name.trim() })
                  .catch(() => pushToast("error", "Failed to rename playlist"));
              }
              setRenameTarget(null);
            }}>Rename</Button>}>
            <input
              autoFocus
              value={renameTarget.name}
              onChange={(e) => setRenameTarget({ ...renameTarget, name: e.target.value })}
              className="w-full rounded-lg glass-input px-3 py-2 outline-none text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (renameTarget.name.trim()) {
                    renameMutation.mutateAsync({ id: renameTarget.id, name: renameTarget.name.trim() })
                      .catch(() => pushToast("error", "Failed to rename playlist"));
                  }
                  setRenameTarget(null);
                }
              }}
            />
          </Modal>
        )}
        {deleteTarget && (
          <Modal title="Delete playlist" onClose={() => setDeleteTarget(null)}
            description={`Are you sure you want to delete "${deleteTarget.name}"?`}
            footer={
              <>
                <button onClick={() => setDeleteTarget(null)} className="px-3 py-1.5 rounded-lg glass-hover text-sm font-medium">Cancel</button>
                <button
                  onClick={() => {
                    deleteMutation.mutateAsync(deleteTarget.id)
                      .then(() => pushToast("info", "Playlist deleted"))
                      .catch(() => pushToast("error", "Failed to delete playlist"));
                    setDeleteTarget(null);
                    setSelectedId(null);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-danger text-white text-sm font-medium"
                >
                  Delete
                </button>
              </>
            }>
            <></>
          </Modal>
        )}
        {coverModal && (
          <CoverPickerModal
            onClose={() => setCoverModal(null)}
            onConfirm={(rootId, path) => {
              setCoverMutation.mutateAsync({ id: coverModal.id, coverRootId: rootId, coverPath: path })
                .then(() => pushToast("success", "Cover image updated"))
                .catch(() => pushToast("error", "Failed to update cover"));
              setCoverModal(null);
            }}
          />
        )}
      </div>
    );
  }

  // ── Library view ─────────────────────────────────────────────────────────
  const renderSection = (title: string, icon: React.ReactNode, list: StorePlaylist[], context: "library" | "public" = "library") => {
    if (!list.length) return null;
    return (
      <section>
        <h3 className="text-xs font-bold uppercase tracking-wider text-content-muted mb-3 flex items-center gap-1.5">
          {icon} {title} ({list.length})
        </h3>
        {viewMode === "grid" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {list.map((pl) => (
              <PlaylistCard key={pl.id} playlist={pl} variant="grid" context={context} onOpen={() => setSelectedId(pl.id)} onPlay={() => playFrom(pl.id, 0)} />
            ))}
          </div>
        ) : (
          <div className="glass rounded-2xl border border-border/30 divide-y divide-border/20 overflow-hidden py-1">
            {list.map((pl) => (
              <PlaylistCard key={pl.id} playlist={pl} variant="list" context={context} onOpen={() => setSelectedId(pl.id)} onPlay={() => playFrom(pl.id, 0)} />
            ))}
          </div>
        )}
      </section>
    );
  };

  const viewToggle = (
    <div className="flex items-center rounded-xl border border-border/50 overflow-hidden" role="group" aria-label="View mode">
      <button
        onClick={() => setViewMode("grid")}
        aria-pressed={viewMode === "grid"}
        title="Grid view"
        className={`px-2.5 py-2 transition-colors ${viewMode === "grid" ? "bg-accent/15 text-accent" : "text-content-muted hover:text-content hover:bg-accent/5"}`}
      >
        <LayoutGrid className="h-4 w-4" />
      </button>
      <button
        onClick={() => setViewMode("list")}
        aria-pressed={viewMode === "list"}
        title="List view"
        className={`px-2.5 py-2 transition-colors ${viewMode === "list" ? "bg-accent/15 text-accent" : "text-content-muted hover:text-content hover:bg-accent/5"}`}
      >
        <Rows3 className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <div className="flex-1 overflow-auto p-4 pb-24 md:pb-20">
      <ViewHeader
        icon={ListMusic}
        title="Playlists"
        subtitle={isLoading ? "Loading…" : `${playlists.length} playlist${playlists.length === 1 ? "" : "s"}`}
        actions={
          <div className="flex items-center gap-2">
            {viewToggle}
            <Button variant="primary" onClick={() => setCreateModal(true)}>
              <Plus className="h-4 w-4" /> New Playlist
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {Array.from({ length: 12 }).map((_, i) => <PlaylistCardSkeleton key={i} />)}
        </div>
      ) : playlists.length === 0 ? (
        <div className="text-center text-content-muted p-12 glass rounded-2xl">
          <div className="h-16 w-16 mx-auto mb-4 rounded-2xl bg-accent/10 grid place-items-center">
            <ListMusic className="h-8 w-8 text-accent" />
          </div>
          <p className="mb-1 font-semibold text-content">No playlists yet</p>
          <p className="text-sm max-w-md mx-auto">
            Create your first playlist, or select audio files in the Files view and choose “Add to playlist”.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="primary" onClick={() => setCreateModal(true)}>
              <Plus className="h-4 w-4" /> Create Playlist
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {renderSection("My Playlists", <ListMusic className="h-3.5 w-3.5" />, mine)}
          {renderSection("Shared with me", <Users className="h-3.5 w-3.5" />, shared)}
          {renderSection("Public Playlists", <Globe className="h-3.5 w-3.5" />, publicPlaylists as unknown as StorePlaylist[], "public")}
        </div>
      )}

      {createModal && (
        <CreatePlaylistModal
          onClose={() => setCreateModal(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}
