import { Platform } from "react-native";

export const darkColors = {
  bg: "#06070B", // Deeper, more luxurious dark background
  bgGradientEnd: "#0A0C12", // subtle end-stop for hero gradients
  surface: "#0D0F16", // Slightly elevated
  surfaceElevated: "#171A24",
  surfaceMuted: "#0F1119",
  surfaceHigh: "#1F2230",
  card: "rgba(255,255,255,0.035)",
  cardHover: "rgba(255,255,255,0.05)",
  border: "rgba(255,255,255,0.10)",
  borderSoft: "rgba(255,255,255,0.05)",
  borderStrong: "rgba(255,255,255,0.16)",
  content: "#FFFFFF",
  contentSecondary: "rgba(255,255,255,0.78)",
  contentTertiary: "rgba(255,255,255,0.58)",
  muted: "#94A3B8",
  accent: "#5B8CFF", // Electric blue — matches web --color-accent
  accentSecondary: "#7A5CFF", // Violet — matches web --color-accent-secondary
  accentTertiary: "#35D3FF", // Cyan — matches web --color-accent-tertiary
  accentSoft: "rgba(91, 140, 255, 0.16)",
  accentSofter: "rgba(91, 140, 255, 0.08)",
  accentRing: "rgba(91, 140, 255, 0.35)",
  danger: "#F43F5E", // Rose red
  dangerSoft: "rgba(244, 63, 94, 0.14)",
  warning: "#F59E0B", // Amber
  warningSoft: "rgba(245, 158, 11, 0.14)",
  success: "#10B981", // Emerald green
  successSoft: "rgba(16, 185, 129, 0.14)",
  grid: "rgba(255,255,255,0.03)",
  // semantic color swatches (icons, badges, category art)
  purple: "#A78BFA",
  teal: "#14B8A6",
  cyan: "#35D3FF",
  orange: "#FB923C",
  amber: "#FBBF24",
  green: "#10B981",
  blue: "#5B8CFF",
  red: "#F43F5E",
  pink: "#F472B6",
};

export const lightColors = {
  bg: "#F7F8FB",
  bgGradientEnd: "#EEF1F7",
  surface: "#FFFFFF",
  surfaceElevated: "#F1F5F9",
  surfaceMuted: "#F3F4F6",
  surfaceHigh: "#FFFFFF",
  card: "rgba(0,0,0,0.025)",
  cardHover: "rgba(0,0,0,0.045)",
  border: "rgba(0,0,0,0.08)",
  borderSoft: "rgba(0,0,0,0.04)",
  borderStrong: "rgba(0,0,0,0.12)",
  content: "#0B1220",
  contentSecondary: "rgba(11, 18, 32, 0.78)",
  contentTertiary: "rgba(11, 18, 32, 0.55)",
  muted: "#64748B",
  // Deeper blue than the web token so small accent text/icons stay AA on white.
  accent: "#3F6BE0",
  accentSecondary: "#7A5CFF",
  accentTertiary: "#0891B2",
  accentSoft: "rgba(63, 107, 224, 0.12)",
  accentSofter: "rgba(63, 107, 224, 0.06)",
  accentRing: "rgba(63, 107, 224, 0.32)",
  danger: "#E11D48",
  dangerSoft: "rgba(225, 29, 72, 0.10)",
  warning: "#D97706",
  warningSoft: "rgba(217, 119, 6, 0.10)",
  success: "#059669",
  successSoft: "rgba(5, 150, 105, 0.10)",
  grid: "rgba(0,0,0,0.03)",
  purple: "#7C3AED",
  teal: "#0D9488",
  cyan: "#0891B2",
  orange: "#EA580C",
  amber: "#D97706",
  green: "#059669",
  blue: "#2563EB",
  red: "#E11D48",
  pink: "#DB2777",
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
  heroGlow: GradientTuple;
  player: GradientTuple;
  danger: GradientTuple;
  aurora: GradientTuple;
  glass: GradientTuple;
}

