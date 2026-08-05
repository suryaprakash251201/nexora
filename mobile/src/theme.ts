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
  accent: "#4F46E5", // Rich Indigo
  accentSoft: "rgba(79, 70, 229, 0.15)",
  danger: "#F43F5E", // Rose red
  warning: "#F59E0B", // Amber
  success: "#10B981", // Emerald green
  grid: "rgba(255,255,255,0.03)",
  purple: "#8B5CF6",
  teal: "#14B8A6",
  cyan: "#06B6D4",
  orange: "#F97316",
  amber: "#F59E0B",
  green: "#10B981",
  blue: "#3B82F6",
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
  accent: "#4338CA",
  accentSoft: "rgba(67, 56, 202, 0.12)",
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
  brand: ["#4F46E5", "#8B5CF6", "#D946EF"],
  brandDeep: ["#312E81", "#4338CA"],
  hero: ["rgba(79, 70, 229, 0.15)", "rgba(139, 92, 246, 0.05)", "transparent"],
  player: ["#0F172A", "#040508"],
  danger: ["#E11D48", "#9F1239"],
};

export const lightGradients: AppGradients = {
  brand: ["#4338CA", "#7C3AED", "#C026D3"],
  brandDeep: ["#3730A3", "#4F46E5"],
  hero: ["rgba(67, 56, 202, 0.08)", "rgba(124, 58, 237, 0.03)", "transparent"],
  player: ["#E2E8F0", "#F8FAFC"],
  danger: ["#E11D48", "#9F1239"],
};

export const spacing = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  xxl: 36,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  xxl: 32,
  pill: 999,
};

export const font = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 24,
  xxl: 32,
  xxxl: 40,
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
