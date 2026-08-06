/**
 * AudioQualityDetail — Inline Audio Quality Capsules
 * ───────────────────────────────────────────────────
 * Minimal, monochrome pill row inspired by Apple Music's
 * 'Lossless' and 'Hi-Res Lossless' quality indicators.
 */

import React, { useMemo, useEffect, useRef } from "react";
import { Animated, StyleSheet, View, Text, Platform } from "react-native";
import { useTheme } from "../store/ThemeContext";
import {
  detectAudioQuality,
  QUALITY_COLORS,
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

  // Fade-in animation
  const fadeAnim = useRef(new Animated.Value(animate ? 0 : 1)).current;

  useEffect(() => {
    if (!animate) return;
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [extension, mime, fileSize, animate]);

  const pillBorder = isDark
    ? "rgba(255,255,255,0.25)"
    : "rgba(0,0,0,0.15)";
  const pillText = isDark
    ? "rgba(255,255,255,0.70)"
    : "rgba(0,0,0,0.60)";

  const codecDisplay = info.codec === "UNKNOWN" ? "—" : info.codec;

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }, style]}>
      {/* Quality label pill */}
      <View style={[styles.pill, { borderColor: pillBorder }]}>
        <Text style={[styles.pillText, { color: pillText }]}>
          {info.label}
        </Text>
      </View>

      {/* Codec pill */}
      <View style={[styles.pill, { borderColor: pillBorder }]}>
        <Text style={[styles.pillText, { color: pillText }]}>
          {codecDisplay}
        </Text>
      </View>

      {/* Detail pill (e.g. '24-bit / 96 kHz') */}
      {info.detail ? (
        <View style={[styles.pill, { borderColor: pillBorder }]}>
          <Text style={[styles.pillText, { color: pillText }]}>
            {info.detail}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────

const FONT = Platform.select({ ios: "SF Pro Display", default: "System" });

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
    marginBottom: 0,
  },
  pill: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pillText: {
    fontFamily: FONT,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    lineHeight: 13,
  },
});

export default AudioQualityDetail;
