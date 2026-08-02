import { Platform } from "react-native";

/**
 * Nexora mobile theme — mirrors the web app's dark palette (index.css)
 * with a richer token set for depth, elevation and focus states.
 */
export const colors = {
  bg: "#090B12",
  surface: "#11131E",
  surfaceElevated: "#181B28",
  surfaceMuted: "#0D0F17",
  card: "rgba(255,255,255,0.08)",
  border: "rgba(255,255,255,0.12)",
  borderSoft: "rgba(255,255,255,0.06)",
  content: "#FFFFFF",
  muted: "#8892A8",
  accent: "#5B8CFF",
  accentSoft: "rgba(91,140,255,0.15)",
  danger: "#EF4444",
  warning: "#FBBF24",
  success: "#22C55E",
  grid: "rgba(255,255,255,0.07)",
  // Secondary accents used for media kinds / data viz.
  purple: "#A78BFA",
  teal: "#2DD4BF",
  cyan: "#35D3FF",
  orange: "#F97316",
  amber: "#FBBF24",
  green: "#22C55E",
  blue: "#3B82F6",
  red: "#EF4444",
};

/** Gradient stops used across the app (brand, buttons, player). */
export const gradients = {
  brand: ["#5B8CFF", "#7C5BFF"] as const,
  brandDeep: ["#4A6FE0", "#6A4AE0"] as const,
  hero: ["rgba(91,140,255,0.22)", "rgba(124,91,255,0.10)", "transparent"] as const,
  player: ["#1B2240", "#11131E"] as const,
  danger: ["#EF4444", "#B91C1C"] as const,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
};

export const font = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 22,
  xxl: 28,
};

export const shadow = Platform.select({
  ios: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
  },
  android: {
    elevation: 6,
  },
  default: {},
}) as Record<string, unknown>;

export const shadowSm = Platform.select({
  ios: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  android: {
    elevation: 3,
  },
  default: {},
}) as Record<string, unknown>;
