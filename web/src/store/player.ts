import { create } from "zustand";
import type { FileItem } from "../api/types";
import { rawUrl } from "../lib/preview";

export type Repeat = "off" | "all" | "one";

interface PlayerState {
  queue: FileItem[];
  index: number;
  isPlaying: boolean;
  shuffle: boolean;
  repeat: Repeat;
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number;
  muted: boolean;
  primaryOpen: boolean;
  play: (queue: FileItem[], index?: number) => void;
  toggle: () => void;
  next: (auto?: boolean) => void;
  prev: () => void;
  setIndex: (i: number) => void;
  seek: (t: number) => void;
  setVolume: (v: number) => void;
  setPlaybackRate: (r: number) => void;
  toggleMute: () => void;
  setPrimaryOpen: (b: boolean) => void;
  setShuffle: (s: boolean) => void;
  cycleRepeat: () => void;
  current: () => FileItem | null;
  _syncTime: (c: number, d: number) => void;
}

const LS_KEY = "nexora.player";

interface Persist {
  queue: FileItem[];
  index: number;
  volume: number;
  shuffle: boolean;
  repeat: Repeat;
  playbackRate: number;
}

function loadPersist(): Persist {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as Persist;
  } catch { /* ignore */ }
  return { queue: [], index: -1, volume: 1, shuffle: false, repeat: "off", playbackRate: 1 };
}

function savePersist(p: Persist) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

// PlayerEngine owns the single <audio> element so playback survives navigation.
class PlayerEngine {
  audio: HTMLAudioElement | null = null;
  bind(el: HTMLAudioElement) {
    this.audio = el;
    el.volume = usePlayer.getState().volume;
    el.playbackRate = usePlayer.getState().playbackRate;
    el.addEventListener("play", () => usePlayer.setState({ isPlaying: true }));
    el.addEventListener("pause", () => usePlayer.setState({ isPlaying: false }));
    el.addEventListener("timeupdate", () => usePlayer.getState()._syncTime(el.currentTime, el.duration));
    el.addEventListener("loadedmetadata", () => usePlayer.getState()._syncTime(el.currentTime, el.duration));
    el.addEventListener("ended", () => usePlayer.getState().next(true));
  }
  play() { this.audio?.play().catch(() => {}); }
  pause() { this.audio?.pause(); }
  toggle() { if (this.audio?.paused) this.play(); else this.pause(); }
  seek(t: number) { if (this.audio) this.audio.currentTime = t; }
  setVolume(v: number) { if (this.audio) { this.audio.volume = v; this.audio.muted = false; } }
  setMuted(m: boolean) { if (this.audio) this.audio.muted = m; }
  setPlaybackRate(r: number) { if (this.audio) this.audio.playbackRate = r; }
}

export const engine = new PlayerEngine();

const persisted = loadPersist();

export const usePlayer = create<PlayerState>((set, get) => ({
  queue: persisted.queue,
  index: persisted.index,
  isPlaying: false,
  shuffle: persisted.shuffle,
  repeat: persisted.repeat,
  currentTime: 0,
  duration: 0,
  volume: persisted.volume,
  playbackRate: persisted.playbackRate || 1,
  muted: false,
  primaryOpen: false,

  current: () => {
    const { queue, index } = get();
    return index >= 0 && index < queue.length ? queue[index] : null;
  },

  play: (queue, index = 0) => {
    if (!queue.length) return;
    set({ queue, index: Math.max(0, Math.min(index, queue.length - 1)), isPlaying: true, currentTime: 0, duration: 0 });
    persist();
  },

  toggle: () => engine.toggle(),

  next: (auto = false) => {
    const { queue, index, shuffle, repeat } = get();
    if (queue.length === 0) return;
    if (auto && repeat === "one") { engine.seek(0); engine.play(); return; }
    let ni: number;
    if (shuffle) ni = Math.floor(Math.random() * queue.length);
    else ni = index + 1;
    if (ni >= queue.length) {
      if (repeat === "all" || !auto) ni = 0;
      else { set({ isPlaying: false }); return; }
    }
    set({ index: ni, currentTime: 0, isPlaying: true });
    persist();
  },

  prev: () => {
    const { queue, index, currentTime } = get();
    if (queue.length === 0) return;
    if (engine.audio && currentTime > 3) { engine.seek(0); return; }
    let pi = index - 1;
    if (pi < 0) pi = queue.length - 1;
    set({ index: pi, currentTime: 0, isPlaying: true });
    persist();
  },

  setIndex: (i) => { set({ index: i, currentTime: 0, isPlaying: true }); persist(); },

  seek: (t) => engine.seek(t),

  setVolume: (v) => {
    const vol = Math.max(0, Math.min(1, v));
    engine.setVolume(vol);
    set({ volume: vol, muted: vol === 0 });
    persist();
  },

  setPlaybackRate: (r) => {
    engine.setPlaybackRate(r);
    set({ playbackRate: r });
    persist();
  },

  toggleMute: () => {
    const m = !get().muted;
    engine.setMuted(m);
    set({ muted: m });
  },

  setPrimaryOpen: (b) => set({ primaryOpen: b }),

  setShuffle: (s) => { set({ shuffle: s }); persist(); },

  cycleRepeat: () => {
    const order: Repeat[] = ["off", "all", "one"];
    const nextR = order[(order.indexOf(get().repeat) + 1) % order.length];
    set({ repeat: nextR });
    persist();
  },

  _syncTime: (c, d) => set({ currentTime: c, duration: isFinite(d) ? d : 0 }),
}));

function persist() {
  const s = usePlayer.getState();
  savePersist({ queue: s.queue, index: s.index, volume: s.volume, shuffle: s.shuffle, repeat: s.repeat, playbackRate: s.playbackRate });
}

export function currentAudioUrl(): string {
  const cur = usePlayer.getState().current();
  return cur ? rawUrl(cur.root_id, cur.path) : "";
}
