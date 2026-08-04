/**
 * AudioQualityBadge — Nexora Premium Audio Quality Indicator
 * ───────────────────────────────────────────────────────────
 * A compact, elegant badge inspired by Apple Music / TIDAL / Qobuz
 * quality indicators. Renders a rounded-rect pill with the codec
 * tier label and optional detail line.
 *
 * Usage:
 *   <AudioQualityBadge extension=".flac" fileSize={98_000_000} />
 *   <AudioQualityBadge extension=".mp3" compact />
 */

import React, { useEffect, useRef, useMemo } from "react";
import { Animated, StyleSheet, View, Text, Platform } from "react-native";
import { useTheme } from "../store/ThemeContext";
import {
  detectAudioQuality,
  QUALITY_COLORS,
  type AudioQualityInfo,
  type QualityOverrides,
} from "../lib/audioQuality";

// ─── Props ───────────────────────────────────────────────────────────

export interface AudioQualityBadgeProps {
  /** File extension (e.g. ".flac", "mp3") */
  extension: string;
  /** MIME type for fallback detection */
  mime?: string;
  /** File size in bytes — used for heuristic quality estimation */
  fileSize?: number;
  /** Duration in seconds — used for bitrate estimation */
  duration?: number;
  /** Server-side metadata overrides (bit depth, sample rate, etc.) */
  overrides?: QualityOverrides;
  /** Compact mode: single-line label only, no detail row */
  compact?: boolean;
  /** Whether to animate in (default: true) */
  animate?: boolean;
  /** Custom style overrides for the container */
  style?: object;
}

// ─── Component ───────────────────────────────────────────────────────

export function AudioQualityBadge({
  extension,
  mime,
  fileSize,
  duration,
  overrides,
  compact = false,
  animate = true,
  style,
}: AudioQualityBadgeProps) {
  const { isDark } = useTheme();

  // Detect quality
  const info: AudioQualityInfo = useMemo(
    () => detectAudioQuality(extension, mime, fileSize, duration, overrides),
    [extension, mime, fileSize, duration, overrides]
  );

  // Animation
  const fadeAnim = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const scaleAnim = useRef(new Animated.Value(animate ? 0.96 : 1)).current;

  useEffect(() => {
    if (!animate) return;
    // Reset
    fadeAnim.setValue(0);
    scaleAnim.setValue(0.96);
    // Animate in
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [extension, mime, fileSize, animate]);

  // Resolve colors
  const palette = QUALITY_COLORS[info.variant];
  const accentColor = isDark ? palette.accent : palette.lightAccent;
  const bgColor = isDark ? palette.darkBg : palette.lightBg;
  const borderColor = isDark ? palette.darkBorder : palette.lightBorder;

  return (
    <Animated.View
      style={[
        styles.badge,
        {
          backgroundColor: bgColor,
          borderColor,
          opacity: fadeAnim,
          transform: [{ scale: scaleAnim }],
        },
        compact && styles.badgeCompact,
        style,
      ]}
    >
      {/* Primary label */}
      <Text
        style={[
          styles.label,
          { color: accentColor },
          compact && styles.labelCompact,
        ]}
        numberOfLines={1}
      >
        {info.label}
      </Text>

      {/* Secondary detail */}
      {!compact && info.detail && (
        <Text
          style={[
            styles.detail,
            { color: isDark ? "rgba(255,255,255,0.50)" : "rgba(0,0,0,0.45)" },
          ]}
          numberOfLines={1}
        >
          {info.detail}
        </Text>
      )}
    </Animated.View>
  );
}

// ─── Inline Badge ────────────────────────────────────────────────────

/**
 * A tiny inline badge for use inside text rows (e.g. mini player subtitle).
 * Shows only the primary label in a single capsule.
 */
export function AudioQualityPill({
  extension,
  mime,
  fileSize,
  duration,
  overrides,
  style,
}: Omit<AudioQualityBadgeProps, "compact" | "animate">) {
  const { isDark } = useTheme();

  const info = useMemo(
    () => detectAudioQuality(extension, mime, fileSize, duration, overrides),
    [extension, mime, fileSize, duration, overrides]
  );

  const palette = QUALITY_COLORS[info.variant];
  const accentColor = isDark ? palette.accent : palette.lightAccent;
  const bgColor = isDark ? palette.darkBg : palette.lightBg;
  const borderColor = isDark ? palette.darkBorder : palette.lightBorder;

  return (
    <View style={[styles.pill, { backgroundColor: bgColor, borderColor }, style]}>
      <Text style={[styles.pillText, { color: accentColor }]}>
        {info.label}
      </Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────

const FONT_FAMILY = Platform.select({
  ios: "SF Pro Display",
  default: "System",
});

const styles = StyleSheet.create({
  // Full badge
  badge: {
    alignSelf: "flex-start",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minHeight: 22,
    justifyContent: "center",
  },
  badgeCompact: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    minHeight: 20,
  },
  label: {
    fontFamily: FONT_FAMILY,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    lineHeight: 14,
  },
  labelCompact: {
    fontSize: 10,
    lineHeight: 13,
  },
  detail: {
    fontFamily: FONT_FAMILY,
    fontSize: 9.5,
    fontWeight: "500",
    letterSpacing: 0.2,
    marginTop: 1,
    lineHeight: 12,
  },

  // Pill (inline mini badge)
  pill: {
    alignSelf: "flex-start",
    borderRadius: 6,
    borderWidth: 0.5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    justifyContent: "center",
  },
  pillText: {
    fontFamily: FONT_FAMILY,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    lineHeight: 12,
  },
});

export default AudioQualityBadge;