/** Gradient stops used across the app (brand, buttons, player). */
export const gradients: AppGradients = {
  // Brand — three-stop "aurora" used for primary surfaces, pills, and the
  // ambient glow under the tab bar. Slightly more saturated for richer glass.
  brand: ["#5B8CFF", "#7A5CFF", "#35D3FF"],
  brandDeep: ["#1C2650", "#3D53DB"],
  hero: ["rgba(91, 140, 255, 0.18)", "rgba(122, 92, 255, 0.06)", "transparent"],
  heroGlow: ["rgba(91, 140, 255, 0.22)", "rgba(53, 211, 255, 0.10)", "transparent"],
  player: ["#101B33", "#040508"],
  danger: ["#E11D48", "#9F1239"],
  aurora: ["#5B8CFF", "#7A5CFF", "#35D3FF", "#A78BFA"],
  glass: ["rgba(255,255,255,0.06)", "rgba(255,255,255,0.02)"],
};

export const lightGradients: AppGradients = {
  brand: ["#5B8CFF", "#7A5CFF", "#35D3FF"],
  brandDeep: ["#283593", "#4F46E5"],
  hero: ["rgba(63, 107, 224, 0.10)", "rgba(122, 92, 255, 0.04)", "transparent"],
  heroGlow: ["rgba(63, 107, 224, 0.14)", "rgba(122, 92, 255, 0.06)", "transparent"],
  player: ["#E2E8F0", "#F8FAFC"],
  danger: ["#E11D48", "#9F1239"],
  aurora: ["#5B8CFF", "#7A5CFF", "#35D3FF", "#A78BFA"],
  glass: ["rgba(255,255,255,0.85)", "rgba(255,255,255,0.55)"],
};

/**
 * Android compact mode — Android phones render the full-size tokens ~10–15%
 * tighter (and Android also applies the system font scale on top), so the
 * home dashboard, grid cards and rows don't balloon the way they do on iOS.
 * iOS keeps the exact original values; these helpers are no-ops there.
 */
const compactFor = (mult: number) => (v: number) =>
  Platform.OS === "android" ? Math.max(1, Math.round(v * mult)) : v;
const compactSpacing = compactFor(0.9);
const compactRadius = compactFor(0.9);
const compactFont = compactFor(0.95);

export const spacing = {
  xxs: compactSpacing(2),
  xs: compactSpacing(4),
  sm: compactSpacing(8),
  md: compactSpacing(12),
  lg: compactSpacing(16),
  xl: compactSpacing(24),
  xxl: compactSpacing(32),
  xxxl: compactSpacing(48),
};

export const radius = {
  xs: compactRadius(6),
  sm: compactRadius(10),
  md: compactRadius(14),
  lg: compactRadius(20),
  xl: compactRadius(28),
  xxl: compactRadius(36),
  pill: 999,
};

export const font = {
  xxs: compactFont(11),
  xs: compactFont(12),
  sm: compactFont(14),
  md: compactFont(16),
  lg: compactFont(18),
  xl: compactFont(22),
  xxl: compactFont(28),
  xxxl: compactFont(36),
  display: compactFont(44),
};

/**
 * Tokens used to keep an iOS / Android rhythm in sync. They are *not*
 * spread into View styles — they're hints for components that need to mirror
 * the platform's default press feel (tap highlight, ripple radius, etc).
 */
export const motion = {
  spring: { damping: 18, stiffness: 220, mass: 1 },
  springSoft: { damping: 22, stiffness: 180, mass: 1 },
  springStiff: { damping: 16, stiffness: 280, mass: 0.9 },
  durationFast: 150,
  duration: 240,
  durationSlow: 360,
};

export const shadow = Platform.select({
  ios: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.38,
    shadowRadius: 24,
  },
  android: {
    elevation: 12,
  },
  default: {},
}) as Record<string, unknown>;

export const shadowSm = Platform.select({
  ios: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
  },
  android: {
    elevation: 4,
  },
  default: {},
}) as Record<string, unknown>;

export const shadowGlow = Platform.select({
  ios: {
    shadowColor: "#5B8CFF",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
  },
  android: {
    elevation: 14,
  },
  default: {},
}) as Record<string, unknown>;

/**
 * Hairline divider — used to draw subtle separators between list rows
 * (e.g. inside `FileRow` and settings groups) that scale with the platform
 * pixel density without becoming a 1px line on high-DPI devices.
 */
export const hairline = Platform.select({
  ios: 0.5,
  android: 1,
  default: 1,
});
