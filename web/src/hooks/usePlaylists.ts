import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { playlistsApi } from "../api/endpoints";
import type { FileItem, PlaylistItem, Playlist as ApiPlaylist } from "../api/types";
import { usePlayer } from "../store/player";

// Re-export Playlist type expected by UI. Backend returns PlaylistItem[] but UI treats items as FileItem[].
// Keep the same shape as the Zustand store for compatibility.
export interface Playlist extends Omit<ApiPlaylist, "items"> {
  items: FileItem[];
}

interface AddResult {
  added: number;
  skipped: number;
}

const PLAYLISTS_KEY = ["playlists"] as const;
const PUBLIC_PLAYLISTS_KEY = ["playlists", "public"] as const;

/**
 * Fetch private / shared playlists for the current user.
 * Query key: ["playlists"]
 */
export function usePlaylists() {
  return useQuery({
    queryKey: PLAYLISTS_KEY,
    queryFn: () => playlistsApi.list(),
    staleTime: 30_000,
    // Keep raw shape so callers can do data.items; also provide a convenience selector for array.
    // No select here to preserve {items: Playlist[]} so existing code using data.items continues to work.
  });
}

/**
 * Convenience hook that returns the playlists array directly.
 * Useful for components that only need the list.
 */
export function usePlaylistsList() {
  return useQuery({
    queryKey: PLAYLISTS_KEY,
    queryFn: () => playlistsApi.list(),
    staleTime: 30_000,
    select: (data) => data.items ?? [],
  });
}

/**
 * Fetch public playlists from all users.
 * Query key: ["playlists", "public"]
 */
export function usePublicPlaylists() {
  return useQuery({
    queryKey: PUBLIC_PLAYLISTS_KEY,
    queryFn: () => playlistsApi.listPublic(),
    staleTime: 60_000,
  });
}

/**
 * Create a new playlist.
 * Invalidates ["playlists"] and ["playlists","public"] on success.
 */
export function useCreatePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, items }: { name: string; items: FileItem[] }) => {
      const plItems = items.map((i) => ({ root_id: i.root_id, path: i.path } as PlaylistItem));
      const pl = await playlistsApi.create({ name: name.trim() || "New playlist", items: plItems });
      return pl as unknown as Playlist;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PLAYLISTS_KEY });
      qc.invalidateQueries({ queryKey: PUBLIC_PLAYLISTS_KEY });
    },
  });
}

/**
 * Delete a playlist by id.
 */
export function useDeletePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await playlistsApi.delete(id);
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PLAYLISTS_KEY });
      qc.invalidateQueries({ queryKey: PUBLIC_PLAYLISTS_KEY });
    },
  });
}

/**
 * Rename a playlist. Includes optimistic update for better UX.
 */
export function useRenamePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      await playlistsApi.rename(id, name);
      return { id, name };
    },
    onMutate: async ({ id, name }) => {
      await qc.cancelQueries({ queryKey: PLAYLISTS_KEY });
      const prev = qc.getQueryData<{ items: Playlist[] }>(PLAYLISTS_KEY);
      if (prev) {
        qc.setQueryData<{ items: Playlist[] }>(PLAYLISTS_KEY, {
          ...prev,
          items: prev.items.map((p) => (p.id === id ? { ...p, name } : p)),
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(PLAYLISTS_KEY, ctx.prev);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PLAYLISTS_KEY });
      qc.invalidateQueries({ queryKey: PUBLIC_PLAYLISTS_KEY });
    },
  });
}

/**
 * Add items to a playlist. Returns {added, skipped}.
 * Optimistically deduplicates on the client, then invalidates.
 */
export function useAddPlaylistItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, items }: { id: string; items: FileItem[] }) => {
      const plItems = items.map((i) => ({ root_id: i.root_id, path: i.path } as PlaylistItem));
      const res = await playlistsApi.addItems(id, plItems);
      return { added: res.added ?? items.length, skipped: res.skipped ?? 0 } as AddResult;
    },
    onMutate: async ({ id, items }) => {
      await qc.cancelQueries({ queryKey: PLAYLISTS_KEY });
      const prev = qc.getQueryData<{ items: Playlist[] }>(PLAYLISTS_KEY);
      if (prev) {
        qc.setQueryData<{ items: Playlist[] }>(PLAYLISTS_KEY, {
          ...prev,
          items: prev.items.map((p) => {
            if (p.id !== id) return p;
            const existing = new Set(p.items.map((i) => `${i.root_id}:${i.path}`));
            const added = items.filter((i) => !existing.has(`${i.root_id}:${i.path}`));
            return { ...p, items: [...p.items, ...added] as FileItem[] };
          }),
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(PLAYLISTS_KEY, ctx.prev);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PLAYLISTS_KEY });
      qc.invalidateQueries({ queryKey: PUBLIC_PLAYLISTS_KEY });
    },
  });
}

