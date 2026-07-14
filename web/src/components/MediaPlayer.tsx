import { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize2,
  Music,
  Shuffle,
  Repeat,
  Repeat1,
  Captions,
  Rewind,
  FastForward,
} from "lucide-react";
import type { FileItem } from "../api/types";
import { thumbUrl } from "../lib/preview";
import { usePlayer } from "../store/player";

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

interface MediaPlayerProps {
  kind: "audio" | "video";
  url?: string;
  item?: FileItem;
  playlist?: FileItem[];
  index?: number;
  onSelect?: (i: number) => void;
  autoPlay?: boolean;
  controlled?: boolean;
}

export default function MediaPlayer({ kind, url, item, playlist, index = 0, onSelect, autoPlay, controlled }: MediaPlayerProps) {
  if (kind === "audio") {
    return <AudioPlayer url={url} item={item} playlist={playlist} index={index} onSelect={onSelect} autoPlay={autoPlay} controlled={controlled} />;
  }
  return <VideoPlayer url={url} item={item} autoPlay={autoPlay} />;
}

function CoverArt({ item }: { item: FileItem }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="h-full w-full grid place-items-center bg-gradient-to-br from-accent/30 to-fuchsia-500/20">
        <Music className="h-20 w-20 text-white/80" />
      </div>
    );
  }
  return (
    <img
      src={thumbUrl(item)}
      alt=""
      className="h-full w-full object-cover"
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
}: {
  url?: string;
  item?: FileItem;
  playlist?: FileItem[];
  index?: number;
  onSelect?: (i: number) => void;
  autoPlay?: boolean;
  controlled?: boolean;
}) {
  const player = usePlayer();
  const cur = controlled ? (player.current() ?? item) : item;
  const isPlaying = controlled ? player.isPlaying : false;
  const curT = controlled ? player.currentTime : 0;
  const durT = controlled ? player.duration : 0;
  const volV = controlled ? player.volume : 1;
  const mutedV = controlled ? player.muted : false;
  const queue = controlled ? player.queue : playlist || [];
  const qIndex = controlled ? player.index : index || 0;
  const multi = queue.length > 1;

  // Non-controlled local playback (standalone use).
  const ref = useRef<HTMLAudioElement>(null);
  const [lPlaying, setLPlaying] = useState(false);
  const [lCur, setLCur] = useState(0);
  const [lDur, setLDur] = useState(0);
  const [lVol, setLVol] = useState(1);
  const [lMuted, setLMuted] = useState(false);

  useEffect(() => {
    if (controlled) return;
    const a = ref.current;
    if (!a) return;
    const onTime = () => setLCur(a.currentTime);
    const onMeta = () => setLDur(a.duration);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("play", () => setLPlaying(true));
    a.addEventListener("pause", () => setLPlaying(false));
    a.addEventListener("ended", () => step(1));
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("play", () => setLPlaying(true));
      a.removeEventListener("pause", () => setLPlaying(false));
      a.removeEventListener("ended", () => step(1));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, controlled]);

  useEffect(() => {
    if (controlled) return;
    const a = ref.current;
    if (!a) return;
    a.load();
    setLCur(0);
    if (autoPlay) a.play().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, controlled]);

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
  const pct = duration > 0 ? (curTime / duration) * 100 : 0;

  return (
    <div className="w-full max-w-lg mx-auto p-2">
      <div className="relative aspect-square w-full max-w-xs mx-auto rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10">
        {cur && <CoverArt item={cur} />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
          <p className="font-semibold truncate drop-shadow">{cur?.name}</p>
          <p className="text-xs text-white/70 truncate">{multi ? `Track ${qIndex + 1} of ${queue.length}` : "Audio"}</p>
        </div>
      </div>

      <div className="mt-4 px-2">
        <div className="relative h-1.5 rounded-full bg-white/20 overflow-hidden">
          <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${pct}%` }} />
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
        <div className="flex justify-between text-xs text-content-muted mt-1">
          <span>{fmt(curTime)}</span>
          <span>{fmt(duration)}</span>
        </div>

        <div className="flex items-center justify-center gap-4 mt-3">
          {multi && (
            <button onClick={() => step(-1)} className="p-2 rounded-full glass-hover" title="Previous">
              <SkipBack className="h-5 w-5" />
            </button>
          )}
          <button
            onClick={toggle}
            className="h-12 w-12 rounded-full accent-glass grid place-items-center"
            title={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 translate-x-0.5" />}
          </button>
          {multi && (
            <button onClick={() => step(1)} className="p-2 rounded-full glass-hover" title="Next">
              <SkipForward className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 mt-4">
          {controlled && (
            <button
              onClick={() => player.setShuffle(!player.shuffle)}
              className={`p-1.5 rounded-full glass-hover ${player.shuffle ? "text-accent" : ""}`}
              title="Shuffle"
            >
              <Shuffle className="h-5 w-5" />
            </button>
          )}
          {controlled && (
            <button
              onClick={() => player.cycleRepeat()}
              className={`p-1.5 rounded-full glass-hover ${player.repeat !== "off" ? "text-accent" : ""}`}
              title={`Repeat: ${player.repeat}`}
            >
              {player.repeat === "one" ? <Repeat1 className="h-5 w-5" /> : <Repeat className="h-5 w-5" />}
            </button>
          )}
          <button onClick={() => { const m = !muted; if (controlled) player.toggleMute(); else setLMuted(m); }} className="p-1.5 rounded-full glass-hover" title="Mute">
            {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
          <div className="relative h-1.5 flex-1 rounded-full bg-white/20 overflow-hidden">
            <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${(muted ? 0 : volume) * 100}%` }} />
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
      </div>

      {!controlled && <audio ref={ref} src={url} preload="metadata" />}
    </div>
  );
}

