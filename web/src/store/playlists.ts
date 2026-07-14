import { create } from "zustand";
import type { FileItem } from "../api/types";
import { usePlayer } from "./player";

export interface Playlist {
  id: string;
  name: string;
  items: FileItem[];
}

const LS_KEY = "nexora.playlists";

function load(): Playlist[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as Playlist[];
  } catch { /* ignore */ }
  return [];
}

function save(list: Playlist[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

interface PlaylistsState {
  playlists: Playlist[];
  create: (name: string, items: FileItem[]) => Playlist;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
  addItems: (id: string, items: FileItem[]) => void;
  removeItem: (id: string, path: string) => void;
  play: (id: string) => void;
  playFrom: (id: string, index: number) => void;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export const usePlaylists = create<PlaylistsState>((set, get) => ({
  playlists: load(),
  create: (name, items) => {
    const pl: Playlist = { id: uid(), name: name.trim() || "New playlist", items: items.map((i) => ({ ...i })) };
    const next = [...get().playlists, pl];
    set({ playlists: next });
    save(next);
    return pl;
  },
  remove: (id) => {
    const next = get().playlists.filter((p) => p.id !== id);
    set({ playlists: next });
    save(next);
  },
  rename: (id, name) => {
    const next = get().playlists.map((p) => (p.id === id ? { ...p, name } : p));
    set({ playlists: next });
    save(next);
  },
  addItems: (id, items) => {
    const next = get().playlists.map((p) => {
      if (p.id !== id) return p;
      const existing = new Set(p.items.map((i) => i.path));
      const added = items.filter((i) => !existing.has(i.path)).map((i) => ({ ...i }));
      return { ...p, items: [...p.items, ...added] };
    });
    set({ playlists: next });
    save(next);
  },
  removeItem: (id, path) => {
    const next = get().playlists.map((p) =>
      p.id === id ? { ...p, items: p.items.filter((i) => i.path !== path) } : p
    );
    set({ playlists: next });
    save(next);
  },
  play: (id) => {
    const pl = get().playlists.find((p) => p.id === id);
    if (pl && pl.items.length) usePlayer.getState().play(pl.items, 0);
  },
  playFrom: (id, index) => {
    const pl = get().playlists.find((p) => p.id === id);
    if (pl && pl.items.length) usePlayer.getState().play(pl.items, Math.max(0, Math.min(index, pl.items.length - 1)));
  },
}));