/**
 * Remove a single item from a playlist by server item id.
 * The PlaylistsPanel previously passed path and resolved id client-side; this hook expects the server item id.
 * For backward compat, if itemId is missing and path is provided, caller should resolve id before calling.
 */
export function useRemovePlaylistItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ playlistId, itemId }: { playlistId: string; itemId: string }) => {
      await playlistsApi.removeItem(playlistId, itemId);
      return { playlistId, itemId };
    },
    onMutate: async ({ playlistId, itemId }) => {
      await qc.cancelQueries({ queryKey: PLAYLISTS_KEY });
      const prev = qc.getQueryData<{ items: Playlist[] }>(PLAYLISTS_KEY);
      if (prev) {
        qc.setQueryData<{ items: Playlist[] }>(PLAYLISTS_KEY, {
          ...prev,
          items: prev.items.map((p) => {
            if (p.id !== playlistId) return p;
            return { ...p, items: p.items.filter((it: any) => it.id !== itemId && it.path !== itemId) };
          }),
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(PLAYLISTS_KEY, ctx.prev);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PLAYLISTS_KEY });
      qc.invalidateQueries({ queryKey: PUBLIC_PLAYLISTS_KEY });
    },
  });
}

// ── Additional helpers matching the Zustand store's extra actions ──

export function useSetPlaylistCover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, coverRootId, coverPath }: { id: string; coverRootId: string; coverPath: string }) => {
      await playlistsApi.update(id, { cover_root_id: coverRootId, cover_path: coverPath });
      return { id, coverRootId, coverPath };
    },
    onMutate: async ({ id, coverRootId, coverPath }) => {
      await qc.cancelQueries({ queryKey: PLAYLISTS_KEY });
      const prev = qc.getQueryData<{ items: Playlist[] }>(PLAYLISTS_KEY);
      if (prev) {
        qc.setQueryData<{ items: Playlist[] }>(PLAYLISTS_KEY, {
          ...prev,
          items: prev.items.map((p) => (p.id === id ? { ...p, cover_root_id: coverRootId, cover_path: coverPath } : p)),
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(PLAYLISTS_KEY, ctx.prev);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PLAYLISTS_KEY });
      qc.invalidateQueries({ queryKey: PUBLIC_PLAYLISTS_KEY });
    },
  });
}

export function useSetPlaylistPublic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isPublic }: { id: string; isPublic: boolean }) => {
      await playlistsApi.update(id, { is_public: isPublic });
      return { id, isPublic };
    },
    onMutate: async ({ id, isPublic }) => {
      await qc.cancelQueries({ queryKey: PLAYLISTS_KEY });
      const prev = qc.getQueryData<{ items: Playlist[] }>(PLAYLISTS_KEY);
      if (prev) {
        qc.setQueryData<{ items: Playlist[] }>(PLAYLISTS_KEY, {
          ...prev,
          items: prev.items.map((p) => (p.id === id ? { ...p, is_public: isPublic } : p)),
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(PLAYLISTS_KEY, ctx.prev);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PLAYLISTS_KEY });
      qc.invalidateQueries({ queryKey: PUBLIC_PLAYLISTS_KEY });
    },
  });
}

export function usePlaylistCollaborators(playlistId: string) {
  return useQuery({
    queryKey: ["playlists", playlistId, "collaborators"],
    queryFn: () => playlistsApi.listCollaborators(playlistId),
    enabled: !!playlistId,
  });
}

export function useAddCollaborator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, userId, role }: { id: string; userId: string; role: string }) => {
      const res = await playlistsApi.manageCollaborators(id, {
        action: "add",
        user_id: userId,
        role,
      });
      return { id, collaborators: res.collaborators || [] };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["playlists", data.id, "collaborators"] });
      qc.invalidateQueries({ queryKey: PLAYLISTS_KEY });
    },
  });
}

export function useRemoveCollaborator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, userId }: { id: string; userId: string }) => {
      const res = await playlistsApi.manageCollaborators(id, {
        action: "remove",
        user_id: userId,
      });
      return { id, collaborators: res.collaborators || [] };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["playlists", data.id, "collaborators"] });
      qc.invalidateQueries({ queryKey: PLAYLISTS_KEY });
    },
  });
}

// Playback helpers that were previously on the Zustand store.
export function usePlaylistPlayback(playlists: Playlist[] | undefined) {
  const list = playlists ?? [];
  const play = (id: string) => {
    const pl = list.find((p) => p.id === id);
    if (pl?.items.length) usePlayer.getState().play(pl.items as FileItem[], 0);
  };
  const playFrom = (id: string, index: number) => {
    const pl = list.find((p) => p.id === id);
    if (pl?.items.length) usePlayer.getState().play(pl.items as FileItem[], Math.max(0, Math.min(index, pl.items.length - 1)));
  };
  return { play, playFrom };
}

// Query key exports for external invalidation/prefetch
export const playlistsKeys = {
  all: PLAYLISTS_KEY,
  public: PUBLIC_PLAYLISTS_KEY,
} as const;
