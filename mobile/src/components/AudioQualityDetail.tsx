/**
 * AudioQualityDetail — Expanded Audio Metadata Panel
 * ────────────────────────────────────────────────────
 * Shows the full quality badge plus a grid of technical specs
 * (codec, bit depth, sample rate, bitrate, channels).
 * Designed for the full-screen player modal.
 */

import React, { useMemo, useEffect, useRef } from "react";
import { Animated, StyleSheet, View, Text, Platform } from "react-native";
import { useTheme } from "../store/ThemeContext";
import {
  detectAudioQuality,
  QUALITY_COLORS,
  formatBitrate,
  formatSampleRate,
  formatBitDepth,
  formatChannels,
  type QualityOverrides,
  type AudioQualityInfo,
} from "../lib/audioQuality";

// ─── Props ───────────────────────────────────────────────────────────

export interface AudioQualityDetailProps {
  extension: string;
  mime?: string;
  fileSize?: number;
  duration?: number;
  overrides?: QualityOverrides;
  /** Whether to animate in */
  animate?: boolean;
  style?: object;
}

// ─── Component ───────────────────────────────────────────────────────

export function AudioQualityDetail({
  extension,
  mime,
  fileSize,
  duration,
  overrides,
  animate = true,
  style,
}: AudioQualityDetailProps) {
  const { isDark } = useTheme();

  const info: AudioQualityInfo = useMemo(
    () => detectAudioQuality(extension, mime, fileSize, duration, overrides),
    [extension, mime, fileSize, duration, overrides]
  );

  // Staggered fade-in animation
  const fadeAnim = useRef(new Animated.Value(animate ? 0 : 1)).current;

  useEffect(() => {
    if (!animate) return;
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 280,
      delay: 60,
      useNativeDriver: true,
    }).start();
  }, [extension, mime, fileSize, animate]);

  const palette = QUALITY_COLORS[info.variant];
  const accentColor = isDark ? palette.accent : palette.lightAccent;
  const bgColor = isDark ? palette.darkBg : palette.lightBg;
  const borderColor = isDark ? palette.darkBorder : palette.lightBorder;
  const mutedText = isDark ? "rgba(255,255,255,0.40)" : "rgba(0,0,0,0.35)";
  const valueText = isDark ? "rgba(255,255,255,0.80)" : "rgba(0,0,0,0.75)";

  // Build spec rows
  const specs: { key: string; value: string }[] = [];

  specs.push({ key: "Codec", value: info.codec === "UNKNOWN" ? "—" : info.codec });
  specs.push({ key: "Container", value: info.container || "—" });

  if (info.bitDepth !== null) {
    specs.push({ key: "Bit Depth", value: formatBitDepth(info.bitDepth) });
  }
  if (info.sampleRateKHz !== null) {
    specs.push({ key: "Sample Rate", value: formatSampleRate(info.sampleRateKHz) });
  }
  if (info.bitrateKbps !== null) {
    specs.push({ key: "Bitrate", value: formatBitrate(info.bitrateKbps) });
  }
  if (info.channels !== null) {
    specs.push({ key: "Channels", value: formatChannels(info.channels) });
  }

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }, style]}>
      {/* Primary badge */}
      <View style={[styles.badgeRow]}>
        <View style={[styles.badge, { backgroundColor: bgColor, borderColor }]}>
          <Text style={[styles.badgeLabel, { color: accentColor }]}>
            {info.label}
          </Text>
          {info.detail && (
            <Text style={[styles.badgeDetail, { color: mutedText }]}>
              {info.detail}
            </Text>
          )}
        </View>

        {/* Lossless / Hi-Res indicator dot */}
        {info.isLossless && (
          <View style={[styles.statusDot, { backgroundColor: accentColor }]} />
        )}
      </View>

      {/* Specs grid */}
      <View style={styles.specsGrid}>
        {specs.map((spec) => (
          <View key={spec.key} style={styles.specItem}>
            <Text style={[styles.specKey, { color: mutedText }]}>
              {spec.key}
            </Text>
            <Text style={[styles.specValue, { color: valueText }]}>
              {spec.value}
            </Text>
          </View>
        ))}
      </View>
    </Animated.View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────

const FONT = Platform.select({ ios: "SF Pro Display", default: "System" });

const styles = StyleSheet.create({
  container: {
    marginTop: 16,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  badge: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeLabel: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    lineHeight: 15,
  },
  badgeDetail: {
    fontFamily: FONT,
    fontSize: 10,
    fontWeight: "500",
    letterSpacing: 0.2,
    marginTop: 1,
    lineHeight: 13,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  specsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    rowGap: 10,
  },
  specItem: {
    width: "30%",
    minWidth: 80,
  },
  specKey: {
    fontFamily: FONT,
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 2,
    lineHeight: 12,
  },
  specValue: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 17,
  },
});

export default AudioQualityDetail;
