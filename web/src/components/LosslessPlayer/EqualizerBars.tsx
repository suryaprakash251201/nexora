import { useEffect, useRef, useState } from "react";

interface Props {
  /** Live analyser when Web Audio is attached; null → CSS-only animation. */
  analyser: AnalyserNode | null;
  isPlaying: boolean;
  bars?: number;
  className?: string;
  barClassName?: string;
}

/**
 * EqualizerBars renders a small animated spectrum. When a real AnalyserNode is
 * available and playing, the bar heights come from getByteFrequencyData();
 * otherwise a deterministic CSS animation runs so the visual is identical for
 * every user (and never risks playback reliability).
 */
export default function EqualizerBars({ analyser, isPlaying, bars = 24, className = "", barClassName = "" }: Props) {
  const [levels, setLevels] = useState<number[]>(() => Array(bars).fill(0.15));
  const rafRef = useRef<number | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const active = !!analyser && isPlaying;

  useEffect(() => {
    if (!active) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    const a = analyser!;
    if (!dataRef.current || dataRef.current.length !== a.frequencyBinCount) {
      dataRef.current = new Uint8Array(new ArrayBuffer(a.frequencyBinCount));
    }
    const data = dataRef.current;

    const tick = () => {
      a.getByteFrequencyData(data);
      const n = bars;
      // Average the spectrum into `n` bands (skip DC + Nyquist edges).
      const usable = Math.floor(data.length * 0.9);
      const step = Math.max(1, Math.floor(usable / n));
      const next: number[] = [];
      for (let i = 0; i < n; i++) {
        const start = Math.min(i * step, data.length - 1);
        const end = Math.min(start + step, data.length);
        let sum = 0;
        let count = 0;
        for (let j = start; j < end; j++) {
          sum += data[j];
          count++;
        }
        next.push(count > 0 ? sum / count / 255 : 0);
      }
      setLevels(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [active, analyser, bars]);

  return (
    <div className={`flex items-end gap-[3px] ${className}`} aria-hidden>
      {Array.from({ length: bars }).map((_, i) => {
        const h = active ? Math.max(0.08, levels[i] ?? 0.15) : 0.15;
        return (
          <div
            key={i}
            className={`w-[3px] rounded-full bg-gradient-to-t from-accent to-accent-secondary ${barClassName}`}
            style={{
              height: `${Math.round(h * 100)}%`,
              transformOrigin: "bottom",
              animation: isPlaying && !active ? `eq-bounce ${0.6 + (i % 5) * 0.12}s ease-in-out ${i * 0.06}s infinite` : undefined,
              opacity: isPlaying ? 1 : 0.35,
              transition: "height 90ms linear, opacity 200ms",
            }}
          />
        );
      })}
    </div>
  );
}
