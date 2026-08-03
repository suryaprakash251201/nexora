import React, { createContext, useContext, useState, useEffect, useRef } from "react";
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
};

const AudioContext = createContext<AudioContextType | null>(null);

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const { api } = useSession();
  const [currentTrack, setCurrentTrack] = useState<FileItem | null>(null);
  const [playlist, setPlaylist] = useState<FileItem[]>([]);
  const [showPlayer, setShowPlayer] = useState(false);

  // We initialize with a dummy URL, useVideoPlayer handles updates if we replace.
  const player = useVideoPlayer("");

  useEffect(() => {
    if (currentTrack && api) {
      const url = api.rawFileUrl(currentTrack.root_id, currentTrack.path);
      player.replace(url);
      player.play();
    }
  }, [currentTrack, api]);

  const stateRef = useRef({ currentTrack, playlist });
  useEffect(() => {
    stateRef.current = { currentTrack, playlist };
  }, [currentTrack, playlist]);

  useEffect(() => {
    const sub = player.addListener("playToEnd", () => {
      const { currentTrack: ct, playlist: pl } = stateRef.current;
      if (!ct || pl.length <= 1) return;
      const idx = pl.findIndex((x) => x.path === ct.path);
      if (idx >= 0 && idx < pl.length - 1) {
        setCurrentTrack(pl[idx + 1]);
      } else if (pl.length > 0) {
        setCurrentTrack(pl[0]);
      }
    });
    return () => sub.remove();
  }, [player]);

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
    const idx = playlist.findIndex((x) => x.path === currentTrack.path);
    if (idx >= 0 && idx < playlist.length - 1) {
      setCurrentTrack(playlist[idx + 1]);
    } else if (playlist.length > 0) {
      setCurrentTrack(playlist[0]);
    }
  };

  const prevTrack = () => {
    if (!currentTrack || playlist.length <= 1) return;
    const idx = playlist.findIndex((x) => x.path === currentTrack.path);
    if (idx > 0) {
      setCurrentTrack(playlist[idx - 1]);
    } else if (playlist.length > 0) {
      setCurrentTrack(playlist[playlist.length - 1]);
    }
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
