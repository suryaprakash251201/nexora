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
  ExternalLink,
  Info,
  ListMusic,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import type { FileItem } from "../api/types";
import { thumbUrl, needsTranscode, transcodeUrl, audioTranscodeUrl, serverSupportsTranscode, rawUrl, generateSessionId, isLosslessExtension, needsAudioTranscode, getAudioQuality } from "../lib/preview";
import type { AudioTranscodeFormat } from "../lib/preview";
import { AudioInfoPanel, EqualizerBars, OutputDevicePicker, useAudioContext } from "./LosslessPlayer";
import { startDownload } from "../lib/transfer";
import { engine, usePlayer } from "../store/player";
import { AddToPlaylistMenu } from "./PlaylistAdder";
import { Button } from "./ui/Button";

const isTauri = "__TAURI_INTERNALS__" in window;

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
  // Uncontrolled players own their <audio> and track errors locally; the
  // controlled (PlayerBar) audio element is shared, so its error lives in the store.
  const [audioError, setAudioErrorLocal] = useState("");
  const storeAudioError = usePlayer((s) => s.audioError);
  const audioErrorMsg = controlled ? storeAudioError : audioError;
  const [showRates, setShowRates] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [lBuffering, setLBuffering] = useState(false);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [browserFs, setBrowserFs] = useState(false);
  // Drag-seek preview position (transcoded streams commit on release).
  const [dragTime, setDragTime] = useState<number | null>(null);
  const dragTimeRef = useRef<number | null>(null);
  const suppressFsExitRef = useRef(false);
  const fsWrapRef = useRef<HTMLDivElement>(null);

  // Smart format routing: native → lossless FLAC (desktop) → flac24 → AAC.
  // Browsers default to AAC; FLAC is the last-resort fallback.
  const [fallbackStage, setFallbackStage] = useState(-1);
  // Transcoded streams are restarted via ?start= (no HTTP Range support).
  const [seekStart, setSeekStart] = useState(0);
  // Uncontrolled players display el.currentTime + offset for transcode streams
  // (?start= resets stream timestamps to 0, so the seek target is re-added).
  const offsetRef = useRef(0);
  const fallbackFormats: AudioTranscodeFormat[] = isTauri ? ["flac", "flac24", "aac"] : ["aac", "flac"];
  const sessionIdRef = useRef(generateSessionId());

  useEffect(() => {
    setFallbackStage(-1);
    setSeekStart(0);
    offsetRef.current = 0;
    setDragTime(null);
    dragTimeRef.current = null;
    if (!controlled) setAudioErrorLocal("");
    // Pre-route codecs the webview cannot decode natively (ALAC inside .m4a/
    // .m4b, WMA, …) straight to the transcode pipeline so they start playing
    // without a failed-play round trip.
    if (!cur) return;
    let cancelled = false;
    needsAudioTranscode(cur).then((needs) => {
      if (!needs || cancelled) return;
      serverSupportsTranscode().then((supp) => {
        if (supp && !cancelled) setFallbackStage(0);
      });
    });
    return () => { cancelled = true; };
  }, [cur?.path, controlled]);

  const resolvedUrl = cur
    ? fallbackStage >= 0
      ? audioTranscodeUrl(cur.root_id, cur.path, {
          session: sessionIdRef.current,
          start: seekStart > 0 ? seekStart : 0,
          format: fallbackFormats[fallbackStage],
          quality: fallbackStage === 0 && isTauri ? "lossless" : undefined,
        })
      : (url || rawUrl(cur.root_id, cur.path))
    : "";

  // ── Global media key shortcuts (Tauri) ─────────────────────
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const handler = (e: Event) => {
      const action = (e as CustomEvent).detail;
      const a = ref.current;
      if (action === "MediaPlay" || action === "MediaPause") {
        // Directional semantics: the play key resumes, the pause key pauses.
        // Toggling both would pause on a stray play key and vice-versa.
        const eng = engine.audio;
        const target = controlled ? eng : a;
        if (!target) return;
        if (action === "MediaPlay") {
          if (target.paused) target.play().catch(() => {});
        } else {
          if (!target.paused) target.pause();
        }
      } else if (action === "MediaStop") {
        if (controlled) {
          if (engine.audio) { engine.audio.pause(); engine.audio.currentTime = 0; }
          return;
        }
        if (a) { a.pause(); a.currentTime = 0; setLCur(0); }
      }
    };
    window.addEventListener("nexora:media", handler);
    return () => window.removeEventListener("nexora:media", handler);
  }, [controlled]);

  useEffect(() => {
    if (controlled) return;
    const a = ref.current;
    if (!a) return;
    // Transcoded streams restart timestamps at 0 (?start=), so re-add the
    // offset to match the position the user actually seeked to.
    const onTime = () => setLCur(a.currentTime + offsetRef.current);
    const onMeta = () => setLDur(a.duration);
    const onPlay = () => setLPlaying(true);
    const onPause = () => setLPlaying(false);
    const onWaiting = () => setLBuffering(true);
    const onReady = () => setLBuffering(false);
    const onEnded = () => step(1);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("waiting", onWaiting);
    a.addEventListener("playing", onReady);
    a.addEventListener("canplay", onReady);
    a.addEventListener("stalled", onWaiting);
    a.addEventListener("ended", onEnded);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("waiting", onWaiting);
      a.removeEventListener("playing", onReady);
      a.removeEventListener("canplay", onReady);
      a.removeEventListener("stalled", onWaiting);
      a.removeEventListener("ended", onEnded);
    };
  }, [url, controlled]);

  useEffect(() => {
    if (controlled) return;
    const a = ref.current;
    if (!a) return;
    a.load();
    // Keep the displayed position (offset-corrected) after reloads — e.g.
    // switching to a transcode fallback or a ?start= seek.
    setLCur(offsetRef.current);
    if (autoPlay) a.play().catch(() => {});
  }, [resolvedUrl, controlled]);

  // Reset the blurred-background error flag whenever the track changes so a
  // failed cover on one track doesn't permanently disable the backdrop.
  useEffect(() => {
    setBgFailed(false);
  }, [cur?.path]);

  // Live spectrum analyser — attaches only while the fullscreen lossless view
  // is open (user gesture), never blocks playback, and falls back to CSS bars.
  const { analyser } = useAudioContext(controlled ? engine.audio : ref.current, fs && !!cur);

  const toggle = () => {
    if (controlled) { player.toggle(); return; }
    const a = ref.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  };
  const seek = (v: number) => {
    if (controlled) { player.seek(v); return; }
    // Transcoded streams don't support HTTP Range; restart via ?start= instead.
    const a = ref.current;
    if (a && a.src.includes("/files/transcode")) {
      offsetRef.current = Math.max(0, v);
      setSeekStart(Math.max(0, v));
      setLCur(v);
      return;
    }
    if (a) a.currentTime = v;
    setLCur(v);
  };
  // Shared handler for click + drag seeking on the progress bar. Transcoded
  // streams restart ffmpeg per seek, so while dragging them we only preview
  // the position and commit the real seek on release.
  const transcodeStream = () => {
    const a = controlled ? engine.audio : ref.current;
    return !!a && a.src.includes("/files/transcode");
  };
  const seekFromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const t = Math.max(0, Math.min(duration || 0, x * (duration || 0)));
    if (transcodeStream()) {
      dragTimeRef.current = t;
      setDragTime(t);
    } else {
      seek(t);
    }
  };
  const commitSeek = (e: React.PointerEvent<HTMLDivElement>) => {
    try { (e.currentTarget as HTMLDivElement).releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
    if (dragTimeRef.current !== null) {
      seek(dragTimeRef.current);
      dragTimeRef.current = null;
      setDragTime(null);
    }
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
  const buffering = controlled ? player.buffering : lBuffering;
  const curTime = controlled ? curT : lCur;
  const duration = controlled ? durT : lDur;
  const volume = controlled ? volV : lVol;
  const muted = controlled ? mutedV : lMuted;
  const rate = controlled ? rateV : lRate;
  const pct = duration > 0 ? ((dragTime ?? curTime) / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? Math.min(100, (bufferedEnd / duration) * 100) : 0;

  // Track how much of the stream is buffered (for the seek-bar indicator).
  useEffect(() => {
    const a = controlled ? engine.audio : ref.current;
    if (!a) return;
    const onProgress = () => {
      try {
        if (a.buffered.length > 0) setBufferedEnd(a.buffered.end(a.buffered.length - 1));
      } catch { /* ignore */ }
    };
    a.addEventListener("progress", onProgress);
    return () => a.removeEventListener("progress", onProgress);
  }, [controlled, fs, cur?.path]);

  const volFillStyle = (v: number, m: boolean) => {
    const pctW = (m ? 0 : v) * 100;
    let bg: string;
    if (m || v === 0) bg = 'var(--color-text-quaternary)';
    else bg = 'linear-gradient(90deg, var(--color-accent), var(--color-accent-secondary))';
    return { width: `${pctW}%`, background: bg, borderRadius: 'inherit', transition: 'all 0.1s ease-out' };
  };
  const openFs = () => {
    setFs(true);
  };

  const closeFs = (exitFullscreen = true) => {
    setFs(false);
    if (exitFullscreen && document.fullscreenElement) {
      suppressFsExitRef.current = true;
      document.exitFullscreen?.().catch(() => {});
    }
    onClose?.();
  };

  // Enter real browser fullscreen on the player overlay itself whenever the
  // fullscreen view opens (click or startFullscreen) — never the whole app.
  useEffect(() => {
    if (!fs) return;
    const id = requestAnimationFrame(() => {
      const el = fsWrapRef.current;
      if (el && el.isConnected && !document.fullscreenElement) {
        el.requestFullscreen?.().catch(() => {});
      }
    });
    return () => cancelAnimationFrame(id);
  }, [fs]);

  // Sync with browser fullscreen: when the user leaves fullscreen via Esc
  // (browsers swallow the Esc keydown while fullscreen, so the key handler
  // alone can't close the overlay), auto-exit the player overlay too.
  useEffect(() => {
    if (!fs) return;
    const onFs = () => {
      const isFull = !!document.fullscreenElement;
      setBrowserFs(isFull);
      if (!isFull) {
        if (suppressFsExitRef.current) {
          suppressFsExitRef.current = false; // intentional exit — keep overlay
        } else {
          closeFs(false); // Esc / external exit — close overlay too
        }
      }
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, [fs, closeFs]);

  useEffect(() => {
    if (!fs) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          closeFs(true); // close overlay + exit fullscreen
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
          // Toggle fullscreen without closing the overlay
          if (document.fullscreenElement) {
            suppressFsExitRef.current = true;
            document.exitFullscreen?.();
          } else {
            fsWrapRef.current?.requestFullscreen?.();
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fs, curTime, duration, volume, muted, controlled, toggle, seek, changeVol, closeFs]);

  const fullscreen = (
    <div
      ref={fsWrapRef}
      className="fixed inset-0 z-[100] flex flex-col animate-fade-in bg-black/95 select-none"
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
      <div className="absolute top-0 inset-x-0 z-30 flex items-center justify-between p-5 sm:p-7">
        <button
          onClick={(e) => { e.stopPropagation(); closeFs(true); }}
          className="p-3 rounded-full glass-hover text-white transition-transform hover:scale-110"
          title="Close player and exit fullscreen"
        >
          <X className="h-6 w-6" />
        </button>
        <span className="text-white/55 text-sm font-medium tracking-wide uppercase">
          {multi ? `Track ${qIndex + 1} of ${queue.length}` : "Now Playing"}
        </span>
        <div className="flex items-center gap-2">
          {queue.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowQueue((v) => !v); }}
              className={`relative p-3 rounded-full glass-hover text-white transition-colors ${showQueue ? "bg-accent/25 text-accent" : "hover:text-white"}`}
              title="Playback queue"
            >
              <ListMusic className="h-6 w-6" />
              {queue.length > 1 && !showQueue && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-black text-[10px] font-bold grid place-items-center">
                  {queue.length}
                </span>
              )}
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (document.fullscreenElement) {
                suppressFsExitRef.current = true;
                document.exitFullscreen?.();
              } else {
                fsWrapRef.current?.requestFullscreen?.();
              }
            }}
            className="p-3 rounded-full glass-hover text-white transition-transform hover:scale-110"
            title="Toggle fullscreen (F)"
          >
            {browserFs ? <Minimize2 className="h-6 w-6" /> : <Maximize2 className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Playback queue drawer */}
      {showQueue && (
        <div className="absolute inset-0 z-40 flex justify-end" onClick={(e) => e.stopPropagation()}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowQueue(false)} />
          <div className="relative w-full max-w-sm h-full bg-black/85 backdrop-blur-xl border-l border-white/10 flex flex-col animate-slide-in-right shadow-2xl">
            <div className="flex items-center justify-between px-4 py-4 border-b border-white/10 flex-shrink-0">
              <div className="flex items-center gap-2">
                <ListMusic className="h-5 w-5 text-accent" />
                <h2 className="text-white font-semibold">Queue</h2>
                <span className="text-xs font-medium text-white/45 bg-white/10 rounded-full px-2 py-0.5">{queue.length}</span>
              </div>
              <button
                onClick={() => setShowQueue(false)}
                className="p-2 rounded-full glass-hover text-white/70 hover:text-white transition-colors"
                title="Close queue"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {queue.length === 0 ? (
              <div className="flex-1 grid place-items-center text-white/40 text-sm px-6 text-center">
                The queue is empty — add tracks to start listening.
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto py-1.5">
                {queue.map((qi, i) => {
                  const isCur = i === qIndex;
                  return (
                    <div
                      key={qi.path + i}
                      className={`group flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${isCur ? "bg-accent/10" : "hover:bg-white/5"}`}
                      onClick={() => {
                        if (controlled) player.setIndex(i);
                        else onSelect?.(i);
                        setShowQueue(false);
                      }}
                    >
                      {/* Play state / index */}
                      <div className="w-6 flex-shrink-0 flex justify-center">
                        {isCur ? (
                          playing ? (
                            <span className="flex items-end gap-0.5 h-4" aria-label="Playing">
                              <span className="w-0.5 h-3 rounded-full bg-accent eq-bar" style={{ animationDelay: "0ms" }} />
                              <span className="w-0.5 h-3 rounded-full bg-accent eq-bar" style={{ animationDelay: "150ms" }} />
                              <span className="w-0.5 h-3 rounded-full bg-accent eq-bar" style={{ animationDelay: "300ms" }} />
                            </span>
                          ) : (
                            <Play className="h-4 w-4 text-accent fill-current" />
                          )
                        ) : (
                          <span className="text-[11px] font-mono text-white/35">{String(i + 1).padStart(2, "0")}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm truncate ${isCur ? "text-white font-medium" : "text-white/75"}`}>
                          {qi.name.replace(/\.[^.]+$/, "")}
                        </p>
                        <p className="text-[11px] text-white/35 truncate mt-0.5">{qi.extension.toUpperCase()} · {qi.path}</p>
                      </div>
                      {controlled && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            player.removeFromQueue(i);
                          }}
                          className="p-1.5 rounded-full text-white/30 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                          title="Remove from queue"
                          aria-label={`Remove ${qi.name} from queue`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="relative z-10 flex-1 flex flex-col items-center justify-center w-full max-w-2xl mx-auto px-4 sm:px-6 pt-4 sm:pt-0 pb-20 sm:pb-8" style={{ paddingBottom: "max(5rem, env(safe-area-inset-bottom))" }}>
        {/* Album Art — spinning vinyl with tonearm */}
        <div className="relative mb-4 sm:mb-10 flex-shrink-0">
          {/* Tonearm — high-detail turntable arm, pivots from bottom-right */}
          <div
            className={`absolute -top-3 -right-3 sm:-top-5 sm:-right-5 z-20 w-24 sm:w-32 h-32 sm:h-40 origin-bottom-right transition-all duration-1000 ease-in-out ${
              playing ? 'rotate-0 translate-x-0 translate-y-0' : 'rotate-[22deg] translate-x-3 -translate-y-3'
            }`}
          >
            <svg viewBox="0 0 70 80" className="w-full h-full drop-shadow-2xl" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="tubeGrad" x1="0%" y1="0%" x2="100%" y2="80%">
                  <stop offset="0%" stopColor="#E5E7EB"/>
                  <stop offset="25%" stopColor="#F3F4F6"/>
                  <stop offset="50%" stopColor="#9CA3AF"/>
                  <stop offset="75%" stopColor="#D1D5DB"/>
                  <stop offset="100%" stopColor="#6B7280"/>
                </linearGradient>
                <linearGradient id="baseGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#6B7280"/>
                  <stop offset="50%" stopColor="#4B5563"/>
                  <stop offset="100%" stopColor="#374151"/>
                </linearGradient>
                <radialGradient id="cwGrad" cx="40%" cy="35%" r="60%">
                  <stop offset="0%" stopColor="#9CA3AF"/>
                  <stop offset="100%" stopColor="#4B5563"/>
                </radialGradient>
                <linearGradient id="headGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#D1D5DB"/>
                  <stop offset="50%" stopColor="#9CA3AF"/>
                  <stop offset="100%" stopColor="#6B7280"/>
                </linearGradient>
                <linearGradient id="cartGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#374151"/>
                  <stop offset="100%" stopColor="#111827"/>
                </linearGradient>
                <filter id="needleGlow">
                  <feGaussianBlur stdDeviation="1" result="blur"/>
                  <feMerge>
                    <feMergeNode in="blur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
              </defs>

              
              <rect x="53" y="62" width="16" height="18" rx="4" fill="url(#baseGrad)"/>
              <rect x="55" y="60" width="12" height="4" rx="2" fill="#4B5563"/>
              
              <ellipse cx="61" cy="78" rx="10" ry="3" fill="#1F2937" opacity="0.6"/>

              
              <rect x="50" y="52" width="18" height="12" rx="6" fill="#374151"/>
              <circle cx="59" cy="58" r="3" fill="#1F2937" stroke="#6B7280" strokeWidth="1"/>
              <circle cx="59" cy="58" r="1" fill="#9CA3AF"/>

              
              <line x1="66" y1="52" x2="68" y2="64" stroke="#9CA3AF" strokeWidth="0.8"/>
              <circle cx="68" cy="66" r="2" fill="#6B7280"/>

              
              <path d="M56 56 Q56 40 44 38 L40 38 Q30 36 24 44 Q18 52 14 48 L12 46 Q10 44 14 40 Q20 32 30 32 L36 32 Q48 34 52 42 L56 54 Z" fill="url(#tubeGrad)" stroke="#6B7280" strokeWidth="0.5"/>
              
              <path d="M54 52 Q52 38 42 36 L38 36 Q30 34 24 42 Q20 48 16 46" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5"/>
              
              <path d="M50 46 Q46 36 38 34 L34 34 Q28 33 22 40" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="2"/>

              
              <rect x="6" y="42" width="14" height="10" rx="3" fill="url(#headGrad)" transform="rotate(-10 13 47)"/>
              
              <rect x="7" y="42" width="12" height="2" rx="1" fill="#1F2937" opacity="0.6" transform="rotate(-10 13 47)"/>
              
              <rect x="10" y="38" width="6" height="5" rx="2" fill="#4B5563" transform="rotate(-10 13 47)"/>
              
              <circle cx="9" cy="46" r="1" fill="#D1D5DB"/>
              <circle cx="17" cy="46" r="1" fill="#D1D5DB"/>

              
              <rect x="8" y="50" width="12" height="8" rx="1.5" fill="url(#cartGrad)" transform="rotate(-10 14 54)"/>
              
              <rect x="8" y="56" width="8" height="3" rx="1" fill="#374151" opacity="0.5" transform="rotate(-10 14 54)"/>
              
              <line x1="14" y1="57" x2="12" y2="64" stroke="#D1D5DB" strokeWidth="1.2" strokeLinecap="round" transform="rotate(-10 14 54)"/>
              
              <line x1="12" y1="64" x2="10.5" y2="69" stroke="#F3F4F6" strokeWidth="1" strokeLinecap="round" filter="url(#needleGlow)"/>
              
              <polygon points="10.5,69 9.5,71 11.5,71" fill="#93C5FD" filter="url(#needleGlow)"/>

              
              <circle cx="57" cy="46" r="7" fill="url(#cwGrad)" stroke="#374151" strokeWidth="0.8"/>
              
              <line x1="54" y1="44" x2="60" y2="44" stroke="#6B7280" strokeWidth="0.5"/>
              
              <line x1="55" y1="42" x2="55" y2="43" stroke="#9CA3AF" strokeWidth="0.5"/>
              <line x1="57" y1="41" x2="57" y2="42" stroke="#9CA3AF" strokeWidth="0.5"/>
              <line x1="59" y1="42" x2="59" y2="43" stroke="#9CA3AF" strokeWidth="0.5"/>

              
              <path d="M56 58 Q64 56 66 48 Q68 40 62 36" fill="none" stroke="#9CA3AF" strokeWidth="0.6" opacity="0.5"/>
            </svg>
          </div>

          {/* Vinyl disc with realistic grooves */}
          <div className="relative">
          <div
            onClick={(e) => { e.stopPropagation(); toggle(); }}
            className={`audio-disc ${playing ? "" : "paused"} relative w-[45vw] max-w-[220px] sm:w-[280px] sm:max-w-[300px] md:w-[340px] md:max-w-[340px] aspect-square rounded-full overflow-hidden shadow-2xl shadow-black/60 ring-1 ring-white/10 transition-transform duration-500 ${playing ? "scale-100" : "scale-95"} cursor-pointer`}
          >
            {cur ? (
              <CoverArt item={cur} className="rounded-full" />
            ) : (
              <div className="h-full w-full grid place-items-center bg-gradient-to-br from-accent/30 to-purple-500/20">
                <Music className="h-24 w-24 text-white/80" />
              </div>
            )}
            {/* Spindle — translucent hub ring + deep centre hole (grooves and
                sheen are painted by the .audio-disc ::before/::after layers) */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[3] h-10 w-10 rounded-full bg-gradient-to-br from-white/25 via-white/5 to-transparent ring-1 ring-white/10 shadow-[inset_0_2px_8px_rgba(0,0,0,0.55)]" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[4] h-4 w-4 rounded-full bg-[#050506] ring-1 ring-white/25 shadow-[inset_0_1px_3px_rgba(0,0,0,0.95),0_0_3px_rgba(255,255,255,0.25)]" />
          </div>

          {/* Lossless wave — image only, placed at the centre of the vinyl
              (static — sits above the spinning disc, doesn't rotate) */}
          {cur && getAudioQuality(cur).isLossless && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none">
              <LosslessWaveGlyph className="w-28 sm:w-36 h-auto drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]" />
            </div>
          )}
          </div>
        </div>

        {/* Track Info */}
        <div className="w-full flex flex-col items-center text-center mb-4 sm:mb-7">
          <h2 className="text-white font-bold text-lg sm:text-2xl md:text-3xl truncate drop-shadow-md">{cur?.name?.replace(/\.[^.]+$/, '')}</h2>
          {cur && (
            <div className="mt-2 flex items-center justify-center gap-2">
              <AudioInfoPanel item={cur} compact />
              <button
                onClick={(e) => { e.stopPropagation(); setShowInfo((v) => !v); }}
                className={`p-1.5 rounded-full glass-hover transition-colors ${showInfo ? "text-accent bg-accent/20" : "text-white/70 hover:text-white"}`}
                title="Audio details"
              >
                <Info className="h-4 w-4" />
              </button>
            </div>
          )}
          {showInfo && cur && (
            <div className="mt-3 flex justify-center animate-scale-in">
              <AudioInfoPanel item={cur} />
            </div>
          )}
        </div>

        <div className="w-full space-y-2" onClick={(e) => e.stopPropagation()}>
          {/* Progress Bar — click + drag-to-seek (pointer events cover mouse/touch/pen) */}
          <div
            className="relative h-2 sm:h-2.5 rounded-full bg-white/20 overflow-hidden cursor-pointer group touch-none"
            onPointerDown={(e) => {
              try { (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
              seekFromPointer(e);
            }}
            onPointerMove={(e) => {
              if (e.buttons === 0) return; // not actively pressed
              seekFromPointer(e);
            }}
            onPointerUp={commitSeek}
            onPointerCancel={() => {
              dragTimeRef.current = null;
              setDragTime(null);
            }}
          >
              {bufferedPct > 0 && (
                <div className="absolute inset-y-0 left-0 bg-white/15 transition-all duration-300" style={{ width: `${bufferedPct}%` }} />
              )}
              <div className="absolute inset-y-0 left-0 progress-fill" style={{ width: `${pct}%` }} />
              {/* No moving thumb: position is shown by the progress fill and the
                  exact timestamps below (drag preview updates them live). */}
            </div>
            <div className="flex justify-between text-xs font-medium text-white/55 font-mono tabular-nums">
              <span>{fmt(dragTime ?? curTime)}</span>
              <span>{fmt(duration)}</span>
            </div>
            {buffering && playing && (
              <div className="flex items-center justify-center gap-2 pt-1.5 text-[11px] font-medium text-white/60">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
                </span>
                Buffering…
              </div>
            )}
        </div>

        {/* Primary Controls — prev/play/next cluster with shuffle/repeat flanking */}
        <div className="flex items-center justify-center gap-4 sm:gap-7 w-full mt-6 sm:mt-9">
          {controlled && (
            <button
              onClick={() => player.setShuffle(!player.shuffle)}
              className={`p-2.5 sm:p-3 rounded-full transition-all duration-200 active:scale-95 ${player.shuffle ? "text-accent bg-accent/15 shadow-[0_0_16px_rgba(91,140,255,0.25)]" : "text-white/70 hover:text-white glass-hover hover:scale-110"}`}
              title="Shuffle"
            >
              <Shuffle className="h-5 w-5 sm:h-6 sm:w-6" />
            </button>
          )}

          <div className="flex items-center gap-3 sm:gap-5">
            {multi && (
              <button onClick={() => step(-1)} className="p-2.5 sm:p-3 rounded-full glass-hover text-white transition-all duration-200 hover:scale-110 active:scale-95" title="Previous">
                <SkipBack className="h-5 w-5 sm:h-6 sm:w-6" />
              </button>
            )}

            <button
              onClick={toggle}
              className="h-16 w-16 sm:h-20 sm:w-20 rounded-full bg-gradient-to-b from-white to-white/90 text-black grid place-items-center transition-all duration-200 hover:scale-105 active:scale-95 shadow-[0_10px_30px_rgba(0,0,0,0.45),0_0_0_1px_rgba(255,255,255,0.25)] hover:shadow-[0_10px_36px_rgba(0,0,0,0.5),0_0_30px_rgba(91,140,255,0.35)]"
              title={playing ? "Pause (Space)" : "Play (Space)"}
            >
              {playing ? <Pause className="h-7 w-7 sm:h-9 sm:w-9 fill-current" /> : <Play className="h-7 w-7 sm:h-9 sm:w-9 translate-x-1 fill-current" />}
            </button>

            {multi && (
              <button onClick={() => step(1)} className="p-2.5 sm:p-3 rounded-full glass-hover text-white transition-all duration-200 hover:scale-110 active:scale-95" title="Next">
                <SkipForward className="h-5 w-5 sm:h-6 sm:w-6" />
              </button>
            )}
          </div>

          {controlled && (
            <button
              onClick={() => player.cycleRepeat()}
              className={`p-2.5 sm:p-3 rounded-full transition-all duration-200 active:scale-95 ${player.repeat !== "off" ? "text-accent bg-accent/15 shadow-[0_0_16px_rgba(91,140,255,0.25)]" : "text-white/70 hover:text-white glass-hover hover:scale-110"}`}
              title={`Repeat: ${player.repeat}`}
            >
              {player.repeat === "one" ? <Repeat1 className="h-5 w-5 sm:h-6 sm:w-6" /> : <Repeat className="h-5 w-5 sm:h-6 sm:w-6" />}
            </button>
          )}
        </div>

        {/* Secondary row: rate + volume + EQ + output device + playlist */}
        <div className="flex items-center justify-center gap-5 sm:gap-6 mt-8 text-white/70">
          {cur && (isLosslessExtension(cur.extension) || playing) && (
            <EqualizerBars analyser={analyser} isPlaying={playing} bars={16} className="h-5 w-14" />
          )}
          <OutputDevicePicker />
          <div className="relative">
            <button
              onClick={() => setShowRates(!showRates)}
              className={`text-xs font-mono px-3 py-1.5 rounded-full transition-all duration-200 active:scale-95 ${showRates ? "text-accent bg-accent/15" : "glass-hover text-white/80 hover:text-white"}`}
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

        {/* Volume — touch-friendly slider with level knob */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => (controlled ? player.toggleMute() : setLMuted(!muted))}
              className={`p-2 rounded-full transition-all duration-200 hover:scale-110 active:scale-95 ${muted || volume === 0 ? "text-white/50" : "glass-hover text-white/80 hover:text-white"}`}
              title="Mute (M)"
            >
              {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
            <div
              className="relative w-28 h-8 flex items-center cursor-pointer touch-action-none"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                changeVol(x);
              }}
              onTouchMove={(e) => {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const x = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
                changeVol(x);
              }}
            >
              <div className="absolute inset-y-3 left-0 right-0 h-2 rounded-full bg-white/20 pointer-events-none">
                <div className="absolute inset-y-0 left-0" style={volFillStyle(volume, muted)} />
                {/* Level knob — the only handle on this control */}
                <div
                  className={`absolute top-1/2 h-3.5 w-3.5 rounded-full shadow-md ring-1 transition-colors ${muted || volume === 0 ? "bg-white/40 ring-white/10" : "bg-white ring-white/30"}`}
                  style={{ left: `${(muted ? 0 : volume) * 100}%`, transform: "translate(-50%, -50%)" }}
                />
              </div>
            </div>
          </div>

          {cur && (
            <button
              onClick={() => startDownload(cur.root_id, cur.path, cur.name)}
              className="p-2.5 rounded-full glass-hover text-white/80 hover:text-white transition-all duration-200 hover:scale-110 active:scale-95"
              title="Download file"
            >
              <Download className="h-5 w-5" />
            </button>
          )}
          {isTauri && cur && (
            <button
              onClick={async () => {
                try {
                  const { open } = await import("@tauri-apps/plugin-shell");
                  await open(rawUrl(cur.root_id, cur.path));
                } catch (e) {
                  console.error("Failed to open externally:", e);
                }
              }}
              className="p-2.5 rounded-full glass-hover text-white/80 hover:text-white transition-all duration-200 hover:scale-110 active:scale-95"
              title="Open in native player"
            >
              <ExternalLink className="h-5 w-5" />
            </button>
          )}
          {cur && (
            <AddToPlaylistMenu items={[cur]} className="p-2.5 rounded-full glass-hover text-white/80 hover:text-white transition-all duration-200 hover:scale-110 active:scale-95">
              <Plus className="h-5 w-5" />
            </AddToPlaylistMenu>
          )}
          </div>

          {audioErrorMsg && (
            <div className="absolute bottom-14 inset-x-0 z-20 flex justify-center px-4">
              <div className="flex items-center gap-3 rounded-2xl bg-black/60 backdrop-blur-md border border-danger/30 px-4 py-3 max-w-md">
                <AlertTriangle className="h-5 w-5 text-danger shrink-0" />
                <p className="text-xs font-medium text-white/90 leading-snug">{audioErrorMsg}</p>
                {multi && (
                  <button
                    onClick={() => usePlayer.getState().next(false)}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-danger/20 text-danger border border-danger/30 text-xs font-semibold hover:bg-danger/30 transition-colors"
                  >
                    Skip track
                  </button>
                )}
              </div>
            </div>
          )}
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
          {cur && (
            <div className="mt-2 flex justify-center">
              <AudioInfoPanel item={cur} compact />
            </div>
          )}
          <p className="text-content-muted text-sm mt-1">{multi ? `Track ${qIndex + 1} of ${queue.length}` : "Audio playback"}</p>
          {audioErrorMsg && (
            <div className="mt-4 flex items-center gap-3 rounded-xl bg-danger/10 border border-danger/20 px-3.5 py-2.5 text-left">
              <AlertTriangle className="h-4 w-4 text-danger shrink-0" />
              <p className="text-xs font-medium text-danger leading-snug">{audioErrorMsg}</p>
              {multi && (
                <button
                  onClick={() => usePlayer.getState().next(false)}
                  className="ml-auto shrink-0 px-2.5 py-1 rounded-lg bg-danger/15 text-danger border border-danger/25 text-xs font-semibold hover:bg-danger/25 transition-colors"
                >
                  Skip
                </button>
              )}
            </div>
          )}
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
          
          <div className="flex items-center gap-2">
            <button onClick={() => { const m = !muted; if (controlled) player.toggleMute(); else setLMuted(m); }} className="p-2 rounded-full glass-hover" title="Mute">
              {muted || volume === 0 ? <VolumeX className="h-5 w-5 text-content-muted" /> : <Volume2 className="h-5 w-5 text-content-muted hover:text-content" />}
            </button>
            <div
              className="relative w-20 h-8 flex items-center cursor-pointer touch-action-none"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                changeVol(x);
              }}
              onTouchMove={(e) => {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const x = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
                changeVol(x);
              }}
            >
              <div className="absolute inset-y-3 left-0 right-0 h-1.5 rounded-full bg-surface-muted overflow-hidden pointer-events-none">
                <div className="absolute inset-y-0 left-0" style={volFillStyle(volume, muted)} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {fs && fullscreen}
      {!controlled && <audio 
        ref={ref} 
        src={resolvedUrl} 
        preload="metadata" 
        playsInline 
        webkit-playsinline="true"
        onError={(e) => {
          const target = e.target as HTMLAudioElement;
          if (target.error && target.error.code === 4 && cur) {
            const next = fallbackStage + 1;
            if (next < fallbackFormats.length) {
              serverSupportsTranscode().then(supp => {
                if (supp) {
                  console.warn(`MediaPlayer: stream failed (stage ${fallbackStage}), trying ${fallbackFormats[next]}...`);
                  setAudioErrorLocal("");
                  setFallbackStage(next);
                } else {
                  setAudioErrorLocal(`Could not play "${cur.name}" — audio transcoding is unavailable on this server.`);
                }
              });
            } else {
              setAudioErrorLocal(`Could not play "${cur.name}" in any available format.`);
            }
          }
        }}
      />}
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

/** LosslessWaveGlyph — the lossless sound-wave icon (dark + light variants). */
function LosslessWaveGlyph({ className = "h-2.5 w-auto" }: { className?: string }) {
  return (
    <>
      <img src="/lossless-wave-light.png" alt="" className={`${className} dark:hidden`} />
      <img src="/lossless-wave.png" alt="" className={`${className} hidden dark:block`} />
    </>
  );
}
