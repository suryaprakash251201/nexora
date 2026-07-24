import { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  X,
  ArrowLeft,
  Music,
  Shuffle,
  Repeat,
  Repeat1,
  Captions,
  Rewind,
  FastForward,
  Plus,
  MonitorPlay,
  Download,
} from "lucide-react";
import type { FileItem } from "../api/types";
import { thumbUrl, needsTranscode, transcodeUrl, serverSupportsTranscode, getAudioQuality } from "../lib/preview";
import { usePlayer } from "../store/player";
import { AddToPlaylistMenu } from "./PlaylistAdder";
import { Button } from "./ui/Button";

function fmt(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function srtToVtt(srt: string): string {
  let out = "WEBVTT\n\n";
  const blocks = srt.replace(/\r/g, "").split(/\n\s*\n/);
  for (const b of blocks) {
    const lines = b.split("\n").filter((l) => l.trim() !== "");
    if (lines.length < 2) continue;
    let i = 0;
    if (/^\d+$/.test(lines[0])) i = 1;
    const timing = lines[i].replace(",", ".");
    out += timing + "\n" + lines.slice(i + 1).join("\n") + "\n\n";
  }
  return out;
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

interface MediaPlayerProps {
  kind: "audio" | "video";
  url?: string;
  item?: FileItem;
  playlist?: FileItem[];
  index?: number;
  onSelect?: (i: number) => void;
  autoPlay?: boolean;
  controlled?: boolean;
  startFullscreen?: boolean;
  onClose?: () => void;
}

export default function MediaPlayer({ kind, url, item, playlist, index = 0, onSelect, autoPlay, controlled, startFullscreen, onClose }: MediaPlayerProps) {
  if (kind === "audio") {
    return <AudioPlayer url={url} item={item} playlist={playlist} index={index} onSelect={onSelect} autoPlay={autoPlay} controlled={controlled} startFullscreen={startFullscreen} onClose={onClose} />;
  }
  return <VideoPlayer url={url} item={item} autoPlay={autoPlay} />;
}

function CoverArt({ item, className }: { item: FileItem; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className={`h-full w-full grid place-items-center bg-gradient-to-br from-accent/30 to-purple-500/20 ${className || ""}`}>
        <Music className="h-1/3 w-1/3 text-white/80 drop-shadow-md" />
      </div>
    );
  }
  return (
    <img
      src={thumbUrl(item)}
      alt=""
      className={`h-full w-full object-cover transition-transform duration-700 hover:scale-105 ${className || ""}`}
      onError={() => setFailed(true)}
    />
  );
}

function AudioPlayer({
  url,
  item,
  playlist,
  index,
  onSelect,
  autoPlay,
  controlled,
  startFullscreen,
  onClose,
}: {
  url?: string;
  item?: FileItem;
  playlist?: FileItem[];
  index?: number;
  onSelect?: (i: number) => void;
  autoPlay?: boolean;
  controlled?: boolean;
  startFullscreen?: boolean;
  onClose?: () => void;
}) {
  const player = usePlayer();
  const cur = controlled ? (player.current() ?? item) : item;
  const isPlaying = controlled ? player.isPlaying : false;
  const curT = controlled ? player.currentTime : 0;
  const durT = controlled ? player.duration : 0;
  const volV = controlled ? player.volume : 1;
  const mutedV = controlled ? player.muted : false;
  const rateV = controlled ? player.playbackRate : 1;
  const queue = controlled ? player.queue : playlist || [];
  const qIndex = controlled ? player.index : index || 0;
  const multi = queue.length > 1;

  const ref = useRef<HTMLAudioElement>(null);
  const [lPlaying, setLPlaying] = useState(false);
  const [lCur, setLCur] = useState(0);
  const [lDur, setLDur] = useState(0);
  const [lVol, setLVol] = useState(1);
  const [lMuted, setLMuted] = useState(false);
  const [lRate, setLRate] = useState(1);

  const [fs, setFs] = useState(startFullscreen || false);
  const [bgFailed, setBgFailed] = useState(false);
  const [showRates, setShowRates] = useState(false);
  const fsWrapRef = useRef<HTMLDivElement>(null);

  const [showControls, setShowControls] = useState(true);
  const controlsTimeout = useRef<number>();

  useEffect(() => {
    if (controlled) return;
    const a = ref.current;
    if (!a) return;
    const onTime = () => setLCur(a.currentTime);
    const onMeta = () => setLDur(a.duration);
    const onPlay = () => setLPlaying(true);
    const onPause = () => setLPlaying(false);
    const onEnded = () => step(1);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
    };
  }, [url, controlled]);

  useEffect(() => {
    if (controlled) return;
    const a = ref.current;
    if (!a) return;
    a.load();
    setLCur(0);
    if (autoPlay) a.play().catch(() => {});
  }, [url, controlled]);

  // Reset the blurred-background error flag whenever the track changes so a
  // failed cover on one track doesn't permanently disable the backdrop.
  useEffect(() => {
    setBgFailed(false);
  }, [cur?.path]);

  const toggle = () => {
    if (controlled) { player.toggle(); return; }
    const a = ref.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  };
  const seek = (v: number) => {
    if (controlled) { player.seek(v); return; }
    if (ref.current) ref.current.currentTime = v;
    setLCur(v);
  };
  const changeVol = (v: number) => {
    if (controlled) { player.setVolume(v); return; }
    setLVol(v); setLMuted(v === 0);
    if (ref.current) ref.current.volume = v;
  };
  const changeRate = (r: number) => {
    if (controlled) { player.setPlaybackRate(r); return; }
    setLRate(r);
    if (ref.current) ref.current.playbackRate = r;
    setShowRates(false);
  };

  const step = (dir: number) => {
    if (controlled) { dir > 0 ? player.next(false) : player.prev(); return; }
    if (!playlist || playlist.length === 0 || !onSelect) return;
    const ni = (qIndex + dir + playlist.length) % playlist.length;
    onSelect(ni);
  };

  const playing = controlled ? isPlaying : lPlaying;
  const curTime = controlled ? curT : lCur;
  const duration = controlled ? durT : lDur;
  const volume = controlled ? volV : lVol;
  const muted = controlled ? mutedV : lMuted;
  const rate = controlled ? rateV : lRate;
  const pct = duration > 0 ? (curTime / duration) * 100 : 0;

  const volFillStyle = (v: number, m: boolean) => {
    const pctW = (m ? 0 : v) * 100;
    let bg: string;
    if (m || v === 0) bg = '#73809A';
    else if (v < 0.3) bg = 'linear-gradient(90deg, #F59E0B, #FB923C)';
    else if (v < 0.7) bg = 'linear-gradient(90deg, #5B8CFF, #7A5CFF)';
    else bg = 'linear-gradient(90deg, #22C55E, #2DD4BF)';
    return { width: `${pctW}%`, background: bg, borderRadius: 'inherit', transition: 'all 0.1s ease-out' };
  };
  const volFillStyleV = (v: number, m: boolean) => {
    const pctH = (m ? 0 : v) * 100;
    let bg: string;
    if (m || v === 0) bg = '#73809A';
    else if (v < 0.3) bg = 'linear-gradient(180deg, #F59E0B, #FB923C)';
    else if (v < 0.7) bg = 'linear-gradient(180deg, #5B8CFF, #7A5CFF)';
    else bg = 'linear-gradient(180deg, #22C55E, #2DD4BF)';
    return { height: `${pctH}%`, background: bg, borderRadius: 'inherit', transition: 'all 0.1s ease-out' };
  };

  const openFs = () => {
    setFs(true);
    setShowControls(true);
    // Request real browser fullscreen inside the user gesture so it isn't blocked.
    requestAnimationFrame(() => fsWrapRef.current?.requestFullscreen?.().catch(() => {}));
  };

  const closeFs = () => {
    setFs(false);
    onClose?.();
  };

  // When the in-app overlay closes, make sure we also leave real fullscreen.
  useEffect(() => {
    if (!fs && document.fullscreenElement && document.fullscreenElement === fsWrapRef.current) {
      document.exitFullscreen?.().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fs]);

  const fsBtnToggle = useRef(false);
  useEffect(() => {
    const onFsChange = () => {
      // If the user presses Esc to exit the browser fullscreen, also close the
      // in-app overlay. (Skip when the exit came from our own toggle button.)
      if (!document.fullscreenElement && fs && !fsBtnToggle.current) {
        closeFs();
      }
      fsBtnToggle.current = false;
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fs]);

  useEffect(() => {
    if (!fs) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          closeFs();
          break;
        case " ":
          e.preventDefault();
          toggle();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seek(Math.max(0, curTime - 5));
          break;
        case "ArrowRight":
          e.preventDefault();
          seek(Math.min(duration || 0, curTime + 5));
          break;
        case "ArrowUp":
          e.preventDefault();
          changeVol(Math.min(1, (muted ? 0 : volume) + 0.05));
          break;
        case "ArrowDown":
          e.preventDefault();
          changeVol(Math.max(0, (muted ? 0 : volume) - 0.05));
          break;
        case "m":
        case "M":
          e.preventDefault();
          if (controlled) player.toggleMute();
          else setLMuted(!muted);
          break;
        case "f":
        case "F":
          e.preventDefault();
          fsBtnToggle.current = true;
          if (document.fullscreenElement) document.exitFullscreen?.();
          else fsWrapRef.current?.requestFullscreen?.();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fs, curTime, duration, volume, muted, controlled, toggle, seek, changeVol, closeFs]);

  const handleMouseMove = () => {
    if (!fs) return;
    setShowControls(true);
    window.clearTimeout(controlsTimeout.current);
    if (playing) {
      controlsTimeout.current = window.setTimeout(() => setShowControls(false), 2500);
    }
  };

  useEffect(() => {
    if (!fs) return;
    if (!playing) {
      setShowControls(true);
      window.clearTimeout(controlsTimeout.current);
    } else {
      controlsTimeout.current = window.setTimeout(() => setShowControls(false), 2500);
    }
    return () => window.clearTimeout(controlsTimeout.current);
  }, [playing, fs]);

  const fullscreen = (
    <div
      ref={fsWrapRef}
      className={`fixed inset-0 z-[100] flex flex-col animate-fade-in bg-black/95 select-none ${showControls ? "" : "cursor-none"}`}
      onMouseMove={handleMouseMove}
      onClick={handleMouseMove}
    >
      {/* Blurred cover-art backdrop (Apple-style glass effect) */}
      {cur && !bgFailed && (
        <div className="absolute inset-0 overflow-hidden">
          <img
            src={thumbUrl(cur)}
            alt=""
            key={cur.path}
            className="absolute inset-0 h-full w-full object-cover blur-3xl scale-125 opacity-50"
            onError={() => setBgFailed(true)}
          />
          {/* Frosted glass layer on top of the blurred art */}
          <div className="absolute inset-0 glass backdrop-blur-2xl bg-surface/40" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/60 to-black/90" />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/50 to-black/90" />

      {/* Top bar */}
      <div className={`absolute top-0 inset-x-0 z-30 flex items-center justify-between p-5 sm:p-7 transition-opacity duration-500 ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <button
          onClick={(e) => { e.stopPropagation(); closeFs(); }}
          className="p-3 rounded-full glass-hover text-white transition-transform hover:scale-110"
          title="Close (Esc)"
        >
          <X className="h-6 w-6" />
        </button>
        <span className="text-white/55 text-sm font-medium tracking-wide uppercase">
          {multi ? `Track ${qIndex + 1} of ${queue.length}` : "Now Playing"}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); fsBtnToggle.current = true; document.fullscreenElement ? document.exitFullscreen?.() : fsWrapRef.current?.requestFullscreen?.(); }}
          className="p-3 rounded-full glass-hover text-white transition-transform hover:scale-110"
          title="Toggle screen fullscreen (F)"
        >
          {document.fullscreenElement ? <Minimize2 className="h-6 w-6" /> : <Maximize2 className="h-6 w-6" />}
        </button>
      </div>

      <div className="relative z-10 flex-1 flex flex-col items-center justify-center w-full max-w-2xl mx-auto px-6 h-full pb-8" style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>
        {/* Album Art — spinning vinyl when playing */}
        <div className="relative mb-10">
          <div
            onClick={(e) => { e.stopPropagation(); toggle(); }}
            className={`audio-disc ${playing ? "" : "paused"} relative w-[58vw] max-w-[300px] sm:w-[340px] sm:max-w-[340px] aspect-square rounded-full overflow-hidden shadow-2xl shadow-black/60 ring-1 ring-white/10 transition-transform duration-500 ${playing ? "scale-100" : "scale-95"} cursor-pointer`}
          >
            {cur ? (
              <CoverArt item={cur} className="rounded-full" />
            ) : (
              <div className="h-full w-full grid place-items-center bg-gradient-to-br from-accent/30 to-purple-500/20">
                <Music className="h-24 w-24 text-white/80" />
              </div>
            )}
            {/* Center hole like a record */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/80 ring-1 ring-white/15" />
          </div>
        </div>

        {/* Track Info */}
        <div className="w-full text-center mb-7">
          <h2 className="text-white font-bold text-2xl sm:text-3xl truncate drop-shadow-md">{cur?.name?.replace(/\.[^.]+$/, '')}</h2>
          {cur && getAudioQuality(cur).label && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getAudioQuality(cur).color} bg-white/10 mt-2`}>
              {getAudioQuality(cur).label}
            </span>
          )}
          <p className="text-white/55 text-base truncate font-medium mt-1">
            {cur ? (cur.extension ? cur.extension.replace(/^\./, "").toUpperCase() + " Audio" : "Audio") : ""}
          </p>
        </div>

        <div className={`w-full space-y-2 transition-opacity duration-500 ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`} onClick={(e) => e.stopPropagation()}>
          {/* Progress Bar */}
          <div className="w-full space-y-2">
            <div className="relative h-1.5 rounded-full bg-white/20 overflow-hidden cursor-pointer group">
              <div className="absolute inset-y-0 left-0 progress-fill" style={{ width: `${pct}%` }} />
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={curTime}
                onChange={(e) => seek(Number(e.target.value))}
                className="absolute inset-0 w-full opacity-0 cursor-pointer"
                aria-label="Seek"
              />
            </div>
            <div className="flex justify-between text-xs font-medium text-white/55 font-mono tabular-nums">
              <span>{fmt(curTime)}</span>
              <span>{fmt(duration)}</span>
            </div>
          </div>

        {/* Primary Controls */}
        <div className={`flex items-center justify-center gap-5 sm:gap-7 w-full mt-9 transition-opacity duration-500 ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
          {controlled && (
            <button
              onClick={() => player.setShuffle(!player.shuffle)}
              className={`p-3 rounded-full transition-colors ${player.shuffle ? "text-accent bg-accent/15" : "text-white/70 hover:text-white glass-hover"}`}
              title="Shuffle"
            >
              <Shuffle className="h-6 w-6" />
            </button>
          )}

          <div className="flex items-center gap-5">
            {multi && (
              <button onClick={() => step(-1)} className="p-3 rounded-full glass-hover text-white transition-transform hover:scale-110" title="Previous">
                <SkipBack className="h-7 w-7" />
              </button>
            )}

            <button
              onClick={toggle}
              className="h-20 w-20 rounded-full bg-white text-black grid place-items-center transition-transform hover:scale-105 shadow-xl shadow-white/10 active:scale-95"
              title={playing ? "Pause (Space)" : "Play (Space)"}
            >
              {playing ? <Pause className="h-9 w-9 fill-current" /> : <Play className="h-9 w-9 translate-x-1 fill-current" />}
            </button>

            {multi && (
              <button onClick={() => step(1)} className="p-3 rounded-full glass-hover text-white transition-transform hover:scale-110" title="Next">
                <SkipForward className="h-7 w-7" />
              </button>
            )}
          </div>

          {controlled && (
            <button
              onClick={() => player.cycleRepeat()}
              className={`p-3 rounded-full transition-colors ${player.repeat !== "off" ? "text-accent bg-accent/15" : "text-white/70 hover:text-white glass-hover"}`}
              title={`Repeat: ${player.repeat}`}
            >
              {player.repeat === "one" ? <Repeat1 className="h-6 w-6" /> : <Repeat className="h-6 w-6" />}
            </button>
          )}
        </div>

        {/* Secondary row: rate + volume + add to playlist */}
        <div className={`flex items-center justify-center gap-5 sm:gap-6 mt-8 text-white/70 transition-opacity duration-500 ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
          <div className="relative">
            <button
              onClick={() => setShowRates(!showRates)}
              className="text-xs font-mono px-3 py-1.5 rounded-full glass-hover text-white/80 hover:text-white transition-colors"
              title="Playback speed"
            >
              {rate}x
            </button>
            {showRates && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 glass-strong rounded-xl p-1 z-40 flex flex-col animate-scale-in min-w-[64px]">
                {RATES.map((r) => (
                  <button
                    key={r}
                    onClick={() => changeRate(r)}
                    className={`px-4 py-1.5 text-xs font-mono rounded-lg hover:bg-accent/15 ${r === rate ? "text-accent bg-accent/10" : "text-white/80"}`}
                  >
                    {r}x
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Volume */}
          <div className="flex items-center gap-2 group">
            <button
              onClick={() => (controlled ? player.toggleMute() : setLMuted(!muted))}
              className="p-2 rounded-full glass-hover transition-transform hover:scale-110"
              title="Mute (M)"
            >
              {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
            <div className="relative w-24 h-1.5 rounded-full bg-white/20 overflow-hidden cursor-pointer group-hover:w-28 transition-all duration-300">
              <div className="absolute inset-y-0 left-0" style={volFillStyle(volume, muted)} />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(e) => changeVol(Number(e.target.value))}
                className="absolute inset-0 w-full opacity-0 cursor-pointer"
                aria-label="Volume"
              />
            </div>
          </div>

          {cur && (
            <AddToPlaylistMenu items={[cur]} className="p-2.5 rounded-full glass-hover text-white/80 hover:text-white transition-transform hover:scale-110">
              <Plus className="h-5 w-5" />
            </AddToPlaylistMenu>
          )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="w-full max-w-lg mx-auto p-4 flex flex-col items-center">
      <div className="relative aspect-square w-full max-w-[280px] sm:max-w-[320px] rounded-3xl overflow-hidden shadow-2xl ring-1 ring-border/50 group cursor-pointer" onClick={openFs}>
        {cur && <CoverArt item={cur} />}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-300 grid place-items-center">
          <Maximize2 className="h-10 w-10 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300 drop-shadow-lg" />
        </div>
      </div>

      <div className="w-full mt-8 space-y-6 px-2">
        <div className="text-center">
          <h3 className="font-bold text-xl truncate">{cur?.name?.replace(/\.[^.]+$/, '')}</h3>
          {cur && getAudioQuality(cur).label && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getAudioQuality(cur).color} bg-white/10 mt-2`}>
              {getAudioQuality(cur).label}
            </span>
          )}
          <p className="text-content-muted text-sm mt-1">{multi ? `Track ${qIndex + 1} of ${queue.length}` : "Audio playback"}</p>
        </div>
        
        <div className="w-full space-y-2">
          <div className="relative h-2 rounded-full bg-surface-muted overflow-hidden group">
            <div className="absolute inset-y-0 left-0 progress-fill" style={{ width: `${pct}%` }} />
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={curTime}
              onChange={(e) => seek(Number(e.target.value))}
              className="absolute inset-0 w-full opacity-0 cursor-pointer"
              aria-label="Seek"
            />
          </div>
          <div className="flex justify-between text-xs font-medium text-content-muted font-mono">
            <span>{fmt(curTime)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>

        <div className="flex justify-between items-center px-4">
          <div className="relative">
            <button onClick={() => setShowRates(!showRates)} className="text-xs font-mono px-2 py-1 rounded-lg glass-hover text-content-muted hover:text-content">
              {rate}x
            </button>
            {showRates && (
              <div className="absolute bottom-full left-0 mb-2 glass-strong rounded-xl p-1 z-20 flex flex-col animate-scale-in">
                {RATES.map((r) => (
                  <button key={r} onClick={() => changeRate(r)} className={`px-4 py-1.5 text-xs font-mono rounded-lg hover:bg-accent/15 ${r === rate ? "text-accent bg-accent/10" : ""}`}>
                    {r}x
                  </button>
                ))}
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-4">
            {multi && (
              <button onClick={() => step(-1)} className="p-2 rounded-full glass-hover" title="Previous">
                <SkipBack className="h-6 w-6 text-content" />
              </button>
            )}
            <button
              onClick={toggle}
              className="h-14 w-14 rounded-full bg-accent text-accent-fg grid place-items-center shadow-lg shadow-accent/30 hover:scale-105 transition-transform"
              title={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="h-6 w-6 fill-current" /> : <Play className="h-6 w-6 translate-x-0.5 fill-current" />}
            </button>
            {multi && (
              <button onClick={() => step(1)} className="p-2 rounded-full glass-hover" title="Next">
                <SkipForward className="h-6 w-6 text-content" />
              </button>
            )}
          </div>
          
          <div className="group relative flex items-center">
            <button onClick={() => { const m = !muted; if (controlled) player.toggleMute(); else setLMuted(m); }} className="p-2 rounded-full glass-hover" title="Mute">
              {muted || volume === 0 ? <VolumeX className="h-5 w-5 text-content-muted" /> : <Volume2 className="h-5 w-5 text-content-muted hover:text-content" />}
            </button>
            {/* Hover Volume Slider */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 h-24 w-8 glass-strong rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto flex items-end">
              <div className="relative w-full h-full rounded-full bg-surface-muted overflow-hidden">
                <div className="absolute bottom-0 inset-x-0" style={volFillStyleV(volume, muted)} />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : volume}
                  onChange={(e) => changeVol(Number(e.target.value))}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer appearance-none"
                  style={{ writingMode: 'bt-lr', WebkitAppearance: 'slider-vertical' } as any}
                  aria-label="Volume"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {fs && fullscreen}
      {!controlled && <audio ref={ref} src={url} preload="metadata" />}
    </div>
  );
}

function VideoPlayer({ url, item, autoPlay }: { url?: string; item?: FileItem; autoPlay?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(1);
  const [muted, setMuted] = useState(false);
  const [full, setFull] = useState(false);
  const [theater, setTheater] = useState(false);
  const [rate, setRate] = useState(1);
  const [showRates, setShowRates] = useState(false);
  const [subUrl, setSubUrl] = useState<string | null>(null);
  const [errored, setErrored] = useState(false);
  const [erroredMsg, setErroredMsg] = useState<string>("");
  const [src, setSrc] = useState(url);
  const [live, setLive] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [showControls, setShowControls] = useState(true);
  const controlsTimeout = useRef<number>();

  const ext = item?.extension?.toLowerCase() || "";
  const isMkv = ext === "mkv";

  useEffect(() => {
    let cancelled = false;
    if (item && needsTranscode(item)) {
      serverSupportsTranscode().then((ok) => {
        if (cancelled) return;
        if (ok) {
          setSrc(transcodeUrl(item.root_id, item.path));
          setLive(true);
        } else {
          setSrc(url);
          setLive(false);
        }
      });
    } else {
      setSrc(url);
      setLive(false);
    }
    return () => { cancelled = true; };
  }, [url, item]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const onTime = () => setCur(v.currentTime);
    const onMeta = () => { setDur(v.duration); setErrored(false); };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onErr = () => {
      setPlaying(false);
      setErrored(true);
      setErroredMsg(
        live
          ? "Transcoding failed — the file may use a codec ffmpeg can't handle."
          : isMkv
            ? "This .mkv file can't be played in your browser (codec/container not supported)."
            : "This video can't be played in your browser."
      );
    };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("error", onErr);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("error", onErr);
    };
  }, [isMkv, live]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    setErrored(false);
    v.load();
    v.playbackRate = rate;
    setCur(0);
    if (autoPlay) v.play().catch(() => {});
  }, [src, autoPlay]);

  useEffect(() => {
    if (!showRates) return;
    const onClose = () => setShowRates(false);
    window.addEventListener("click", onClose);
    return () => window.removeEventListener("click", onClose);
  }, [showRates]);

  const handleMouseMove = () => {
    setShowControls(true);
    setShowRates(false);
    window.clearTimeout(controlsTimeout.current);
    if (playing) {
      controlsTimeout.current = window.setTimeout(() => setShowControls(false), 2500);
    }
  };

  useEffect(() => {
    if (!playing) {
      setShowControls(true);
      window.clearTimeout(controlsTimeout.current);
    } else {
      controlsTimeout.current = window.setTimeout(() => setShowControls(false), 2500);
    }
  }, [playing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = ref.current;
      if (!v) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      handleMouseMove();
      switch (e.key) {
        case "ArrowLeft": e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 10); break;
        case "ArrowRight": e.preventDefault(); v.currentTime = Math.min(v.duration || 0, v.currentTime + 10); break;
        case "ArrowUp": e.preventDefault(); changeVol(Math.min(1, v.volume + 0.1)); break;
        case "ArrowDown": e.preventDefault(); changeVol(Math.max(0, v.volume - 0.1)); break;
        case " ": e.preventDefault(); toggle(); break;
        case "f": case "F": toggleFull(); break;
        case "t": case "T": setTheater(t => !t); break;
        case "m": case "M": doMute(); break;
        case "Escape": 
           if (full) { e.preventDefault(); exitFull(); }
           else if (theater) { e.preventDefault(); setTheater(false); }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [url, full, theater]);

  useEffect(() => {
    const onFs = () => {
      const isFull = !!document.fullscreenElement;
      setFull(isFull);
      if (isFull) setTheater(false);
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };
  const seek = (val: number) => {
    const v = ref.current;
    if (v) v.currentTime = val;
    setCur(val);
  };
  const changeVol = (val: number) => {
    setVol(val);
    setMuted(val === 0);
    if (ref.current) ref.current.volume = val;
  };
  const doMute = () => {
    const v = ref.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };
  const skip = (d: number) => {
    const v = ref.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + d));
  };
  const changeRate = (r: number) => {
    setRate(r);
    setShowRates(false);
    if (ref.current) ref.current.playbackRate = r;
  };
  const toggleFull = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };
  const exitFull = () => {
    if (document.fullscreenElement) document.exitFullscreen();
  };
  const onSubtitle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    const vtt = f.name.toLowerCase().endsWith(".srt") ? srtToVtt(text) : text;
    const blob = new Blob([vtt], { type: "text/vtt" });
    if (subUrl) URL.revokeObjectURL(subUrl);
    setSubUrl(URL.createObjectURL(blob));
  };

  const pct = dur > 0 ? (cur / dur) * 100 : 0;
  const dlUrl = item ? `/api/v1/files/raw?root=${encodeURIComponent(item.root_id)}&path=${encodeURIComponent(item.path)}&download=1` : (url || "#");

  const wrapClasses = full
    ? "fixed inset-0 z-[100] bg-black"
    : theater
    ? "fixed inset-0 z-40 bg-black/95 backdrop-blur-sm p-4 md:p-8 flex items-center justify-center theater-enter"
    : "relative w-full max-w-5xl mx-auto overflow-hidden shadow-2xl ring-1 ring-border/50 bg-black rounded-2xl";

  return (
    <div
      ref={wrapRef}
      className={`${wrapClasses} ${showControls ? "" : "cursor-none"} select-none`}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => playing && setShowControls(false)}
    >
      {/* Theater mode top bar */}
      {theater && !full && (
        <div className={`absolute top-0 inset-x-0 z-50 flex items-center justify-between p-5 md:p-7 bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-500 ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 rounded-full bg-white/10 backdrop-blur-md text-white text-[11px] font-semibold tracking-wider uppercase">Theater</span>
            <span className="text-white/70 text-sm font-medium truncate hidden sm:block max-w-[300px]">{item?.name}</span>
          </div>
          <button onClick={() => setTheater(false)} className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md text-white transition-all hover:scale-105" title="Close Theater (Esc)">
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Top Bar for Fullscreen */}
      {full && showControls && (
        <div className="absolute top-0 inset-x-0 z-10 flex items-center gap-4 p-6 bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-300">
          <button onClick={exitFull} className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md text-white text-sm font-medium transition-colors" title="Back / Exit">
            <ArrowLeft className="h-5 w-5" /> Exit Fullscreen
          </button>
          <span className="text-white font-semibold truncate drop-shadow-md text-lg">{item?.name}</span>
        </div>
      )}

      <video
        ref={ref}
        src={src}
        controls={false}
        autoPlay={autoPlay}
        className={full ? "w-full h-full object-contain" : theater ? "w-full h-full max-h-screen object-contain rounded-xl shadow-2xl" : "w-full aspect-video object-cover hover:object-contain transition-all duration-500"}
        onClick={toggle}
      >
        {subUrl && <track kind="subtitles" src={subUrl} srcLang="en" label="Subtitles" default />}
      </video>

      {errored ? (
        <div className="absolute inset-0 grid place-items-center bg-black/90 p-8 text-center backdrop-blur-sm">
          <div className="max-w-md animate-scale-in">
            <div className="h-16 w-16 rounded-full bg-danger/20 text-danger grid place-items-center mx-auto mb-4">
              <MonitorPlay className="h-8 w-8" />
            </div>
            <p className="text-white font-bold text-xl mb-3">{erroredMsg}</p>
            <p className="text-white/70 text-sm mb-6 leading-relaxed">
              {isMkv
                ? "Matroska container (.mkv) is not natively supported by your browser. Try downloading the file or using a Chromium-based browser."
                : "The file may be corrupt or encoded with an unsupported codec."}
            </p>
            <Button variant="primary" onClick={() => window.location.href = dlUrl} icon={<Download className="h-4 w-4" />}>
              Download File
            </Button>
          </div>
        </div>
      ) : (
        <div className={`absolute inset-x-0 bottom-0 p-5 md:p-7 bg-gradient-to-t from-black/95 via-black/70 to-transparent transition-all duration-300 ${showControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"}`}>
          {/* Timeline */}
          {live ? (
            <div className="relative h-1.5 rounded-full bg-white/20 overflow-hidden mb-4">
              <div className="n-progress-indeterminate bg-accent" />
            </div>
          ) : (
            <div className="relative h-2 rounded-full bg-white/30 overflow-hidden mb-5 cursor-pointer group hover:h-2.5 transition-all">
              <div className="absolute inset-y-0 left-0 bg-accent transition-all duration-100" style={{ width: `${pct}%` }} />
              <input
                type="range"
                min={0}
                max={dur || 0}
                step={0.1}
                value={cur}
                onChange={(e) => seek(Number(e.target.value))}
                className="absolute inset-0 w-full opacity-0 cursor-pointer"
                aria-label="Seek"
              />
              <div className="absolute top-0 h-full bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" style={{ left: `${pct}%`, width: "2px" }} />
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center gap-2 md:gap-4 text-white">
            {/* Play/Pause */}
            <button onClick={toggle} className="p-2 md:p-3 rounded-full hover:bg-white/15 hover:scale-105 active:scale-95 transition-all" title={playing ? "Pause (Space)" : "Play (Space)"}>
              {playing ? <Pause className="h-7 w-7 md:h-9 md:w-9 fill-current" /> : <Play className="h-7 w-7 md:h-9 md:w-9 fill-current translate-x-0.5" />}
            </button>

            {/* Skip Back */}
            <button onClick={() => skip(-10)} className="p-2 rounded-full hover:bg-white/15 hover:scale-105 transition-all hidden sm:block" title="Back 10s (Left Arrow)">
              <Rewind className="h-5 w-5 md:h-6 md:w-6" />
            </button>
            {/* Skip Forward */}
            <button onClick={() => skip(10)} className="p-2 rounded-full hover:bg-white/15 hover:scale-105 transition-all hidden sm:block" title="Forward 10s (Right Arrow)">
              <FastForward className="h-5 w-5 md:h-6 md:w-6" />
            </button>

            {/* Volume */}
            <div className="flex items-center gap-2 group ml-1">
              <button onClick={doMute} className="p-2 rounded-full hover:bg-white/15 transition-colors" title="Mute (M)">
                {muted || vol === 0 ? <VolumeX className="h-5 w-5 md:h-6 md:w-6 opacity-50" /> : <Volume2 className="h-5 w-5 md:h-6 md:w-6" />}
              </button>
              <div className="relative h-1.5 w-0 md:w-20 lg:w-24 group-hover:w-20 lg:group-hover:w-24 transition-all duration-300 rounded-full bg-white/30 overflow-hidden cursor-pointer">
                <div className="absolute inset-y-0 left-0 bg-white group-hover:bg-accent transition-colors" style={{ width: `${(muted ? 0 : vol) * 100}%` }} />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : vol}
                  onChange={(e) => changeVol(Number(e.target.value))}
                  className="absolute inset-0 w-full opacity-0 cursor-pointer"
                  aria-label="Volume"
                />
              </div>
            </div>

            {/* Time */}
            <span className="text-xs md:text-sm font-semibold font-mono tabular-nums ml-1">
              <span className="text-white/90">{fmt(cur)}</span>
              <span className="text-white/40"> / {fmt(dur)}</span>
              {live && <span className="text-accent ml-1.5 font-bold">LIVE</span>}
            </span>

            <div className="flex-1" />

            {/* Playback Speed */}
            <div className="relative">
              <button onClick={(e) => { e.stopPropagation(); setShowRates(!showRates); }} className="px-3 py-1.5 rounded-lg text-xs font-bold font-mono hover:bg-white/15 transition-colors" title="Playback speed">
                {rate}x
              </button>
              {showRates && (
                <div className="absolute bottom-full right-0 mb-2 glass-strong rounded-xl p-1 z-50 flex flex-col animate-scale-in min-w-[72px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
                  {RATES.map((r) => (
                    <button
                      key={r}
                      onClick={() => changeRate(r)}
                      className={`px-4 py-1.5 text-xs font-mono rounded-lg hover:bg-accent/15 transition-colors ${r === rate ? "text-accent bg-accent/10 font-bold" : "text-white/80"}`}
                    >
                      {r}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Subtitles */}
            <button onClick={() => fileRef.current?.click()} className={`p-2 rounded-full hover:bg-white/15 transition-colors ${subUrl ? "text-accent" : ""}`} title="Load subtitles (.vtt/.srt)">
              <Captions className="h-5 w-5 md:h-6 md:w-6" />
            </button>
            <input ref={fileRef} type="file" accept=".vtt,.srt" className="hidden" onChange={onSubtitle} />

            {/* Theater Mode */}
            {!full && (
              <button onClick={() => setTheater(t => !t)} className={`p-2 rounded-full hover:bg-white/15 transition-colors hidden md:block ${theater ? "text-accent bg-white/10" : ""}`} title="Theater Mode (T)">
                <MonitorPlay className="h-5 w-5 md:h-6 md:w-6" />
              </button>
            )}

            {/* Fullscreen */}
            <button onClick={toggleFull} className="p-2 md:p-3 rounded-full hover:bg-white/15 hover:scale-105 transition-all" title="Fullscreen (F)">
              {full ? <Minimize2 className="h-5 w-5 md:h-6 md:w-6" /> : <Maximize2 className="h-5 w-5 md:h-6 md:w-6" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
