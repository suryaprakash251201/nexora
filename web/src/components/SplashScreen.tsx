import { useEffect, useLayoutEffect, useState } from "react";
import NexoraLogo from "./icons/NexoraLogo";

interface SplashScreenProps {
  /** How long to hold the logo before fading out (ms). Default 2000. */
  minMs?: number;
  /**
   * Persistent mode — used for the in-app "connecting" state.
   * Never auto-fades; shows an infinite shimmer bar instead of the one-shot progress.
   */
  persistent?: boolean;
  /** Caption under the wordmark (default: "Your private file workspace"). */
  caption?: string;
  /** Called once the fade-out finishes (ignored in persistent mode). */
  onDone?: () => void;
}

const FADE_MS = 450;

/**
 * Branded app splash: Nexora logo with a rotating gradient ring, wordmark
 * and a loading bar. Takes over from the static #boot-splash injected in
 * index.html (removed on mount so there is no visual double-flash).
 */
export default function SplashScreen({ minMs = 2000, persistent = false, caption, onDone }: SplashScreenProps) {
  const [phase, setPhase] = useState<"visible" | "fading">("visible");

  // Hand off from the static HTML splash as soon as we're in the DOM.
  useLayoutEffect(() => {
    document.getElementById("boot-splash")?.remove();
  }, []);

  useEffect(() => {
    if (persistent) return;
    const t = setTimeout(() => setPhase("fading"), minMs);
    return () => clearTimeout(t);
  }, [minMs, persistent]);

  useEffect(() => {
    if (phase !== "fading") return;
    const t = setTimeout(() => onDone?.(), FADE_MS);
    return () => clearTimeout(t);
  }, [phase, onDone]);

  return (
    <div className={phase === "fading" ? "splash-screen splash-fading" : "splash-screen"}>
      <div className="flex flex-col items-center gap-7">
        <div className="relative h-32 w-32 grid place-items-center">
          <svg className="splash-ring absolute inset-0 h-full w-full" viewBox="0 0 36 36" aria-hidden="true">
            <defs>
              <linearGradient id="splash-ring-g" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#5B8CFF" />
                <stop offset="55%" stopColor="#8B5CF6" />
                <stop offset="100%" stopColor="#EC4899" />
              </linearGradient>
            </defs>
            <circle
              cx="18"
              cy="18"
              r="16.6"
              fill="none"
              stroke="url(#splash-ring-g)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeDasharray="72 33"
              opacity="0.85"
            />
          </svg>
          <NexoraLogo size={96} className="splash-logo relative" idPrefix="splash" />
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <div className="splash-wordmark">Nexora</div>
          <div className="text-[13px] text-[#8b93a7] tracking-wide">{caption ?? "Your private file workspace"}</div>
        </div>

        {persistent ? (
          <div className="splash-bar-wrap">
            <div className="splash-bar splash-bar-loop" />
          </div>
        ) : (
          <div className="splash-bar-wrap">
            <div className="splash-bar" />
          </div>
        )}
      </div>
    </div>
  );
}
