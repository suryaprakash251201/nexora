import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

const KEY = "nexora.prefs";

export type ViewMode = "list" | "grid";
export type PlaybackQuality = "auto" | "lossless" | "high";

export interface Prefs {
  /** Default file view in Browser/Category screens. */
  viewMode: ViewMode;
  /** Playback stream quality for transcoded audio. */
  playbackQuality: PlaybackQuality;
  /** Haptic feedback on taps/actions. */
  haptics: boolean;
}

const DEFAULTS: Prefs = {
  viewMode: "list",
  playbackQuality: "auto",
  haptics: true,
};

// Module-level haptic flag so the sync haptic() helper below can be used
// anywhere without reading React context.
let hapticsEnabled = DEFAULTS.haptics;
export function setHapticsEnabled(v: boolean) {
  hapticsEnabled = v;
}

/** Respects the user's haptics preference. Safe to call from any callback. */
export function haptic(style: "light" | "medium" | "heavy" = "light") {
  if (!hapticsEnabled) return;
  const map = {
    light: Haptics.ImpactFeedbackStyle.Light,
    medium: Haptics.ImpactFeedbackStyle.Medium,
    heavy: Haptics.ImpactFeedbackStyle.Heavy,
  };
  Haptics.impactAsync(map[style]).catch(() => {});
}

interface SettingsContextType {
  prefs: Prefs;
  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  toggleHaptics: () => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<Prefs>;
        setPrefs({ ...DEFAULTS, ...parsed });
        if (typeof parsed.haptics === "boolean") setHapticsEnabled(parsed.haptics);
      })
      .catch(() => {});
  }, []);

  const setPref = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "haptics") setHapticsEnabled(value as boolean);
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const toggleHaptics = useCallback(() => {
    setPrefs((prev) => {
      const next = { ...prev, haptics: !prev.haptics };
      setHapticsEnabled(next.haptics);
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  return (
    <SettingsContext.Provider value={{ prefs, setPref, toggleHaptics }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextType {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
