import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { useVideoPlayer, VideoPlayer } from "expo-video";
import type { FileItem } from "../api/types";
import { useSession } from "./SessionContext";

type AudioContextType = {
  player: VideoPlayer | null;
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

  // Start with no source — expo-video treats null as “no media loaded”.
  // (An empty string is an invalid URI on both iOS and Android and logs errors.)
  const player = useVideoPlayer(null);
  const sessionRef = useRef(newSession());

  // Stream through the server transcode pipeline when the codec is not
  // natively decodable (ALAC .m4a, WMA, Ogg/Opus, …) — mirrors the web app.
  useEffect(() => {
    if (!currentTrack || !api) return;
    let cancelled = false;
    sessionRef.current = newSession();
    api
      .audioStreamUrl(currentTrack.root_id, currentTrack.path, {
        extension: currentTrack.extension,
        mime: currentTrack.mime,
        session: sessionRef.current,
      })
      .then((url) => {
        if (cancelled) return;
        player.replace(url);
        player.play();
      });
    return () => {
      cancelled = true;
    };
  }, [currentTrack, api]);

  // If the session ends (logout / token expiry), stop playback so audio
  // doesn't keep playing behind the login screen.
  useEffect(() => {
    if (!api) {
      player.pause();
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

  useEffect(() => {
    const sub = player.addListener("playToEnd", () => {
      const { currentTrack: ct, playlist: pl } = stateRef.current;
      if (!ct || pl.length <= 1) return;
      const next = step(pl, ct, 1);
      if (next) setCurrentTrack(next);
    });
    return () => sub.remove();
  }, [player, step]);

  // If a track fails to load/play (e.g. unsupported codec and no server
  // transcode), auto-advance to the next track instead of dying silently.
  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status }) => {
      if (status !== "error") return;
      const { currentTrack: ct, playlist: pl } = stateRef.current;
      if (!ct || pl.length <= 1) return;
      const next = step(pl, ct, 1);
      if (next && next.path !== ct.path) setCurrentTrack(next);
    });
    return () => sub.remove();
  }, [player, step]);

  const playTrack = (item: FileItem, list?: FileItem[]) => {
    setCurrentTrack(item);
    if (list) {
      setPlaylist(list);
    } else {
      setPlaylist([item]);
    }
  };

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

  const closePlayer = () => {
    player.pause();
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
