import { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  Volume1,
  VolumeX,
  X,
  ChevronUp,
  Music,
} from "lucide-react";
import type { FileItem } from "../api/types";
import { usePlayer, engine } from "../store/player";
import { useShallow } from "zustand/react/shallow";
import { thumbUrl, rawUrl, getAudioQuality } from "../lib/preview";
import MediaPlayer from "./MediaPlayer";

function fmt(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function Cover({ item }: { item: FileItem | null }) {
  const [failed, setFailed] = useState(false);
  if (failed || !item) {
    return (
      <div className="h-full w-full grid place-items-center bg-gradient-to-br from-accent/60 to-purple-600/60 backdrop-blur-md">
        <Music className="h-5 w-5 text-white/90" />
      </div>
    );
  }
  return <img src={thumbUrl(item)} alt="" className="h-full w-full object-cover transition-transform duration-500 hover:scale-110" onError={() => setFailed(true)} />;
}

export default function PlayerBar() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const bound = useRef(false);
  const { current, isPlaying, volume, muted, primaryOpen, currentTime, duration, queueLength, index } = usePlayer(
    useShallow((s) => ({
      current: s.current(),
      isPlaying: s.isPlaying,
      volume: s.volume,
      muted: s.muted,
      primaryOpen: s.primaryOpen,
      currentTime: s.currentTime,
      duration: s.duration,
      queueLength: s.queue.length,
      index: s.index,
    }))
  );
  const [expanded, setExpanded] = useState(false);

  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const quality = current ? getAudioQuality(current) : null;
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const openExpanded = () => {
    setExpanded(true);
    usePlayer.getState().setPrimaryOpen(true);
  };

  useEffect(() => {
    if (audioRef.current && !bound.current) {
      engine.bind(audioRef.current);
      bound.current = true;
    }
  }, []);

  const url = current ? rawUrl(current.root_id, current.path) : "";
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !url) return;
    a.src = url;
    a.load();
    if (usePlayer.getState().isPlaying) a.play().catch(() => {});
  }, [url]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying) a.play().catch(() => {});
    else a.pause();
  }, [isPlaying]);

  const stop = () => {
    engine.pause();
    usePlayer.setState({ queue: [], index: -1, isPlaying: false, currentTime: 0, duration: 0 });
  };

  const showMini = !primaryOpen || expanded;

  return (
    <>
      <audio ref={audioRef} preload="none" />

      {current && showMini && !expanded && (
        <div className="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-2rem)] max-w-lg pointer-events-none">
          <div className="pointer-events-auto glass-strong rounded-2xl px-3 py-2.5 shadow-2xl transition-all duration-500 ease-out">
            <div className="flex items-center gap-2">
              <div className={`group relative h-10 w-10 rounded-full overflow-hidden shrink-0 shadow-md transition-all duration-500 ${isPlaying ? 'animate-[spin_8s_linear_infinite]' : ''}`}>
                <Cover item={current} />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer rounded-full" onClick={openExpanded}>
                  <ChevronUp className="h-4 w-4 text-white" />
                </div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-black/80 rounded-full border border-white/20 shadow-inner" />
              </div>

              <div className="min-w-0 flex-1 cursor-pointer" onClick={openExpanded}>
                <p className="truncate text-[13px] sm:text-sm font-bold text-content leading-tight hover:text-accent transition-colors">{current.name.replace(/\.[^.]+$/, '')}</p>
                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                  {quality?.label && (
                    <span className={`text-[9px] font-semibold ${quality.color}`}>{quality.label}</span>
                  )}
                </div>
                <p className="truncate text-[10px] font-medium text-content-muted mt-0.5">
                  {queueLength > 1 && `Track ${index + 1} / ${queueLength}`}
                  {queueLength > 1 && isPlaying ? ' · ' : ''}
                  {isPlaying ? 'Now Playing' : 'Paused'}
                </p>
              </div>

              <div className="flex items-center gap-0.5 shrink-0">
                <button onClick={() => usePlayer.getState().prev()} className="p-1.5 rounded-full text-content-muted hover:text-content hover:bg-white/10 transition-colors" title="Previous">
                  <SkipBack className="h-4 w-4" />
                </button>
                <button
                  onClick={() => usePlayer.getState().toggle()}
                  className={`h-9 w-9 rounded-full grid place-items-center text-white shadow-lg transition-all duration-300 hover:scale-105 active:scale-95
                    ${isPlaying ? 'bg-gradient-to-br from-accent to-purple-500 shadow-accent/40' : 'bg-surface-muted border border-white/20 text-content'}`}
                  title={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-0.5" />}
                </button>
                <button onClick={() => usePlayer.getState().next(false)} className="p-1.5 rounded-full text-content-muted hover:text-content hover:bg-white/10 transition-colors" title="Next">
                  <SkipForward className="h-4 w-4" />
                </button>
                <button
                  onClick={() => usePlayer.getState().setShuffle(!usePlayer.getState().shuffle)}
                  className={`p-1.5 rounded-full transition-colors ${usePlayer.getState().shuffle ? "text-accent bg-accent/10" : "text-content-muted hover:text-content hover:bg-white/10"}`}
                  title="Shuffle"
                >
                  <Shuffle className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => usePlayer.getState().cycleRepeat()}
                  className={`p-1.5 rounded-full transition-colors ${usePlayer.getState().repeat !== "off" ? "text-accent bg-accent/10" : "text-content-muted hover:text-content hover:bg-white/10"}`}
                  title={`Repeat: ${usePlayer.getState().repeat}`}
                >
                  {usePlayer.getState().repeat === "one" ? <Repeat1 className="h-3.5 w-3.5" /> : <Repeat className="h-3.5 w-3.5" />}
                </button>
                <div className="group relative flex items-center">
                  <button
                    onClick={() => usePlayer.getState().toggleMute()}
                    className={`p-1.5 rounded-full transition-colors ${muted ? "text-danger bg-danger/10" : "text-content-muted hover:text-content hover:bg-white/10"}`}
                    title={muted ? "Unmute" : "Mute"}
                  >
                    <VolIcon className="h-3.5 w-3.5" />
                  </button>
                  <div className="absolute bottom-full right-0 mb-2 w-28 glass-strong rounded-lg p-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto">
                    <div className="relative h-1.5 w-full rounded-full bg-white/20">
                      <div className="absolute inset-y-0 left-0 bg-accent rounded-full" style={{ width: `${(muted ? 0 : volume) * 100}%` }} />
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={muted ? 0 : volume}
                        onChange={(e) => usePlayer.getState().setVolume(Number(e.target.value))}
                        className="absolute inset-0 w-full opacity-0 cursor-pointer"
                        aria-label="Volume"
                      />
                    </div>
                  </div>
                </div>
                <button onClick={stop} className="p-1.5 rounded-full text-content-muted hover:text-danger hover:bg-danger/10 transition-colors" title="Close Player">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-2">
              <div className="relative h-1.5 rounded-full bg-white/20 overflow-hidden cursor-pointer group">
                <div className="absolute inset-y-0 left-0 bg-accent rounded-full transition-all duration-100" style={{ width: `${pct}%` }} />
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.1}
                  value={currentTime}
                  onChange={(e) => engine.seek(Number(e.target.value))}
                  className="absolute inset-0 w-full opacity-0 cursor-pointer"
                  aria-label="Seek"
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono tabular-nums text-content-muted mt-1">
                <span>{fmt(currentTime)}</span>
                <span>{fmt(duration)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {current && expanded && (
        <div className="pointer-events-auto relative z-[100]">
          <MediaPlayer
            kind="audio"
            controlled
            autoPlay
            startFullscreen
            onClose={() => {
              setExpanded(false);
              usePlayer.getState().setPrimaryOpen(false);
            }}
          />
        </div>
      )}
    </>
  );
}
