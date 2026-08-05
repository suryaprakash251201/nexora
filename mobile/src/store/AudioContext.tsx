import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { useVideoPlayer, VideoPlayer } from "expo-video";
import type { FileItem } from "../api/types";
import { useSession } from "./SessionContext";

type AudioContextType = {
  player: VideoPlayer | null;
  currentTrack: FileItem | null;
  playlist: FileItem[];
  playTrack: (item: FileItem, playlist?: FileItem[]) => void;
  nextTrack: () => void;
  prevTrack: () => void;
  closePlayer: () => void;
  showPlayer: boolean;
  setShowPlayer: (s: boolean) => void;
  shuffle: boolean;
  setShuffle: (s: boolean) => void;
};

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

  useEffect(() => {
    if (currentTrack && api) {
      const url = api.rawFileUrl(currentTrack.root_id, currentTrack.path);
      player.replace(url);
      player.play();
    }
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

  return (
    <AudioContext.Provider
      value={{
        player,
        currentTrack,
        playlist,
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
