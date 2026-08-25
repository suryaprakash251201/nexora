import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { Image } from "expo-image";
import type { FileItem } from "../api/types";
import { trackPlayerController, TrackPlayerController } from "../lib/trackPlayerController";
import { cleanTrackTitle } from "../lib/fileMeta";
import { useSession } from "./SessionContext";
import { useSettings } from "./SettingsContext";

type AudioContextType = {
  player: TrackPlayerController;
  currentTrack: FileItem | null;
  playlist: FileItem[];
  queueIndex: number;
  playTrack: (item: FileItem, playlist?: FileItem[]) => void;
  nextTrack: () => void;
  prevTrack: () => void;
  removeFromQueue: (item: FileItem) => void;
  /** Returns false when the track couldn't be queued (no API / resolve fail). */
  playNext: (item: FileItem) => Promise<boolean>;
  closePlayer: () => void;
  showPlayer: boolean;
  setShowPlayer: (s: boolean) => void;
  shuffle: boolean;
  setShuffle: (s: boolean) => void;
};

/** Stable session id per playback session (server kills stale ffmpeg on seek). */
function newSession(): string {
  const g = (globalThis as any)?.crypto;
  if (g && typeof g.randomUUID === "function") return g.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const AudioContext = createContext<AudioContextType | null>(null);

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const { api } = useSession();
  const [currentTrack, setCurrentTrack] = useState<FileItem | null>(null);
  const [playlist, setPlaylist] = useState<FileItem[]>([]);
  const [showPlayer, setShowPlayer] = useState(false);
  const [shuffle, setShuffle] = useState(false);

  // Audio runs on react-native-track-player (shared singleton controller):
  // background playback + a native media notification card (notification
  // center / lock screen / control center) with play, pause, next/previous
  // (forward/backward) and seek controls on both iOS and Android. The whole
  // playlist is loaded into the native queue so the media session exposes the
  // next/previous buttons (Android derives them from the queue size).
  const player = trackPlayerController;
  // Initialize the native player once (idempotent — also called lazily).
  useEffect(() => {
    player.ensureInit();
  }, [player]);
  // Timestamp of the most recent track selection — guards the "ended"
  // auto-advance against a queue-ended event racing right after a skip.
  const lastLoadRef = useRef(0);
  const { prefs } = useSettings();
  const qualityRef = useRef(prefs.playbackQuality);
  useEffect(() => {
    qualityRef.current = prefs.playbackQuality;
  }, [prefs.playbackQuality]);

  // Maps between the app playlist and the native queue. The native queue only
  // contains tracks whose stream URL resolved successfully, so playlist index
  // and native index can differ — this map bridges the two.
  const queueMetaRef = useRef<{
    nativeIndexByKey: Map<string, number>;
    /** Keys in EXACT native queue order — lets surgical mutations rebuild
     *  the index map without gaps after remove/insert. */
    nativeOrder: string[];
  }>({ nativeIndexByKey: new Map(), nativeOrder: [] });
  const queueBusyRef = useRef(false);

  // Resolves a track's stream URL (stat fallback for metadata-less items so
  // codec classification and transcode routing use REAL metadata — mirrors
  // the web app). One session id per track so the server can kill stale
  // ffmpeg per-stream on seek.
  const resolveTrackUrl = useCallback(
    async (it: FileItem): Promise<{ item: FileItem; url: string } | null> => {
      if (!api) return null;
      try {
        const real =
          !it.is_dir && !it.size && !it.mime
            ? await api.stat(it.root_id, it.path).catch(() => null)
            : null;
        const item = real || it;
        const url = await api.audioStreamUrl(item.root_id, item.path, {
          extension: item.extension,
          mime: item.mime,
          size: item.size,
          session: newSession(),
          quality: qualityRef.current,
        });
        return url ? { item, url } : null;
      } catch {
        return null;
      }
    },
    [api]
  );

  // ── Native queue build ────────────────────────────────────────────────
  // Whenever the playlist changes, resolve every track's stream URL (in
  // small concurrent batches) and load the whole list into TrackPlayer so
  // the notification shows next/previous buttons and playback auto-advances.
  useEffect(() => {
    if (!api || !playlist.length) return;
    let cancelled = false;
    queueBusyRef.current = true;
    (async () => {
      const resolved: Array<{ item: FileItem; url: string }> = [];
      const BATCH = 6;
      for (let i = 0; i < playlist.length; i += BATCH) {
        const results = await Promise.all(playlist.slice(i, i + BATCH).map(resolveTrackUrl));
        for (const r of results) if (r) resolved.push(r);
        if (cancelled) return;
      }
      if (cancelled) return;
      queueBusyRef.current = false;
      if (!resolved.length) {
        player.reset();
        return;
      }
      const nativeIndexByKey = new Map<string, number>();
      const nativeOrder: string[] = [];
      resolved.forEach((r, idx) => {
        const k = `${r.item.root_id}:${r.item.path}`;
        nativeIndexByKey.set(k, idx);
        nativeOrder.push(k);
      });
      queueMetaRef.current = { nativeIndexByKey, nativeOrder };
      await player.replaceQueue(
        resolved.map((r) => ({
          id: `${r.item.root_id}:${r.item.path}`,
          url: r.url,
          title: cleanTrackTitle(r.item.name),
          artist: `${(r.item.extension || "AUDIO").toUpperCase()} · Nexora`,
          // Embedded album art (MP3/FLAC/M4A) → the notification card artwork.
          artwork: api.thumbnailUrl(r.item.root_id, r.item.path, 512),
        }))
      );
      // The queue now exists — jump to the currently selected track.
      const ct = stateRef.current.currentTrack;
      if (ct && !cancelled) {
        const idx = nativeIndexByKey.get(`${ct.root_id}:${ct.path}`);
        if (typeof idx === "number" && idx >= 0) {
          lastLoadRef.current = Date.now();
          await player.skipToIndex(idx, true);
        }
      }

      // Warm the image cache for every track in the queue. Embedded album
      // art is extracted server-side on FIRST request (a full scan of up to
      // 60MB per file), which is why swiping next/prev used to show a blank
      // cover box until the extraction happened to finish. Prefetching the
      // whole queue means each swipe serves from the on-device cache instantly.
      if (!cancelled) {
        const ART_CONCURRENCY = 3;
        let cursor = 0;
        const workers = Array.from({ length: ART_CONCURRENCY }, async () => {
          while (!cancelled && cursor < resolved.length) {
            const r = resolved[cursor++];
            try {
              await Image.prefetch(api.thumbnailUrl(r.item.root_id, r.item.path, 512));
            } catch { /* prefetch is best-effort */ }
          }
        });
        void Promise.all(workers).catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playlist, api, player, resolveTrackUrl]);

  // ── Track selection (tap / next / prev / notification) ───────────────
  // Jump the native queue to the selected track instead of rebuilding it.
  useEffect(() => {
    if (!currentTrack || !api || !playlist.length) return;
    if (queueBusyRef.current) return; // queue build completion selects it
    const meta = queueMetaRef.current;
    const nativeIdx = meta?.nativeIndexByKey.get(`${currentTrack.root_id}:${currentTrack.path}`) ?? -1;
    if (nativeIdx < 0) return; // stream unresolved / not in the native queue
    if (nativeIdx === player.currentIndex) return; // already active
    lastLoadRef.current = Date.now();
    player.skipToIndex(nativeIdx, true);
  }, [currentTrack, playlist, api, player]);

  // If the session ends (logout / token expiry), stop playback so audio
  // doesn't keep playing behind the login screen.
  useEffect(() => {
    if (!api) {
      player.reset();
      setCurrentTrack(null);
      setPlaylist([]);
      setShowPlayer(false);
    }
  }, [api, player]);

  const stateRef = useRef({ currentTrack, playlist });
  useEffect(() => {
    stateRef.current = { currentTrack, playlist };
  }, [currentTrack, playlist]);

  const shuffleRef = useRef(shuffle);
  useEffect(() => {
    shuffleRef.current = shuffle;
  }, [shuffle]);

  // Pick the next/prev track, honouring shuffle. Returns the track to play.
  const step = useCallback((pl: FileItem[], cur: FileItem | null, _dir: 1 | -1): FileItem | null => {
    if (!pl.length) return null;
    if (pl.length === 1) return cur ?? pl[0];
    if (shuffleRef.current) {
      const idx = cur ? pl.findIndex((x) => x.path === cur.path) : -1;
      let ri = Math.floor(Math.random() * pl.length);
      if (pl.length > 1 && ri === idx) ri = (ri + 1) % pl.length;
      return pl[ri];
    }
    const idx = cur ? pl.findIndex((x) => x.path === cur.path) : -1;
    if (idx >= 0 && idx + _dir >= 0 && idx + _dir < pl.length) return pl[idx + _dir];
    return _dir > 0 ? pl[0] : pl[pl.length - 1];
  }, []);

  // ── Native auto-advance sync ─────────────────────────────────────────
  // With the full playlist in the native queue, mid-queue track changes happen
  // natively (track ends → next track). Keep the app's currentTrack in sync
  // with what the media session is actually playing (also keeps the mini
  // player, full-screen player and notification title in agreement).
  useEffect(() => {
    const sub = player.addListener("activeTrackChanged", ({ track }) => {
      if (!track?.id) return;
      const { currentTrack: ct, playlist: pl } = stateRef.current;
      if (ct && `${ct.root_id}:${ct.path}` === track.id) return;
      const item = pl.find((x) => `${x.root_id}:${x.path}` === track.id);
      if (item) setCurrentTrack(item);
    });
    return () => {
      sub.remove();
    };
  }, [player]);

  // ── Queue end (repeat off) ────────────────────────────────────────────
  // TrackPlayer stops when the last queue item ends (RepeatMode.Off). The app
  // preserves its wrap-around behavior: jump back to the start of the queue.
  useEffect(() => {
    const sub = player.addListener("ended", () => {
      const { currentTrack: ct, playlist: pl } = stateRef.current;
      if (!ct || pl.length <= 1) return;
      // Belt & braces: ignore a queue-ended that can race right after a skip.
      if (Date.now() - lastLoadRef.current < 1500) return;
      // Repeat-one is handled natively (RepeatMode.Track) — never wrap.
      if (player.loop) return;
      const next = step(pl, ct, 1);
      if (next) setCurrentTrack(next);
    });
    return () => {
      sub.remove();
    };
  }, [player, step]);

  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status }) => {
      if (status !== "error") return;
      // Failed track → auto-advance to the next track instead of dying
      // silently (e.g. unsupported codec and no server transcode).
      const { currentTrack: ct, playlist: pl } = stateRef.current;
      if (!ct || pl.length <= 1) {
        // Single-track failure: reset to “no media” so the player doesn't stay
        // wedged in a permanent error state — codec init failures on old
        // Android (e.g. FLAC below API 30) can otherwise crash MediaCodec or
        // leave every retry dead.
        player.reset();
        return;
      }
      const next = step(pl, ct, 1);
      if (next && next.path !== ct.path) setCurrentTrack(next);
    });
    return () => {
      sub.remove();
    };
  }, [player, step]);

  // Stable: reads no changing state (setters only), so it can be re-used as a
  // stable effect dep by consumers (e.g. the preview screen's auto-play).
  const playTrack = useCallback((item: FileItem, list?: FileItem[]) => {
    setCurrentTrack(item);
    if (list) {
      setPlaylist(list);
    } else {
      setPlaylist([item]);
    }
  }, []);

  const nextTrack = () => {
    if (!currentTrack || playlist.length <= 1) return;
    const next = step(playlist, currentTrack, 1);
    if (next) setCurrentTrack(next);
  };

  const prevTrack = () => {
    if (!currentTrack || playlist.length <= 1) return;
    const prev = step(playlist, currentTrack, -1);
    if (prev) setCurrentTrack(prev);
  };

  // ── Surgical queue mutations ────────────────────────────────────────
  // These keep BOTH the local playlist and the native TrackPlayer queue in
  // sync WITHOUT a full rebuild (which would restart the current song).

  /** Removes `item` from the queue. If it's the playing track, playback
   *  advances to the nearest neighbour first (or stops when it was the last). */
  const removeFromQueue = useCallback(
    (item: FileItem) => {
      const key = `${item.root_id}:${item.path}`;
      const idx = playlist.findIndex(
        (x) => `${x.root_id}:${x.path}` === key
      );
      if (idx < 0) return;
      const meta = queueMetaRef.current;
      const natIdx = meta.nativeIndexByKey.get(key);

      const isCurrent =
        !!currentTrack && `${currentTrack.root_id}:${currentTrack.path}` === key;

      // Local splice first — single source of truth for the UI.
      const nextPlaylist = playlist.filter(
        (x) => `${x.root_id}:${x.path}` !== key
      );
      meta.nativeOrder = meta.nativeOrder.filter((k) => k !== key);
      setPlaylist(nextPlaylist);

      if (isCurrent) {
        if (nextPlaylist.length === 0) {
          player.reset();
          setCurrentTrack(null);
          setShowPlayer(false);
          return;
        }
        const neighbour = nextPlaylist[Math.min(idx, nextPlaylist.length - 1)];
        setCurrentTrack(neighbour); // selection effect skips natively
      }

      // Native removal AFTER state so the skip lands before index shifts.
      if (typeof natIdx === "number" && natIdx >= 0) {
        void player.removeNativeIndex(natIdx);
      }
    },
    [playlist, currentTrack, player]
  );

  /** "Play next": inserts `item` right after the currently playing track. */
  const playNext = useCallback(
    async (item: FileItem): Promise<boolean> => {
      if (!api || !currentTrack) return false;
      const resolved = await resolveTrackUrl(item);
      if (!resolved) return false;
      const curKey = `${currentTrack.root_id}:${currentTrack.path}`;
      const meta = queueMetaRef.current;
      let natAfter = meta.nativeIndexByKey.get(curKey);
      natAfter = typeof natAfter === "number" ? natAfter + 1 : meta.nativeOrder.length;
      const newKey = `${resolved.item.root_id}:${resolved.item.path}`;

      // Already queued? Move instead of duplicating.
      const existingNat = meta.nativeIndexByKey.get(newKey);
      if (typeof existingNat === "number") {
        // Simplest correct behaviour: leave it where it is.
        return true;
      }

      await player.insertTracksAt(
        [
          {
            id: newKey,
            url: resolved.url,
            title: cleanTrackTitle(resolved.item.name),
            artist: `${(resolved.item.extension || "AUDIO").toUpperCase()} · Nexora`,
            artwork: api.thumbnailUrl(resolved.item.root_id, resolved.item.path, 512),
          },
        ],
        natAfter
      );
      meta.nativeOrder.splice(natAfter, 0, newKey);
      const nativeIndexByKey = new Map<string, number>();
      meta.nativeOrder.forEach((k, i) => nativeIndexByKey.set(k, i));
      meta.nativeIndexByKey = nativeIndexByKey;

      const plIdx = playlist.findIndex(
        (x) => `${x.root_id}:${x.path}` === curKey
      );
      const at = plIdx >= 0 ? plIdx + 1 : playlist.length;
      const nextPlaylist = [...playlist];
      nextPlaylist.splice(at, 0, item);
      setPlaylist(nextPlaylist);
      return true;
    },
    [api, currentTrack, playlist, player, resolveTrackUrl]
  );

  // Notification-center next/previous buttons (and headset media buttons)
  // route through the app's queue + shuffle logic.
  useEffect(() => {
    player.remoteHandlers = { next: nextTrack, previous: prevTrack };
    return () => {
      player.remoteHandlers = {};
    };
  }, [player, nextTrack, prevTrack]);

  const closePlayer = () => {
    // Reset clears the queue AND dismisses the notification card.
    player.reset();
    setCurrentTrack(null);
    setShowPlayer(false);
  };

  const queueIndex =
    currentTrack && playlist.length > 0
      ? playlist.findIndex((x) => x.path === currentTrack.path)
      : -1;

  return (
    <AudioContext.Provider
      value={{
        player,
        currentTrack,
        playlist,
        queueIndex,
        playTrack,
        nextTrack,
        prevTrack,
        removeFromQueue,
        playNext,
        closePlayer,
        showPlayer,
        setShowPlayer,
        shuffle,
        setShuffle,
      }}
    >
      {children}
    </AudioContext.Provider>
  );
}

export function useAudio() {
  const ctx = useContext(AudioContext);
  if (!ctx) throw new Error("useAudio must be used within AudioProvider");
  return ctx;
}
