import { useEffect, useRef } from "react";
import { useWaveform } from "./hooks/useWaveform";

interface Props {
  rootId: string;
  path: string;
  currentTime: number;
  duration: number;
  onSeek: (t: number) => void;
  height?: number;
  className?: string;
}

/**
 * WaveformDisplay renders per-bucket peak data (from /audio/waveform) on a
 * canvas with a playhead and click/tap-to-seek. Falls back to a skeleton
 * shimmer while loading, and to a plain progress bar if the server cannot
 * produce a waveform.
 */
export default function WaveformDisplay({
  rootId,
  path,
  currentTime,
  duration,
  onSeek,
  height = 56,
  className = "",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { data, loading } = useWaveform(rootId, path);

  const durationRef = useRef(duration);
  durationRef.current = duration;
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;

  // Redraw whenever peaks, time, or duration change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || canvas.width;
    const h = rect.height || height;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const dur = durationRef.current;
    const cur = currentTimeRef.current;
    const pct = dur > 0 ? Math.min(1, cur / dur) : 0;
    const playedX = w * pct;

    if (data && data.peaks.length > 0) {
      const peaks = data.peaks;
      const n = peaks.length;
      const slot = w / n;
      const mid = h / 2;
      // Background (unplayed) bars — subtle slate.
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      for (let i = 0; i < n; i++) {
        const amp = Math.max(0.03, peaks[i]);
        const bh = Math.max(1, amp * h * 0.92);
        const x = i * slot + (slot - Math.max(1, slot - 1)) / 2;
        const bw = Math.max(1, slot - 1);
        ctx.fillRect(x, mid - bh / 2, bw, bh);
      }
      // Played portion — accent gradient.
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, "#5B8CFF");
      grad.addColorStop(1, "#A78BFA");
      ctx.fillStyle = grad;
      const playedCols = Math.max(1, Math.floor(pct * n));
      for (let i = 0; i < playedCols && i < n; i++) {
        const amp = Math.max(0.03, peaks[i]);
        const bh = Math.max(1, amp * h * 0.92);
        const x = i * slot + (slot - Math.max(1, slot - 1)) / 2;
        const bw = Math.max(1, slot - 1);
        ctx.fillRect(x, mid - bh / 2, bw, bh);
      }
    } else {
      // Fallback: plain progress bar.
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(91,140,255,0.9)";
      ctx.fillRect(0, 0, playedX, h);
    }

    // Playhead.
    if (pct > 0) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(playedX - 1, 0, 2, h);
      ctx.beginPath();
      ctx.arc(playedX, h / 2, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
    }
  }, [data, currentTime, duration, height]);

  const seekFromEvent = (clientX: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const dur = durationRef.current;
    if (dur > 0) onSeek(Math.max(0, Math.min(dur, x * dur)));
  };

  return (
    <div
      ref={wrapRef}
      className={`relative w-full overflow-hidden rounded-lg select-none ${className}`}
      style={{ height }}
      onClick={(e) => seekFromEvent(e.clientX)}
      onTouchStart={(e) => {
        e.preventDefault();
        seekFromEvent(e.touches[0].clientX);
      }}
      role="slider"
      aria-label="Seek on waveform"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration || 0)}
      aria-valuenow={Math.round(currentTime || 0)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          const delta = e.key === "ArrowRight" ? 5 : -5;
          onSeek(Math.max(0, (durationRef.current || 0) > 0 ? currentTimeRef.current + delta : 0));
        }
      }}
    >
      <canvas ref={canvasRef} className="h-full w-full cursor-pointer" style={{ height }} />
      {loading && (
        <div className="absolute inset-0 flex items-center gap-1 px-1 opacity-70">
          {Array.from({ length: 48 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 rounded-full bg-white/10 animate-pulse"
              style={{ height: `${15 + ((i * 7) % 70)}%` }}
            />
          ))}
        </div>
      )}
      {!loading && !data && (
        <div className="absolute inset-0 grid place-items-center text-[10px] font-medium text-white/35 pointer-events-none">
          waveform unavailable
        </div>
      )}
    </div>
  );
}
