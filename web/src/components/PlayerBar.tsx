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
import { thumbUrl, rawUrl } from "../lib/preview";
import MediaPlayer from "./MediaPlayer";

function Cover({ item }: { item: FileItem | null }) {
  const [failed, setFailed] = useState(false);
  if (failed || !item) {
    return (
      <div className="h-full w-full grid place-items-center bg-gradient-to-br from-accent/40 to-fuchsia-500/30">
        <Music className="h-5 w-5 text-white" />
      </div>
    );
  }
  return <img src={thumbUrl(item)} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />;
}

export default function PlayerBar() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const bound = useRef(false);
  const current = usePlayer((s) => s.current());
  const isPlaying = usePlayer((s) => s.isPlaying);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const primaryOpen = usePlayer((s) => s.primaryOpen);
  const [expanded, setExpanded] = useState(false);
  const [showVolume, setShowVolume] = useState(false);
  const volWrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showVolume) return;
    const onDown = (e: MouseEvent) => {
      if (volWrap.current && !volWrap.current.contains(e.target as Node)) setShowVolume(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showVolume]);

  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

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

  // While the primary (popup) player is open, hide the mini bar but keep the
  // audio element mounted so playback continues uninterrupted.
  if (primaryOpen) return <audio ref={audioRef} preload="none" />;

  const stop = () => {
    engine.pause();
    usePlayer.setState({ queue: [], index: -1, isPlaying: false, currentTime: 0, duration: 0 });
  };

  return (
    <>
      <audio ref={audioRef} preload="none" />

      {!expanded && (
      <div className="glass-strong rounded-2xl mx-3 mb-2 px-3 py-2.5 flex items-center gap-3 ring-1 ring-white/10">
        <div className="h-12 w-12 rounded-xl overflow-hidden shrink-0 ring-1 ring-white/10 shadow-md">
          <Cover item={current} />
        </div>
        <div className="min-w-0 w-40 hidden sm:block">
          <p className="truncate text-sm font-medium">{current.name}</p>
          <p className="truncate text-xs text-content-muted">Now playing</p>
        </div>

        <div className="flex-1 flex items-center gap-2">
          <div className="flex items-center gap-1">
            <button onClick={() => usePlayer.getState().prev()} className="p-1.5 rounded-full glass-hover" title="Previous">
              <SkipBack className="h-4 w-4" />
            </button>
            <button
              onClick={() => usePlayer.getState().toggle()}
              className="h-9 w-9 rounded-full accent-glass grid place-items-center"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-0.5" />}
            </button>
            <button onClick={() => usePlayer.getState().next(false)} className="p-1.5 rounded-full glass-hover" title="Next">
              <SkipForward className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 flex items-center gap-2 min-w-0">
            <span className="text-xs text-content-muted tabular-nums w-10 text-right hidden md:block">
              {fmtTime(usePlayer.getState().currentTime)}
            </span>
            <ProgressBar />
            <span className="text-xs text-content-muted tabular-nums w-10 hidden md:block">
              {fmtTime(usePlayer.getState().duration)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => usePlayer.getState().setShuffle(!usePlayer.getState().shuffle)}
            className={`p-1.5 rounded-full glass-hover ${usePlayer.getState().shuffle ? "text-accent" : ""}`}
            title="Shuffle"
          >
            <Shuffle className="h-4 w-4" />
          </button>
          <button
            onClick={() => usePlayer.getState().cycleRepeat()}
            className={`p-1.5 rounded-full glass-hover ${usePlayer.getState().repeat !== "off" ? "text-accent" : ""}`}
            title={`Repeat: ${usePlayer.getState().repeat}`}
          >
            {usePlayer.getState().repeat === "one" ? <Repeat1 className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
          </button>
          <div className="relative" ref={volWrap}>
            <button
              onClick={() => setShowVolume((v) => !v)}
              className={`p-1.5 rounded-full glass-hover ${showVolume ? "text-accent" : ""}`}
              title="Volume"
            >
              <VolIcon className="h-4 w-4" />
            </button>
            {showVolume && (
              <div
                className="absolute bottom-full right-0 mb-2 p-3 glass-strong rounded-xl flex items-center gap-2 ring-1 ring-white/10 w-44"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => usePlayer.getState().toggleMute()}
                  className="p-1 rounded-full glass-hover"
                  title={muted ? "Unmute" : "Mute"}
                >
                  <VolIcon className="h-4 w-4" />
                </button>
                <div className="relative h-1.5 flex-1 rounded-full bg-white/20 overflow-hidden">
                  <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${(muted ? 0 : volume) * 100}%` }} />
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
                <span className="text-xs text-content-muted tabular-nums w-8 text-right">
                  {Math.round((muted ? 0 : volume) * 100)}
                </span>
              </div>
            )}
          </div>
          <button onClick={() => setExpanded(true)} className="p-1.5 rounded-full glass-hover" title="Expand">
            <ChevronUp className="h-4 w-4" />
          </button>
          <button onClick={stop} className="p-1.5 rounded-full glass-hover hover:text-red-500" title="Stop">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      )}

      {expanded && (
        <div className="fixed inset-0 z-[70] grid place-items-center p-4 bg-black/70" onMouseDown={() => setExpanded(false)}>
          <div className="w-full max-w-lg glass-strong rounded-2xl overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b glass-divider">
              <span className="text-sm font-medium">Now playing</span>
              <button onClick={() => setExpanded(false)} className="p-1.5 rounded-full glass-hover"><X className="h-4 w-4" /></button>
            </div>
            <MediaPlayer kind="audio" controlled autoPlay />
          </div>
        </div>
      )}
    </>
  );
}

function ProgressBar() {
  const ref = useRef<HTMLInputElement>(null);
  const [val, setVal] = useState(0);
  useEffect(() => {
    const unsub = usePlayer.subscribe((s) => {
      const d = s.duration || 0;
      setVal(d > 0 ? (s.currentTime / d) * 100 : 0);
    });
    return unsub;
  }, []);
  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pct = Number(e.target.value);
    const d = usePlayer.getState().duration;
    if (d > 0) usePlayer.getState().seek((pct / 100) * d);
  };
  return (
    <div className="relative h-1.5 flex-1 rounded-full bg-white/20 overflow-hidden">
      <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${val}%` }} />
      <input
        ref={ref}
        type="range"
        min={0}
        max={100}
        step={0.1}
        value={val}
        onChange={seek}
        className="absolute inset-0 w-full opacity-0 cursor-pointer"
        aria-label="Seek"
      />
    </div>
  );
}

function fmtTime(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
