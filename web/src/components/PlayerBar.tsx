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
  Plus,
} from "lucide-react";
import type { FileItem } from "../api/types";
import { usePlayer, engine } from "../store/player";
import { thumbUrl, rawUrl } from "../lib/preview";
import { AddToPlaylistMenu } from "./PlaylistAdder";
import MediaPlayer from "./MediaPlayer";
import { createPortal } from "react-dom";

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
  const current = usePlayer((s) => s.current());
  const isPlaying = usePlayer((s) => s.isPlaying);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const currentTime = usePlayer((s) => s.currentTime);
  const duration = usePlayer((s) => s.duration);
  const primaryOpen = usePlayer((s) => s.primaryOpen);
  const [expanded, setExpanded] = useState(false);
  
  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

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

  if (!current) return <audio ref={audioRef} preload="none" />;

  const stop = () => {
    engine.pause();
    usePlayer.setState({ queue: [], index: -1, isPlaying: false, currentTime: 0, duration: 0 });
  };

  // When the primary (full-screen) player is open but not expanded-visible yet,
  // keep the audio element mounted (so playback continues) but hide the mini bar.
  const showMini = !primaryOpen || expanded;

  return createPortal(
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] w-[95%] max-w-[800px] pointer-events-none flex justify-center">
      <audio ref={audioRef} preload="none" />

      {showMini && !expanded && (
        <div className={`pointer-events-auto transition-all duration-500 ease-out flex items-center p-2 rounded-[2rem] border border-white/20 shadow-2xl backdrop-blur-2xl
          ${isPlaying ? 'bg-surface-strong/80 shadow-accent/20 ring-1 ring-accent/30 scale-100' : 'bg-surface-strong/60 shadow-black/10 scale-[0.98]'}`}>
          
          <div className="flex items-center gap-4 px-2">
            <div className={`relative h-12 w-12 rounded-full overflow-hidden shrink-0 shadow-md transition-all duration-500 group ${isPlaying ? 'animate-[spin_8s_linear_infinite]' : ''}`}>
              <Cover item={current} />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer" onClick={openExpanded}>
                <ChevronUp className="h-5 w-5 text-white" />
              </div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-black/80 rounded-full border border-white/20 shadow-inner" />
            </div>

            <div className="min-w-0 w-32 sm:w-48 flex flex-col justify-center cursor-pointer" onClick={openExpanded}>
              <p className="truncate text-sm font-bold text-content leading-tight hover:text-accent transition-colors">{current.name}</p>
              <p className="truncate text-[11px] font-medium text-content-muted mt-0.5">{isPlaying ? 'Now Playing' : 'Paused'}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-6 px-4 py-1 border-x border-white/10 mx-2">
            <button onClick={() => usePlayer.getState().prev()} className="p-1.5 rounded-full text-content-muted hover:text-content hover:bg-white/10 transition-colors" title="Previous">
              <SkipBack className="h-5 w-5" />
            </button>
            <button
              onClick={() => usePlayer.getState().toggle()}
              className={`h-12 w-12 rounded-full grid place-items-center text-white shadow-lg transition-all duration-300 hover:scale-105 active:scale-95
                ${isPlaying ? 'bg-gradient-to-br from-accent to-purple-500 shadow-accent/40' : 'bg-surface-muted border border-white/20 text-content'}`}
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-0.5" />}
            </button>
            <button onClick={() => usePlayer.getState().next(false)} className="p-1.5 rounded-full text-content-muted hover:text-content hover:bg-white/10 transition-colors" title="Next">
              <SkipForward className="h-5 w-5" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 px-2 pr-4 shrink-0">
            <button
              onClick={() => usePlayer.getState().setShuffle(!usePlayer.getState().shuffle)}
              className={`p-2 rounded-full transition-colors hidden sm:block ${usePlayer.getState().shuffle ? "text-accent bg-accent/10" : "text-content-muted hover:text-content hover:bg-white/10"}`}
              title="Shuffle"
            >
              <Shuffle className="h-4 w-4" />
            </button>
            <button
              onClick={() => usePlayer.getState().cycleRepeat()}
              className={`p-2 rounded-full transition-colors hidden sm:block ${usePlayer.getState().repeat !== "off" ? "text-accent bg-accent/10" : "text-content-muted hover:text-content hover:bg-white/10"}`}
              title={`Repeat: ${usePlayer.getState().repeat}`}
            >
              {usePlayer.getState().repeat === "one" ? <Repeat1 className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
            </button>
            
            <div className="group relative hidden md:flex items-center gap-2 pl-2 border-l border-white/10">
              <button
                onClick={() => usePlayer.getState().toggleMute()}
                className={`p-2 rounded-full transition-colors ${muted ? "text-danger bg-danger/10" : "text-content-muted hover:text-content hover:bg-white/10"}`}
                title={muted ? "Unmute" : "Mute"}
              >
                <VolIcon className="h-4 w-4" />
              </button>
              <div className="w-0 group-hover:w-20 overflow-hidden transition-all duration-300 ease-out opacity-0 group-hover:opacity-100 flex items-center">
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

            <button onClick={stop} className="p-2 ml-1 rounded-full text-content-muted hover:text-danger hover:bg-danger/10 transition-colors" title="Close Player">
              <X className="h-5 w-5" />
            </button>
          </div>
          
          <div className="absolute bottom-0 left-6 right-6 h-0.5 rounded-full bg-white/10 overflow-hidden hidden sm:block">
             <div className="h-full bg-gradient-to-r from-accent to-purple-500 transition-all duration-300 ease-out" style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      {expanded && (
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
      )}
    </div>,
    document.body
  );
}

function fmtTime(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