function VideoPlayer({ url, item, autoPlay }: { url?: string; item?: FileItem; autoPlay?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(1);
  const [muted, setMuted] = useState(false);
  const [full, setFull] = useState(false);
  const [subUrl, setSubUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const onTime = () => setCur(v.currentTime);
    const onMeta = () => setDur(v.duration);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, []);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.load();
    setCur(0);
    if (autoPlay) v.play().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Keyboard shortcuts: arrows seek/volume, space play/pause, f fullscreen, m mute.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = ref.current;
      if (!v) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      switch (e.key) {
        case "ArrowLeft": e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 10); break;
        case "ArrowRight": e.preventDefault(); v.currentTime = Math.min(v.duration || 0, v.currentTime + 10); break;
        case "ArrowUp": e.preventDefault(); changeVol(Math.min(1, v.volume + 0.1)); break;
        case "ArrowDown": e.preventDefault(); changeVol(Math.max(0, v.volume - 0.1)); break;
        case " ": e.preventDefault(); toggle(); break;
        case "f": case "F": toggleFull(); break;
        case "m": case "M": doMute(); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    const onFs = () => setFull(!!document.fullscreenElement);
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
  const toggleFull = () => {
    const v = ref.current;
    if (!v) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else v.requestFullscreen?.();
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

  return (
    <div className={`relative w-full ${full ? "" : "max-w-4xl mx-auto"}`}>
      <video
        ref={ref}
        src={url}
        controls={false}
        autoPlay={autoPlay}
        className="w-full max-h-[70vh] bg-black rounded-xl"
        onClick={toggle}
      >
        {subUrl && <track kind="subtitles" src={subUrl} srcLang="en" label="Subtitles" default />}
      </video>
      <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/70 to-transparent rounded-b-xl">
        <div className="relative h-1.5 rounded-full bg-white/25 overflow-hidden mb-2">
          <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${pct}%` }} />
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
        </div>
        <div className="flex items-center gap-2 text-white">
          <button onClick={() => skip(-10)} className="p-1.5 rounded-full hover:bg-white/15" title="Back 10s">
            <Rewind className="h-5 w-5" />
          </button>
          <button onClick={toggle} className="p-1.5 rounded-full hover:bg-white/15" title={playing ? "Pause" : "Play"}>
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>
          <button onClick={() => skip(10)} className="p-1.5 rounded-full hover:bg-white/15" title="Forward 10s">
            <FastForward className="h-5 w-5" />
          </button>
          <span className="text-xs tabular-nums">{fmt(cur)} / {fmt(dur)}</span>
          <div className="flex-1" />
          <button onClick={() => fileRef.current?.click()} className={`p-1.5 rounded-full hover:bg-white/15 ${subUrl ? "text-accent" : ""}`} title="Load subtitles (.vtt/.srt)">
            <Captions className="h-5 w-5" />
          </button>
          <input ref={fileRef} type="file" accept=".vtt,.srt" className="hidden" onChange={onSubtitle} />
          <button onClick={doMute} className="p-1.5 rounded-full hover:bg-white/15" title="Mute">
            {muted || vol === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
          <div className="relative h-1.5 w-24 rounded-full bg-white/25 overflow-hidden hidden sm:block">
            <div className="absolute inset-y-0 left-0 bg-white" style={{ width: `${(muted ? 0 : vol) * 100}%` }} />
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
          <button onClick={toggleFull} className="p-1.5 rounded-full hover:bg-white/15" title="Fullscreen">
            <Maximize2 className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
