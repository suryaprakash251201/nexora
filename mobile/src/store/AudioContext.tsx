import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
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
  // center / lock screen / control center) with play, pause, next, previous,
  // seek and ±15s jump controls on both iOS and Android.
  const player = trackPlayerController;
  // Initialize the native player once (idempotent — also called by load()).
  useEffect(() => {
    player.ensureInit();
  }, [player]);
  const sessionRef = useRef(newSession());
  // Timestamp of the most recent load — guards the "ended" auto-advance
  // against a queue-ended event that can race right after a load/reset.
  const lastLoadRef = useRef(0);
  const { prefs } = useSettings();
  const qualityRef = useRef(prefs.playbackQuality);
  useEffect(() => {
    qualityRef.current = prefs.playbackQuality;
  }, [prefs.playbackQuality]);

  // Stream through the server transcode pipeline when the codec is not
  // natively decodable (ALAC .m4a, WMA, Ogg/Opus, …) — mirrors the web app.
  useEffect(() => {
    if (!currentTrack || !api) return;
    let cancelled = false;
    sessionRef.current = newSession();
    // Playlist/favorite/trash items may carry size:0 (no metadata in those
    // APIs). Stat the file so codec classification (lossless vs AAC) and the
    // transcode-vs-raw routing use REAL metadata — otherwise a hi-res FLAC
    // from a playlist would be mislabeled and an ALAC .m4a misrouted.
    let item: FileItem = currentTrack;
    const needStat = !currentTrack.is_dir && !currentTrack.size && !currentTrack.mime;
    (needStat ? api.stat(currentTrack.root_id, currentTrack.path).catch(() => null) : Promise.resolve(null))
      .then((real) => {
        if (cancelled) return;
        item = real || currentTrack;
        return api.audioStreamUrl(item.root_id, item.path, {
          extension: item.extension,
          mime: item.mime,
          size: item.size,
          session: sessionRef.current,
          quality: qualityRef.current,
        });
      })
      .then((url) => {
        if (cancelled || !url) return;
        // Play intent: load() resets the single-track transport, adds the
        // resolved stream and calls play() — TrackPlayer starts once the
        // source is ready, so no manual play-on-ready retry is needed.
        lastLoadRef.current = Date.now();
        return player.load(
          {
            id: `${item.root_id}:${item.path}`,
            url,
            title: cleanTrackTitle(item.name),
            artist: `${(item.extension || "AUDIO").toUpperCase()} · Nexora`,
            // Embedded album art (MP3/FLAC/M4A) → the notification card artwork.
            artwork: api.thumbnailUrl(item.root_id, item.path, 512),
          },
          true
        );
      });
    return () => {
      cancelled = true;
    };
  }, [currentTrack, api, player]);

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

  // When a track ends naturally (repeat off) advance to the next queue item.
  useEffect(() => {
    const sub = player.addListener("ended", () => {
      const { currentTrack: ct, playlist: pl } = stateRef.current;
      if (!ct || pl.length <= 1) return;
      // Belt & braces: ignore a queue-ended that can race right after a load.
      if (Date.now() - lastLoadRef.current < 1500) return;
      // Repeat-one is handled natively (RepeatMode.Track) — never advance.
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
