import { memo, useCallback, useEffect, useRef, useState } from "react";
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
  AlertTriangle,
} from "lucide-react";
import type { FileItem } from "../api/types";
import { usePlayer, engine } from "../store/player";
import { useShallow } from "zustand/react/shallow";
import { thumbUrl, rawUrl, audioTranscodeUrl, generateSessionId, serverSupportsTranscode, isLosslessExtension, isTauriRuntime, needsAudioTranscode, cleanTrackTitle } from "../lib/preview";
import type { AudioTranscodeFormat } from "../lib/preview";
import { AudioInfoPanel, EqualizerBars } from "./LosslessPlayer";
import MediaPlayer from "./MediaPlayer";
import { useClickOutside } from "./hooks/useClickOutside";
import { fmtTime as fmt } from "../lib/format";

function Cover({ item }: { item: FileItem | null }) {
  const [failed, setFailed] = useState(false);
  if (failed || !item) {
    return (
      <div className="h-full w-full grid place-items-center bg-gradient-to-br from-accent/60 to-accent-secondary/60 backdrop-blur-md">
        <Music className="h-5 w-5 text-white/90" />
      </div>
    );
  }
  return <img src={thumbUrl(item)} alt="" className="h-full w-full object-cover transition-transform duration-500 hover:scale-110" onError={() => setFailed(true)} />;
}

