import { useCallback, useEffect, useState } from "react";

/**
 * Full-screen audio-player style preference.
 *   "vinyl"    — classic spinning vinyl disc + tonearm (default)
 *   "cassette" — vintage cassette deck with loading/eject animations
 *
 * Persisted to localStorage like the other UI prefs (accent theme,
 * native audio) — this is a per-browser preference, not server state.
 * Changes broadcast a custom event so an open full-screen player switches
 * style immediately without a reload.
 */
export type PlayerStyle = "vinyl" | "cassette";

const STYLE_KEY = "nexora.playerStyle";
const STYLE_EVENT = "nexora:player-style";

export function getPlayerStyle(): PlayerStyle {
  return localStorage.getItem(STYLE_KEY) === "cassette" ? "cassette" : "vinyl";
}

export function setPlayerStyle(style: PlayerStyle) {
  localStorage.setItem(STYLE_KEY, style);
  window.dispatchEvent(new CustomEvent<PlayerStyle>(STYLE_EVENT, { detail: style }));
}

export function usePlayerStyle(): [PlayerStyle, (s: PlayerStyle) => void] {
  const [style, setStyle] = useState<PlayerStyle>(getPlayerStyle);

  useEffect(() => {
    // Same-tab (Settings modal) and cross-tab sync.
    const onCustom = (e: Event) => setStyle((e as CustomEvent<PlayerStyle>).detail);
    const onStorage = (e: StorageEvent) => {
      if (e.key === STYLE_KEY) setStyle(getPlayerStyle());
    };
    window.addEventListener(STYLE_EVENT, onCustom);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(STYLE_EVENT, onCustom);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const update = useCallback((s: PlayerStyle) => {
    setPlayerStyle(s);
    setStyle(s);
  }, []);

  return [style, update] as const;
}
