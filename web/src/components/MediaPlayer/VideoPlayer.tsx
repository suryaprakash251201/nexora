import { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  X,
  ArrowLeft,
  Captions,
  Rewind,
  FastForward,
  MonitorPlay,
  Download,
  ExternalLink,
} from "lucide-react";
import type { FileItem } from "../../api/types";
import { needsTranscode, transcodeUrl, serverSupportsTranscode, rawUrl } from "../../lib/preview";
import { startDownload } from "../../lib/transfer";
import { Button } from "../ui/Button";
import { fmtTime } from "@nexora/core";

const isTauri = "__TAURI_INTERNALS__" in window;

export function srtToVtt(srt: string): string {
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

export function VideoPlayer({ url, item, autoPlay }: { url?: string; item?: FileItem; autoPlay?: boolean }) {
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
  const controlsTimeout = useRef<number>(0);
  const [fallbackTriggered, setFallbackTriggered] = useState(false);
  const [transcodeSession] = useState(() =>
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : ""
  );
  const isTranscode = src?.includes("/files/transcode");

  // ── Global media key shortcuts (Tauri) ─────────────────────
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const handler = (e: Event) => {
      const action = (e as CustomEvent).detail;
      const v = ref.current;
      if (action === "MediaPlay" && v?.paused) {
        v.play().catch(() => {});
      } else if (action === "MediaPause" && v && !v.paused) {
        v.pause();
      } else if (action === "MediaStop") {
        if (v) { v.pause(); v.currentTime = 0; }
      }
    };
    window.addEventListener("nexora:media", handler);
    return () => window.removeEventListener("nexora:media", handler);
  }, []);

  useEffect(() => {
    let cancelled = false;
    
    if (item && needsTranscode(item)) {
      if (isTauri) {
        // On desktop (WebView2), try direct playback first — it often supports
        // H.264/AAC inside MKV containers natively via the system codecs.
        setSrc(url);
        setLive(false);
        setFallbackTriggered(false);
      } else {
        // Browser: use transcoded stream with session-based seeking.
        // The session ID lets the server kill old ffmpeg processes explicitly.
        serverSupportsTranscode().then((ok) => {
          if (cancelled) return;
          if (ok) {
            setSrc(transcodeUrl(item.root_id, item.path, { session: transcodeSession }));
            setLive(false);
          } else {
            setSrc(url);
            setLive(false);
          }
        });
      }
    } else {
      setSrc(url);
      setLive(false);
    }
    return () => { cancelled = true; };
  }, [url, item]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const onTime = () => {
      setCur(v.currentTime);
      // If direct play failed (readyState>=2 but no video dimensions), fall back to transcoding
      if (!live && !fallbackTriggered && v.readyState >= 2 && v.videoWidth === 0 && item) {
        setFallbackTriggered(true);
        serverSupportsTranscode().then((ok) => {
          if (ok) {
            setSrc(transcodeUrl(item.root_id, item.path, { session: transcodeSession }));
            setLive(true);
          } else {
            setErrored(true);
            setErroredMsg("Cannot play this video format — server transcoding is also unavailable.");
          }
        });
      }
    };
    const onMeta = () => { setDur(v.duration); setErrored(false); };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onErr = () => {
      setPlaying(false);
      setErrored(true);
      setErroredMsg(
        live
          ? "Transcoding failed — the file may contain an unsupported codec. Check the server logs for details."
          : isTauri
            ? "Your system doesn't have the required video codec for this file. Try downloading it instead."
            : "This video can't be streamed directly. If server transcoding is enabled, try again later."
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
  }, [isTauri, live, fallbackTriggered, item]);

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
        case "ArrowLeft": e.preventDefault(); seek(Math.max(0, (v.currentTime || 0) - 10)); break;
        case "ArrowRight": e.preventDefault(); seek(Math.min(v.duration || 0, (v.currentTime || 0) + 10)); break;
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
    if (!v) { setCur(val); return; }

    // For transcoded streams, check if the target time is already buffered.
    // If not, reload the stream from the requested offset so the server
    // (via -ss) starts transcoding from that position.
    if (isTranscode && val > 0 && v.buffered.length > 0) {
      let isBuffered = false;
      for (let i = 0; i < v.buffered.length; i++) {
        if (val >= v.buffered.start(i) && val <= v.buffered.end(i)) {
          isBuffered = true;
          break;
        }
      }
      if (!isBuffered && item) {
        // Target not buffered — instruct server to seek via ?start= parameter.
        // The same session ID is reused so the server kills the old ffmpeg
        // before starting the new one from the requested position.
        setSrc(transcodeUrl(item.root_id, item.path, {
          start: Math.max(0, val - 3), // 3s before target for keyframe rounding
          session: transcodeSession,
        }));
        setCur(0);
        // Video reloads from the new offset; currentTime resets to 0
        // because ffmpeg already starts at the correct position.
        return;
      }
    }

    v.currentTime = val;
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
    seek(Math.max(0, Math.min(v.duration || 0, (v.currentTime || 0) + d)));
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
  const dlUrl = item ? rawUrl(item.root_id, item.path, true) : (url || "#");

  const wrapClasses = full
    ? "fixed inset-0 z-[var(--z-modal)] bg-black"
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
        className={full ? "w-full h-full object-contain" : theater ? "w-full h-full max-h-screen object-contain rounded-xl shadow-2xl" : "w-full max-h-full object-contain transition-all duration-500"}
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
              Try downloading the file to play it locally on your device.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button variant="primary" onClick={() => item ? startDownload(item.root_id, item.path, item.name) : window.location.href = dlUrl} icon={<Download className="h-4 w-4" />}>
                Download File
              </Button>
              {isTauri && (
                <Button 
                  variant="secondary" 
                  onClick={async () => {
                    try {
                      const { open } = await import("@tauri-apps/plugin-shell");
                      await open(dlUrl);
                    } catch (e) {
                      console.error("Failed to open externally:", e);
                    }
                  }} 
                  icon={<ExternalLink className="h-4 w-4" />}
                >
                  Open in Native Player
                </Button>
              )}
            </div>
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
              <span className="text-white/90">{fmtTime(cur)}</span>
              <span className="text-white/40"> / {fmtTime(dur)}</span>
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

            {/* Native Player (Tauri) */}
            {isTauri && (
              <button 
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    const { open } = await import("@tauri-apps/plugin-shell");
                    await open(dlUrl);
                  } catch (e) {
                    console.error("Failed to open externally:", e);
                  }
                }} 
                className="p-2 rounded-full hover:bg-white/15 transition-colors hidden md:block" 
                title="Open in Native Video Player"
              >
                <ExternalLink className="h-5 w-5 md:h-6 md:w-6" />
              </button>
            )}

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

export default VideoPlayer;
