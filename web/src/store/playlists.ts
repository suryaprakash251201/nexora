import { create } from "zustand";
import type { FileItem, Playlist as ApiPlaylist, PlaylistItem } from "../api/types";
import { get, post, del, put, patch } from "../api/client";
import { usePlayer } from "./player";
import { useUI } from "../store";

// Extend the API playlist to match what the frontend UI expects (FileItem array).
// The backend returns partial FileItems in `items`, but we'll cast them.
export interface Playlist extends Omit<ApiPlaylist, "items"> {
  items: FileItem[];
}

interface AddResult {
  added: number;
  skipped: number;
}

interface PlaylistsState {
  playlists: Playlist[];
  loading: boolean;
  fetch: () => Promise<void>;
  create: (name: string, items: FileItem[]) => Promise<Playlist>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  addItems: (id: string, items: FileItem[]) => Promise<AddResult>;
  removeItem: (id: string, path: string) => Promise<void>;
  setCover: (id: string, coverRootId: string, coverPath: string) => Promise<void>;
  setPublic: (id: string, isPublic: boolean) => Promise<void>;
  play: (id: string) => void;
  playFrom: (id: string, index: number) => void;
}

export const usePlaylists = create<PlaylistsState>((set, getStore) => ({
  playlists: [],
  loading: false,

  fetch: async () => {
    set({ loading: true });
    try {
      const res = await get<{ items: Playlist[] }>("/playlists");
      set({ playlists: res.items || [] });
    } catch (e) {
      console.error("Failed to fetch playlists", e);
    } finally {
      set({ loading: false });
    }
  },

  create: async (name, items) => {
    const plItems = items.map((i) => ({ root_id: i.root_id, path: i.path } as PlaylistItem));
    const pl = await post<Playlist>("/playlists", { name: name.trim() || "New playlist", items: plItems });
    
    const next = [...getStore().playlists, pl];
    set({ playlists: next });
    return pl;
  },

  remove: async (id) => {
    const prev = getStore().playlists;
    set({ playlists: prev.filter((p) => p.id !== id) });
    try {
      await del(`/playlists/${id}`);
    } catch (e) {
      set({ playlists: prev });
      throw e;
    }
  },

  rename: async (id, name) => {
    const prev = getStore().playlists;
    set({ playlists: prev.map((p) => (p.id === id ? { ...p, name } : p)) });
    try {
      await put(`/playlists/${id}`, { name });
    } catch (e) {
      set({ playlists: prev });
      throw e;
    }
  },

  addItems: async (id, items) => {
    const plItems = items.map((i) => ({ root_id: i.root_id, path: i.path } as PlaylistItem));
    
    // Optimistic update with dedup
    const prev = getStore().playlists;
    set({
      playlists: prev.map((p) => {
        if (p.id !== id) return p;
        const existing = new Set(p.items.map((i) => `${i.root_id}:${i.path}`));
        const added = items.filter((i) => !existing.has(`${i.root_id}:${i.path}`));
        return { ...p, items: [...p.items, ...added] };
      }),
    });

    try {
      const res = await post<{ ok: boolean; added: number; skipped: number }>(`/playlists/${id}/items`, { items: plItems });
      // Re-fetch to get real item IDs from server
      await getStore().fetch();
      return { added: res.added ?? items.length, skipped: res.skipped ?? 0 };
    } catch (e) {
      set({ playlists: prev });
      throw e;
    }
  },

  removeItem: async (id, path) => {
    const pl = getStore().playlists.find((p) => p.id === id);
    if (!pl) return;
    
    const itemToRemove = pl.items.find((i) => i.path === path);
    const apiItemId = (itemToRemove as any)?.id;
    if (!apiItemId) {
      useUI.getState().pushToast("error", "Cannot remove item without its server ID");
      return;
    }

    const prev = getStore().playlists;
    set({
      playlists: prev.map((p) =>
        p.id === id ? { ...p, items: p.items.filter((i) => i.path !== path) } : p
      ),
    });

    try {
      await del(`/playlists/${id}/items`, { item_id: apiItemId });
    } catch (e) {
      set({ playlists: prev });
      throw e;
    }
  },

  setCover: async (id, coverRootId, coverPath) => {
    const prev = getStore().playlists;
    set({
      playlists: prev.map((p) =>
        p.id === id ? { ...p, cover_root_id: coverRootId, cover_path: coverPath } : p
      ),
    });
    try {
      await patch(`/playlists/${id}`, { cover_root_id: coverRootId, cover_path: coverPath });
    } catch (e) {
      set({ playlists: prev });
      throw e;
    }
  },

  setPublic: async (id, isPublic) => {
    const prev = getStore().playlists;
    set({
      playlists: prev.map((p) =>
        p.id === id ? { ...p, is_public: isPublic } : p
      ),
    });
    try {
      await patch(`/playlists/${id}`, { is_public: isPublic });
    } catch (e) {
      set({ playlists: prev });
      throw e;
    }
  },

  play: (id) => {
    const pl = getStore().playlists.find((p) => p.id === id);
    if (pl && pl.items.length) usePlayer.getState().play(pl.items, 0);
  },

  playFrom: (id, index) => {
    const pl = getStore().playlists.find((p) => p.id === id);
    if (pl && pl.items.length) usePlayer.getState().play(pl.items, Math.max(0, Math.min(index, pl.items.length - 1)));
  },
}));

// Auto-fetch on init
if (typeof window !== "undefined") {
  usePlaylists.getState().fetch().catch(() => {});
}
