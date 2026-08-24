/**
 * Extracted from AudioPlayer — the compact (non-fullscreen) card view shown
 * by PreviewModal and other embedders. Dumb presentation: all playback
 * behaviour arrives as callbacks so this stays in sync with the store
 * contract owned by AudioPlayer/engine.
 */
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize2,
  AlertTriangle,
} from "lucide-react";
import type { FileItem } from "../../api/types";
import { AudioInfoPanel } from "../LosslessPlayer";
import { fmtTime } from "@nexora/core";
import { CoverArt } from "./CoverArt";

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function MiniPlayer({
  cur,
  openFs,
  multi,
  qIndex,
  queueLength,
  audioErrorMsg,
  pct,
  curTime,
  duration,
  playing,
  rate,
  volume,
  muted,
  onOpenRates,
  showRates,
  onChangeRate,
  onStep,
  onToggle,
  onSeek,
  onToggleMute,
  onChangeVolume,
  volumeFillStyle,
}: {
  cur: FileItem | null;
  openFs: () => void;
  multi: boolean;
  qIndex: number;
  queueLength: number;
  audioErrorMsg: string;
  pct: number;
  curTime: number;
  duration: number;
  playing: boolean;
  rate: number;
  volume: number;
  muted: boolean;
  onOpenRates: () => void;
  showRates: boolean;
  onChangeRate: (r: number) => void;
  onStep: (dir: number) => void;
  onToggle: () => void;
  onSeek: (v: number) => void;
  onToggleMute: () => void;
  onChangeVolume: (v: number) => void;
  /** Shared fill-style factory result from AudioPlayer (gradient + width). */
  volumeFillStyle: React.CSSProperties;
}) {
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
              <AudioInfoPanel item={cur} compact onDark />
            </div>
          )}
          <p className="text-content-muted text-sm mt-1">{multi ? `Track ${qIndex + 1} of ${queueLength}` : "Audio playback"}</p>
          {audioErrorMsg && (
            <div className="mt-4 flex items-center gap-3 rounded-xl bg-danger/10 border border-danger/20 px-3.5 py-2.5 text-left">
              <AlertTriangle className="h-4 w-4 text-danger shrink-0" />
              <p className="text-xs font-medium text-danger leading-snug">{audioErrorMsg}</p>
              {multi && (
                <button
                  onClick={() => onStep(1)}
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
              onChange={(e) => onSeek(Number(e.target.value))}
              className="absolute inset-0 w-full opacity-0 cursor-pointer"
              aria-label="Seek"
            />
          </div>
          <div className="flex justify-between text-xs font-medium text-content-muted font-mono">
            <span>{fmtTime(curTime)}</span>
            <span>{fmtTime(duration)}</span>
          </div>
        </div>

        <div className="flex justify-between items-center px-4">
          <div className="relative">
            <button onClick={onOpenRates} className="text-xs font-mono px-2 py-1 rounded-lg glass-hover text-content-muted hover:text-content">
              {rate}x
            </button>
            {showRates && (
              <div className="absolute bottom-full left-0 mb-2 glass-strong rounded-xl p-1 z-20 flex flex-col animate-scale-in">
                {RATES.map((r) => (
                  <button key={r} onClick={() => onChangeRate(r)} className={`px-4 py-1.5 text-xs font-mono rounded-lg hover:bg-accent/15 ${r === rate ? "text-accent bg-accent/10" : ""}`}>
                    {r}x
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            {multi && (
              <button onClick={() => onStep(-1)} className="p-2 rounded-full glass-hover" title="Previous">
                <SkipBack className="h-6 w-6 text-content" />
              </button>
            )}
            <button
              onClick={onToggle}
              className="h-14 w-14 rounded-full bg-accent text-accent-fg grid place-items-center shadow-lg shadow-accent/30 hover:scale-105 transition-transform"
              title={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="h-6 w-6 fill-current" /> : <Play className="h-6 w-6 translate-x-0.5 fill-current" />}
            </button>
            {multi && (
              <button onClick={() => onStep(1)} className="p-2 rounded-full glass-hover" title="Next">
                <SkipForward className="h-6 w-6 text-content" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button onClick={onToggleMute} className="p-2 rounded-full glass-hover" title="Mute">
              {muted || volume === 0 ? <VolumeX className="h-5 w-5 text-content-muted" /> : <Volume2 className="h-5 w-5 text-content-muted hover:text-content" />}
            </button>
            <div
              className="relative w-20 h-8 flex items-center cursor-pointer touch-action-none"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                onChangeVolume(x);
              }}
              onTouchMove={(e) => {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const x = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
                onChangeVolume(x);
              }}
            >
              <div className="absolute inset-y-3 left-0 right-0 h-1.5 rounded-full bg-surface-muted overflow-hidden pointer-events-none">
                <div className="absolute inset-y-0 left-0" style={volumeFillStyle} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
