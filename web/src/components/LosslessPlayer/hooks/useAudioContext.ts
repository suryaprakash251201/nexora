import { useEffect, useRef } from "react";

/**
 * useAudioContext wires an AnalyserNode to the shared <audio> element so the
 * lossless player can render a live frequency spectrum.
 *
 * ⚠️ Important caveat: `createMediaElementSource()` permanently routes the
 * element's output through the AudioContext graph — it can only ever be called
 * once per element and the call cannot be undone. Therefore this hook:
 *
 *   1. Only attaches when `enabled` is true (the fullscreen lossless view is
 *      open — which requires a user gesture to reach).
 *   2. Immediately resumes the context (we are inside a user-gesture path, so
 *      autoplay policy is satisfied).
 *   3. Re-resumes on `visibilitychange` as a safety net, so backgrounded
 *      tabs never silently mute playback.
 *   4. Never retries after a failure — playback reliability wins over the
 *      cosmetic analyser.
 *
 * Returns `{ ctx, analyser }`; both are null when Web Audio is unavailable or
 * the hook decided not to attach. Callers must fall back to CSS animation.
 */
export function useAudioContext(
  audioEl: HTMLAudioElement | null,
  enabled: boolean
): { ctx: AudioContext | null; analyser: AnalyserNode | null } {
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!enabled || doneRef.current) return;
    doneRef.current = true; // attempt at most once per element lifetime

    const audio: HTMLAudioElement | null = audioEl;
    if (!audio) return;

    if ("__TAURI_INTERNALS__" in window) return;

    try {
      const AC: typeof AudioContext | undefined =
        window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;

      const ctx = new AC();
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.82;
      source.connect(analyser);
      analyser.connect(ctx.destination);

      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }

      ctxRef.current = ctx;
      analyserRef.current = analyser;
    } catch {
      // Leave refs null — playback must never break because of the analyser.
      return;
    }

    const keepAlive = () => {
      const c = ctxRef.current;
      if (c && c.state === "suspended") c.resume().catch(() => {});
    };
    document.addEventListener("visibilitychange", keepAlive);
    window.addEventListener("focus", keepAlive);
    return () => {
      document.removeEventListener("visibilitychange", keepAlive);
      window.removeEventListener("focus", keepAlive);
    };
  }, [enabled, audioEl]);

  return { ctx: ctxRef.current, analyser: analyserRef.current };
}
