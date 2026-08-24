import { Platform } from "react-native";

export const darkColors = {
  bg: "#040508", // Deeper, more luxurious dark background
  surface: "#0D0F16", // Slightly elevated
  surfaceElevated: "#151822",
  surfaceMuted: "#11121A",
  card: "rgba(255,255,255,0.03)",
  border: "rgba(255,255,255,0.08)",
  borderSoft: "rgba(255,255,255,0.04)",
  content: "#FFFFFF",
  muted: "#94A3B8",
  accent: "#5B8CFF", // Electric blue — matches web --color-accent
  accentSecondary: "#7A5CFF", // Violet — matches web --color-accent-secondary
  accentTertiary: "#35D3FF", // Cyan — matches web --color-accent-tertiary
  accentSoft: "rgba(91, 140, 255, 0.15)",
  danger: "#F43F5E", // Rose red
  warning: "#F59E0B", // Amber
  success: "#10B981", // Emerald green
  grid: "rgba(255,255,255,0.03)",
  purple: "#A78BFA",
  teal: "#14B8A6",
  cyan: "#35D3FF",
  orange: "#FB923C",
  amber: "#FBBF24",
  green: "#10B981",
  blue: "#5B8CFF",
  red: "#F43F5E",
};

export const lightColors = {
  bg: "#F8FAFC",
  surface: "#FFFFFF",
  surfaceElevated: "#F1F5F9",
  surfaceMuted: "#F3F4F6",
  card: "rgba(0,0,0,0.03)",
  border: "rgba(0,0,0,0.08)",
  borderSoft: "rgba(0,0,0,0.04)",
  content: "#0F172A",
  muted: "#64748B",
  // Deeper blue than the web token so small accent text/icons stay AA on white.
  accent: "#3F6BE0",
  accentSecondary: "#7A5CFF",
  accentTertiary: "#0891B2",
  accentSoft: "rgba(63, 107, 224, 0.12)",
  danger: "#E11D48",
  warning: "#D97706",
  success: "#059669",
  grid: "rgba(0,0,0,0.03)",
  purple: "#7C3AED",
  teal: "#0D9488",
  cyan: "#0891B2",
  orange: "#EA580C",
  amber: "#D97706",
  green: "#059669",
  blue: "#2563EB",
  red: "#E11D48",
};

/**
 * Nexora mobile theme — mirrors the web app's dark palette (index.css)
 * with a richer token set for depth, elevation and focus states.
 */
export const colors = darkColors;

export type GradientTuple = readonly [string, string, ...string[]];

export interface AppGradients {
  brand: GradientTuple;
  brandDeep: GradientTuple;
  hero: GradientTuple;
  player: GradientTuple;
  danger: GradientTuple;
}

/** Gradient stops used across the app (brand, buttons, player). */
export const gradients: AppGradients = {
  brand: ["#5B8CFF", "#7A5CFF", "#35D3FF"],
  brandDeep: ["#1C2650", "#3D53DB"],
  hero: ["rgba(91, 140, 255, 0.16)", "rgba(122, 92, 255, 0.05)", "transparent"],
  player: ["#101B33", "#040508"],
  danger: ["#E11D48", "#9F1239"],
};

export const lightGradients: AppGradients = {
  brand: ["#5B8CFF", "#7A5CFF", "#35D3FF"],
  brandDeep: ["#283593", "#4F46E5"],
  hero: ["rgba(63, 107, 224, 0.08)", "rgba(122, 92, 255, 0.03)", "transparent"],
  player: ["#E2E8F0", "#F8FAFC"],
  danger: ["#E11D48", "#9F1239"],
};

/**
 * Android compact mode — Android phones render the full-size tokens ~10–15%
 * tighter (and Android also applies the system font scale on top), so the
 * home dashboard, grid cards and rows don't balloon the way they do on iOS.
 * iOS keeps the exact original values; these helpers are no-ops there.
 */
const compactFor = (mult: number) => (v: number) =>
  Platform.OS === "android" ? Math.max(1, Math.round(v * mult)) : v;
const compactSpacing = compactFor(0.85);
const compactRadius = compactFor(0.85);
const compactFont = compactFor(0.9);

export const spacing = {
  xs: compactSpacing(6),
  sm: compactSpacing(10),
  md: compactSpacing(14),
  lg: compactSpacing(20),
  xl: compactSpacing(28),
  xxl: compactSpacing(36),
};

export const radius = {
  sm: compactRadius(8),
  md: compactRadius(12),
  lg: compactRadius(18),
  xl: compactRadius(24),
  xxl: compactRadius(32),
  pill: 999,
};

export const font = {
  xs: compactFont(12),
  sm: compactFont(14),
  md: compactFont(16),
  lg: compactFont(18),
  xl: compactFont(24),
  xxl: compactFont(32),
  xxxl: compactFont(40),
};

export const shadow = Platform.select({
  ios: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 18,
  },
  android: {
    elevation: 10,
  },
  default: {},
}) as Record<string, unknown>;

export const shadowSm = Platform.select({
  ios: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  android: {
    elevation: 4,
  },
  default: {},
}) as Record<string, unknown>;
