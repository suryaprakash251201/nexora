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
} from "lucide-react";
import type { FileItem } from "../api/types";
import { thumbUrl, needsTranscode, transcodeUrl, serverSupportsTranscode } from "../lib/preview";
import { usePlayer } from "../store/player";
import { AddToPlaylistMenu } from "./PlaylistAdder";

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

function CoverArt({ item, className }: { item: FileItem; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className={`h-full w-full grid place-items-center bg-gradient-to-br from-accent/30 to-fuchsia-500/20 ${className || ""}`}>
        <Music className="h-20 w-20 text-white/80" />
      </div>
    );
  }
  return (
    <img
      src={thumbUrl(item)}
      alt=""
      className={`h-full w-full object-cover ${className || ""}`}
      onError={() => setFailed(true)}
    />
  );
}

function Equalizer({ playing }: { playing: boolean }) {
  return (
    <div className={`flex items-end gap-1 h-5 ${playing ? "" : "opacity-30"}`} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="eq-bar w-1 rounded-full bg-accent"
          style={{ animationDelay: `${i * 0.13}s`, animationPlayState: playing ? "running" : "paused" }}
        />
      ))}
    </div>
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

  const [fs, setFs] = useState(false);
  const [bgFailed, setBgFailed] = useState(false);

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

  const fullscreen = (
    <div className="fixed inset-0 z-[60] flex flex-col audio-fs">
      {cur && !bgFailed && (
        <img src={thumbUrl(cur)} alt="" className="absolute inset-0 h-full w-full object-cover blur-3xl scale-125 opacity-50" onError={() => setBgFailed(true)} />
      )}
      <div className="absolute inset-0 bg-black/45 backdrop-blur-2xl" />
      <button
        onClick={() => setFs(false)}
        className="absolute top-4 right-4 z-20 p-2.5 rounded-full glass-hover text-white"
        title="Exit full screen"
      >
        <Minimize2 className="h-5 w-5" />
      </button>
      <button
        onClick={() => setFs(false)}
        className="absolute top-4 left-4 z-20 flex items-center gap-2 px-3 py-2 rounded-full glass-hover text-white text-sm"
        title="Back"
      >
        <ArrowLeft className="h-5 w-5" /> Back
      </button>

      <div className="relative z-10 flex-1 flex flex-col items-center justify-center gap-8 w-full max-w-md mx-auto px-6">
        <div className={`audio-disc ${playing ? "" : "paused"} relative aspect-square w-64 sm:w-80 rounded-full overflow-hidden shadow-2xl ring-1 ring-white/15`}>
          {cur ? <CoverArt item={cur} /> : (
            <div className="h-full w-full grid place-items-center bg-gradient-to-br from-accent/30 to-fuchsia-500/20">
              <Music className="h-20 w-20 text-white/80" />
            </div>
          )}
        </div>

        <div className="w-full text-center">
          <p className="text-white font-semibold text-lg truncate drop-shadow">{cur?.name}</p>
          <p className="text-white/60 text-sm truncate">
            {multi ? `Track ${qIndex + 1} of ${queue.length}` : "Now Playing"}
          </p>
        </div>

        <div className="w-full">
          <div className="relative h-1.5 rounded-full bg-white/25 overflow-hidden">
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
          <div className="flex justify-between text-xs text-white/70 mt-1.5">
            <span>{fmt(curTime)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>

        <div className="flex items-center justify-center gap-6">
          {multi && (
            <button onClick={() => step(-1)} className="p-2 rounded-full glass-hover text-white" title="Previous">
              <SkipBack className="h-6 w-6" />
            </button>
          )}
          <button
            onClick={toggle}
            className="h-16 w-16 rounded-full accent-glass grid place-items-center"
            title={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7 translate-x-0.5" />}
          </button>
          {multi && (
            <button onClick={() => step(1)} className="p-2 rounded-full glass-hover text-white" title="Next">
              <SkipForward className="h-6 w-6" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-4 w-full">
          {cur && (
            <AddToPlaylistMenu
              items={[cur]}
              className="flex items-center gap-1 px-2 py-1.5 rounded-full glass-hover text-white text-sm"
            >
              <Plus className="h-4 w-4" /> Add to playlist
            </AddToPlaylistMenu>
          )}
          {controlled && (
            <button
              onClick={() => player.setShuffle(!player.shuffle)}
              className={`p-2 rounded-full glass-hover text-white ${player.shuffle ? "text-accent" : ""}`}
              title="Shuffle"
            >
              <Shuffle className="h-5 w-5" />
            </button>
          )}
          {controlled && (
            <button
              onClick={() => player.cycleRepeat()}
              className={`p-2 rounded-full glass-hover text-white ${player.repeat !== "off" ? "text-accent" : ""}`}
              title={`Repeat: ${player.repeat}`}
            >
              {player.repeat === "one" ? <Repeat1 className="h-5 w-5" /> : <Repeat className="h-5 w-5" />}
            </button>
          )}
          <button onClick={() => { const m = !muted; if (controlled) player.toggleMute(); else setLMuted(m); }} className="p-2 rounded-full glass-hover text-white" title="Mute">
            {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
          <div className="relative h-1.5 flex-1 rounded-full bg-white/25 overflow-hidden">
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
    </div>
  );

  return (
    <div className="w-full max-w-lg mx-auto p-2">
      <div className="audio-card relative aspect-square w-full max-w-xs mx-auto rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10">
        {cur && <CoverArt item={cur} />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <button
          onClick={() => setFs(true)}
          className="absolute top-3 right-3 z-10 p-2 rounded-full glass-hover text-white"
          title="Full screen"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
        <div className="absolute bottom-0 left-0 right-0 p-4 text-white flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold truncate drop-shadow">{cur?.name}</p>
            <p className="text-xs text-white/70 truncate">{multi ? `Track ${qIndex + 1} of ${queue.length}` : "Audio"}</p>
          </div>
          <Equalizer playing={playing} />
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
          {cur && (
            <AddToPlaylistMenu
              items={[cur]}
              className="flex items-center gap-1 px-2 py-1.5 rounded-full glass-hover text-sm"
            >
              <Plus className="h-4 w-4" /> Add to playlist
            </AddToPlaylistMenu>
          )}
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
  const [subUrl, setSubUrl] = useState<string | null>(null);
  const [errored, setErrored] = useState(false);
  const [erroredMsg, setErroredMsg] = useState<string>("");
  const [src, setSrc] = useState(url);
  const [live, setLive] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const ext = item?.extension?.toLowerCase() || "";
  const isMkv = ext === "mkv";

  // Choose the playback source: unsupported containers (e.g. .mkv) are sent
  // through the server-side ffmpeg transcoder when available; otherwise we
  // fall back to the raw file (native attempt) and rely on the error fallback.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setCur(0);
    if (autoPlay) v.play().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Keyboard shortcuts: arrows seek/volume, space play/pause, f fullscreen, m mute, esc exit fs.
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
        case "Escape": if (full) exitFull(); break;
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

  return (
    <div
      ref={wrapRef}
      className={`relative w-full ${full ? "video-fullscreen" : "max-w-4xl mx-auto"}`}
    >
      {/* OTT-style top bar (visible in fullscreen) */}
      {full && (
        <div className="absolute top-0 inset-x-0 z-10 flex items-center gap-3 p-4 bg-gradient-to-b from-black/70 to-transparent">
          <button onClick={exitFull} className="flex items-center gap-2 px-3 py-2 rounded-full glass-hover text-white text-sm" title="Back / Exit">
            <ArrowLeft className="h-5 w-5" /> Back
          </button>
          <span className="text-white/90 font-medium truncate drop-shadow">{item?.name}</span>
          <div className="flex-1" />
          <button onClick={exitFull} className="p-2 rounded-full glass-hover text-white" title="Exit full screen">
            <Minimize2 className="h-5 w-5" />
          </button>
        </div>
      )}

      <video
        ref={ref}
        src={src}
        controls={false}
        autoPlay={autoPlay}
        className={full ? "w-full h-[100dvh] max-h-none bg-black" : "w-full max-h-[70vh] bg-black rounded-xl"}
        onClick={toggle}
      >
        {subUrl && <track kind="subtitles" src={subUrl} srcLang="en" label="Subtitles" default />}
      </video>

      {errored ? (
        <div className="absolute inset-0 grid place-items-center bg-black/85 rounded-xl p-6 text-center">
          <div className="max-w-sm">
            <p className="text-white font-medium mb-2">{erroredMsg}</p>
            <p className="text-white/60 text-sm mb-4">
              {isMkv
                ? "Try a browser that supports Matroska (e.g. Chromium-based), or download the file to play it in an external player."
                : "The file may be corrupt or use an unsupported codec."}
            </p>
            <a href={dlUrl} className="inline-flex items-center gap-2 px-4 py-2 rounded-full accent-glass" download>
              Download file
            </a>
          </div>
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/70 to-transparent rounded-b-xl">
          {live ? (
            <div className="h-1.5 rounded-full bg-white/25 overflow-hidden mb-2">
              <div className="n-progress-indeterminate absolute inset-y-0 left-0 bg-accent" />
            </div>
          ) : (
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
          )}
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
            <span className="text-xs tabular-nums">{live ? `${fmt(cur)} • LIVE` : `${fmt(cur)} / ${fmt(dur)}`}</span>
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
              {full ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
