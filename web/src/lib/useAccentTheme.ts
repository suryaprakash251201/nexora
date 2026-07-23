import { useState, useEffect, useCallback } from "react";

const THEME_KEY = "accent-theme";
const DEFAULT_THEME = "midnight";

export const accentThemes = [
  { id: "midnight", label: "Midnight", desc: "Classic blue", colors: ["#5B8CFF", "#7A5CFF"] },
  { id: "amethyst", label: "Amethyst", desc: "Purple glow", colors: ["#A78BFA", "#F472B6"] },
  { id: "aurora", label: "Aurora", desc: "Teal waves", colors: ["#2DD4BF", "#34D399"] },
  { id: "ember", label: "Ember", desc: "Warm amber", colors: ["#FBBF24", "#FB7185"] },
] as const;

export type AccentTheme = (typeof accentThemes)[number]["id"];

export function setAccentTheme(theme: string) {
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.dataset.theme = theme;
}

export function getAccentTheme(): string {
  return localStorage.getItem(THEME_KEY) || DEFAULT_THEME;
}

export function useAccentTheme() {
  const [accent, setAccentState] = useState(getAccentTheme);

  const update = useCallback((theme: string) => {
    setAccentTheme(theme);
    setAccentState(theme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = accent;
  }, []);

  return [accent, update] as const;
}