export default memo(function PlayerBar() {
  const audioRef = useRef<HTMLAudioElement>(null);
  // Callback ref: re-binds whenever the <audio> element is (re)mounted —
  // e.g. after native playback ends and the html5 element returns — instead
  // of binding only once and losing control of the replacement node.
  const attachAudio = useCallback((el: HTMLAudioElement | null) => {
    if (el) {
      audioRef.current = el;
      engine.bind(el); // idempotent per element
    } else {
      engine.detach(audioRef.current);
      audioRef.current = null;
    }
  }, []);
  const { current, isPlaying, buffering, volume, muted, primaryOpen, currentTime, duration, queueLength, index, shuffle, repeat, audioError } = usePlayer(
    useShallow((s) => ({
      current: s.current(),
      isPlaying: s.isPlaying,
      buffering: s.buffering,
      volume: s.volume,
      muted: s.muted,
      primaryOpen: s.primaryOpen,
      currentTime: s.currentTime,
      duration: s.duration,
      queueLength: s.queue.length,
      index: s.index,
      shuffle: s.shuffle,
      repeat: s.repeat,
      audioError: s.audioError,
    }))
  );
  const [expanded, setExpanded] = useState(false);

  // Volume popup visibility. Hover opens it; a short delayed close bridges the
  // gap between the button and the popup so it doesn't vanish mid-interaction.
  const [volOpen, setVolOpen] = useState(false);
  const volTimer = useRef<number | null>(null);
  const volRef = useRef<HTMLDivElement>(null);
  const openVol = () => {
    if (volTimer.current) {
      window.clearTimeout(volTimer.current);
      volTimer.current = null;
    }
    setVolOpen(true);
  };
  const closeVolSoon = () => {
    if (volTimer.current) window.clearTimeout(volTimer.current);
    volTimer.current = window.setTimeout(() => setVolOpen(false), 250);
  };
  useClickOutside(volRef, () => {
    if (volTimer.current) {
      window.clearTimeout(volTimer.current);
      volTimer.current = null;
    }
    setVolOpen(false);
  });

  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const lossless = current ? isLosslessExtension(current.extension) : false;
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const openExpanded = () => {
    setExpanded(true);
    usePlayer.getState().setPrimaryOpen(true);
    // Real fullscreen is requested by the expanded player itself — MediaPlayer
    // fullscreens only the player overlay, never the whole app.
  };

  // Smart format routing: native → lossless FLAC (desktop) → flac24 → AAC.
  // Browsers stay on the small AAC default and only try FLAC as a last resort
  // (Chromium/WebKit decode FLAC-in-MP4 natively, so it always plays).
  const [fallbackStage, setFallbackStage] = useState(-1);
  /** True while the Tauri native engine owns playback (no <audio> src). */
  const [useNative, setUseNative] = useState(false);
  const [seekStart, setSeekStart] = useState(0);
  const fallbackFormats: AudioTranscodeFormat[] = isTauriRuntime() ? ["flac", "flac24", "aac"] : ["aac", "flac"];
  const sessionIdRef = useRef(generateSessionId());

  // Track-change routing. Order of preference:
  //   1. Native engine (Tauri + nexora-audio) — zero transcode buffering.
  //   2. Browser-native codec (AAC/MP3…) via raw stream.
  //   3. Server transcode pipeline (webview-undecodable codecs).
  useEffect(() => {
    setFallbackStage(-1);
    setSeekStart(0);
    engine.timeOffset = 0;
    usePlayer.getState().setAudioError("");
    if (!current) {
      engine.stopNative();
      setUseNative(false);
      return;
    }
    let cancelled = false;

    (async () => {
      if (isTauriRuntime()) {
        const took = await engine.tryUseNative(current);
        if (cancelled) {
          if (took) void engine.stopNative();
          return;
        }
        if (took) {
          setUseNative(true);
          return;
        }
      }
      setUseNative(false);
      // Legacy pre-route: webview-undecodable codecs go straight to the
      // transcode pipeline instead of failing on the raw stream first.
      needsAudioTranscode(current).then((needs) => {
        if (!needs || cancelled) return;
        serverSupportsTranscode().then((supp) => {
          if (supp && !cancelled) setFallbackStage(0);
        });
      });
    })();

    return () => { cancelled = true; };
  }, [current?.path]);

  // ── Media Session: OS-level now-playing metadata & controls (web) ──
  // The shared <audio> element already gives the OS play/pause awareness;
  // this adds title/artist/artwork plus hardware-key prev/next handling.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      if (!current) {
        ms.metadata = null;
        return;
      }
      const artworkSrc = (() => {
        try { return thumbUrl(current); } catch { return ""; }
      })();
      ms.metadata = new MediaMetadata({
        title: cleanTrackTitle(current.name),
        artist: "Nexora",
        album: current.path?.split("/").slice(0, -1).pop() || "Library",
        ...(artworkSrc ? { artwork: [{ src: artworkSrc, sizes: "512x512", type: "image/jpeg" }] } : {}),
      });
    } catch { /* mediaSession not fully supported — ignore */ }
    try {
      ms.setActionHandler("play", () => usePlayer.getState().toggle());
      ms.setActionHandler("pause", () => usePlayer.getState().toggle());
      ms.setActionHandler("previoustrack", () => usePlayer.getState().prev());
      ms.setActionHandler("nexttrack", () => usePlayer.getState().next(false));
      ms.setActionHandler("seekbackward", () => {
        const t = usePlayer.getState().currentTime;
        usePlayer.getState().seek(Math.max(0, t - 10));
      });
      ms.setActionHandler("seekforward", () => {
        const s = usePlayer.getState();
        s.seek(s.currentTime + 10);
      });
    } catch { /* setActionHandler unsupported — ignore */ }
  }, [current]);

  // Native → html5 fallback signal (engine error path).
  useEffect(() => {
    const onFallback = () => setUseNative(false);
    window.addEventListener("nexora:native-fallback", onFallback);
    return () => window.removeEventListener("nexora:native-fallback", onFallback);
  }, []);

  // Transcoded streams can't be seeked via HTTP Range; route seeks through a
  // ?start= URL rebuild so ffmpeg fast-seeks to the target.
  useEffect(() => {
    engine.onTranscodeSeek = (t) => {
      engine.timeOffset = t;
      setSeekStart(t);
    };
    return () => {
      engine.onTranscodeSeek = null;
    };
  }, []);

  const url = current
    ? fallbackStage >= 0
      ? audioTranscodeUrl(current.root_id, current.path, {
          session: sessionIdRef.current,
          start: seekStart > 0 ? seekStart : 0,
          format: fallbackFormats[fallbackStage],
          quality: fallbackStage === 0 && isTauriRuntime() ? "lossless" : undefined,
        })
      : rawUrl(current.root_id, current.path)
    : "";
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !url) return;
    // Validate the URL scheme — only http(s) and blob are accepted.
    try {
      const parsed = new URL(url, window.location.origin);
      if (!["http:", "https:", "blob:"].includes(parsed.protocol)) {
        console.warn("PlayerBar: rejecting unsafe URL protocol", parsed.protocol);
        return;
      }
    } catch {
      console.warn("PlayerBar: invalid URL", url);
      return;
    }
    a.src = url;
    // Preload aggressively only once playing; while paused, metadata alone
    // warms the connection without downloading a large file in the background.
    a.preload = usePlayer.getState().isPlaying ? "auto" : "metadata";
    a.load();
    if (usePlayer.getState().isPlaying) a.play().catch(() => {});
  }, [url]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying) {
      a.preload = "auto";
      a.play().catch(() => {});
    } else a.pause();
  }, [isPlaying]);

  const stop = () => {
    engine.pause();
    engine.timeOffset = 0;
    usePlayer.setState({ queue: [], index: -1, isPlaying: false, currentTime: 0, duration: 0 });
  };

  // Buffered-range end (for the progress-bar indicator).
  const [bufferedEnd, setBufferedEnd] = useState(0);
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onProgress = () => {
      try {
        if (a.buffered.length > 0) setBufferedEnd(a.buffered.end(a.buffered.length - 1));
      } catch { /* ignore */ }
    };
    a.addEventListener("progress", onProgress);
    return () => a.removeEventListener("progress", onProgress);
  }, []);
  // Buffered data is shown as a capped lookahead from the playhead instead of
  // the whole buffered range: on a fast local server the browser buffers far
  // ahead (often the entire stream), which used to paint the seek bar as
  // "100% buffered". Cap the indicator at 60s ahead of the playhead.
  const elTime = audioRef.current ? audioRef.current.currentTime : 0;
  const bufferedAhead = Math.max(0, bufferedEnd - elTime);
  const bufferedPct = duration > 0 ? Math.min(100, (Math.min(bufferedAhead, 60) / duration) * 100) : 0;

  const handleError = (e: React.SyntheticEvent<HTMLAudioElement, Event>) => {
    const target = e.target as HTMLAudioElement;
    if (!target.error || !current) return;
    if (target.error.code === 4) {
      // SRC_NOT_SUPPORTED → try the next format in the transcode ladder.
      const next = fallbackStage + 1;
      if (next < fallbackFormats.length) {
        serverSupportsTranscode().then((supp) => {
          if (supp) {
            console.warn(`PlayerBar: stream failed (stage ${fallbackStage}), trying ${fallbackFormats[next]}...`);
            usePlayer.getState().setAudioError("");
            setFallbackStage(next);
          } else {
            usePlayer.getState().setAudioError(`Could not play "${current.name}" — audio transcoding is unavailable on this server.`);
          }
        });
      } else {
        usePlayer.getState().setAudioError(`Could not play "${current.name}" in any available format.`);
      }
    } else if (target.error.code === 2) {
      // NETWORK errors previously failed silently — surface them.
      usePlayer.getState().setAudioError("Playback stopped — network error while streaming.");
    } else if (target.error.code === 3) {
      usePlayer.getState().setAudioError("Playback stopped — the audio could not be decoded.");
    }
  };

  const showMini = !primaryOpen || expanded;
  // Only show mini player when music is actually playing or recently active
  const hasActivePlayer = current && (isPlaying || currentTime > 0 || !!audioError);

  return (
    <>
      {!useNative && (
        <audio ref={attachAudio} preload="auto" playsInline webkit-playsinline="true" onError={handleError} />
      )}

      {hasActivePlayer && showMini && !expanded && (
        <div className="fixed bottom-32 md:bottom-6 left-1/2 -translate-x-1/2 z-[var(--z-float)] w-[calc(100%-2rem)] max-w-lg pointer-events-none">
          <div className="pointer-events-auto glass-strong rounded-2xl px-3 py-2.5 shadow-2xl transition-all duration-500 ease-out">
            <div className="flex items-center gap-2">
              <div className={`group relative h-10 w-10 rounded-full overflow-hidden shrink-0 shadow-md transition-all duration-500 ${isPlaying ? 'audio-disc-mini' : ''}`}>
                <Cover item={current} />
                <div className="absolute inset-0 bg-glass-bg-strong opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer rounded-full dark:bg-black/40" onClick={openExpanded}>
                  <ChevronUp className="h-4 w-4 text-white" />
                </div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-black/50 dark:bg-black/80 rounded-full border border-border/20 shadow-inner z-[2]" />
              </div>

              <div className="min-w-0 flex-1 cursor-pointer" onClick={openExpanded}>
                <p className="truncate text-[13px] sm:text-sm font-bold text-content leading-tight hover:text-accent transition-colors">{cleanTrackTitle(current.name)}</p>
                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                  <AudioInfoPanel item={current} compact />
                  {lossless && isPlaying && (
                    <EqualizerBars analyser={null} isPlaying={isPlaying} bars={3} className="h-3 w-6" />
                  )}
                </div>
                <p className="truncate text-[10px] font-medium text-content-muted mt-0.5 flex items-center gap-1.5">
                  {queueLength > 1 && `Track ${index + 1} / ${queueLength}`}
                  {queueLength > 1 && isPlaying ? ' · ' : ''}
                  {isPlaying && buffering ? (
                    <span className="inline-flex items-center gap-1 text-accent animate-pulse">
                      <span className="h-1 w-1 rounded-full bg-accent" />
                      Buffering…
                    </span>
                  ) : isPlaying ? 'Now Playing' : 'Paused'}
                </p>
              </div>

              {audioError && (
                <button
                  onClick={() => usePlayer.getState().next(false)}
                  className="shrink-0 px-2.5 py-1.5 rounded-lg bg-danger/10 text-danger border border-danger/20 text-xs font-medium hover:bg-danger/20 transition-colors"
                  title="Skip to next track"
                >
                  Skip
                </button>
              )}
              <div className="flex items-center gap-0.5 shrink-0">
                <button onClick={() => usePlayer.getState().prev()} className="p-1.5 rounded-full text-content-muted hover:text-content hover:bg-glass-bg transition-colors" title="Previous" aria-label="Previous track">
                  <SkipBack className="h-4 w-4" />
                </button>
                <button
                  onClick={() => usePlayer.getState().toggle()}
                    className={`h-9 w-9 rounded-full grid place-items-center text-white shadow-lg transition-all duration-300 hover:scale-105 active:scale-95
                    ${isPlaying ? 'bg-gradient-to-br from-accent to-accent-secondary shadow-accent/40 player-glow' : 'bg-surface-muted border border-white/20 text-content'}`}
                  title={isPlaying ? "Pause" : "Play"}
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-0.5" />}
                </button>
                <button onClick={() => usePlayer.getState().next(false)} className="p-1.5 rounded-full text-content-muted hover:text-content hover:bg-glass-bg transition-colors" title="Next" aria-label="Next track">
                  <SkipForward className="h-4 w-4" />
                </button>
                <button
                  onClick={() => usePlayer.getState().setShuffle(!shuffle)}
                  aria-pressed={shuffle}
                  aria-label={shuffle ? "Shuffle: On" : "Shuffle: Off"}
                  title={shuffle ? "Shuffle: On" : "Shuffle: Off"}
                  className={`p-1.5 rounded-full transition-all duration-200 ${shuffle ? "text-accent bg-accent/15 shadow-sm" : "text-content-muted hover:text-content hover:bg-glass-bg"}`}
                >
                  <Shuffle className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => usePlayer.getState().cycleRepeat()}
                  aria-pressed={repeat !== "off"}
                  aria-label={`Repeat: ${repeat === "one" ? "One" : repeat === "all" ? "All" : "Off"}`}
                  title={`Repeat: ${repeat === "one" ? "One" : repeat === "all" ? "All" : "Off"}`}
                  className={`relative p-1.5 rounded-full transition-all duration-200 ${repeat !== "off" ? "text-accent bg-accent/15 shadow-sm" : "text-content-muted hover:text-content hover:bg-glass-bg"}`}
                >
                  {repeat === "one" ? <Repeat1 className="h-3.5 w-3.5" /> : <Repeat className="h-3.5 w-3.5" />}
                  {repeat !== "off" && (
                    <span className="absolute -bottom-px left-1/2 -translate-x-1/2 h-[2px] w-1.5 rounded-full bg-accent" />
                  )}
                </button>
                <div
                  ref={volRef}
                  className="group relative flex items-center"
                  onMouseEnter={openVol}
                  onMouseLeave={closeVolSoon}
                >
                  <button
                    onClick={() => usePlayer.getState().toggleMute()}
                    onTouchStart={(e) => {
                      e.preventDefault();
                      openVol();
                    }}
                    aria-label={muted ? "Unmute" : "Mute"}
                    aria-expanded={volOpen}
                    className={`p-1.5 rounded-full transition-colors ${muted ? "text-danger bg-danger/10" : "text-content-muted hover:text-content hover:bg-glass-bg"}`}
                    title={muted ? "Unmute" : "Mute"}
                  >
                    <VolIcon className="h-3.5 w-3.5" />
                  </button>
                  <div
                    onMouseEnter={openVol}
                    className={`absolute bottom-full right-0 mb-2 w-28 glass-strong rounded-lg p-2 transition-opacity duration-150 ${volOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
                  >
                    <div className="relative h-1.5 w-full rounded-full bg-glass-border">
                      <div className="absolute inset-y-0 left-0" style={{
                        width: `${(muted ? 0 : volume) * 100}%`,
                        background: muted || volume === 0 ? 'var(--color-text-quaternary)' : 'linear-gradient(90deg, var(--color-accent), var(--color-accent-secondary))',
                        borderRadius: 'inherit',
                        transition: 'all 0.1s ease-out'
                      }} />
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

            {audioError && (
              <div className="mt-2 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-danger/10 border border-danger/20">
                <AlertTriangle className="h-3.5 w-3.5 text-danger shrink-0" />
                <p className="text-[11px] font-medium text-danger leading-tight truncate">{audioError}</p>
              </div>
            )}
            <div className="mt-2">
              <div className="relative h-1.5 rounded-full bg-white/20 overflow-hidden cursor-pointer group">
                {bufferedPct > 0 && (
                  <div className="absolute inset-y-0 bg-white/15 transition-all duration-300" style={{ left: `${pct}%`, width: `${bufferedPct}%` }} />
                )}
                <div className="absolute inset-y-0 left-0 progress-fill" style={{ width: `${pct}%` }} />
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

      {hasActivePlayer && expanded && (
        <div className="pointer-events-auto relative z-[var(--z-modal)]">
          <MediaPlayer
            kind="audio"
            controlled
            autoPlay
            startFullscreen
            onClose={() => {
              setExpanded(false);
              usePlayer.getState().setPrimaryOpen(false);
              // Defensive: ensure browser fullscreen is exited when closing.
              if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
            }}
          />
        </div>
      )}
    </>
  );
});
