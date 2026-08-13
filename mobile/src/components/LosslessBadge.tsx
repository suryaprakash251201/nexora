import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useTheme } from "../store/ThemeContext";

const darkIcon = require("../../assets/lossless-wave-light.png");
const lightIcon = require("../../assets/lossless-wave.png");

/**
 * LosslessBadge — Apple Music style "LOSSLESS" capsule: a rounded pill with
 * the lossless wave glyph + label. Shown in the mini player, fullscreen
 * player and the vinyl preview player whenever the current track is lossless.
 */
export function LosslessBadge({
  label = "LOSSLESS",
  size = "sm",
}: {
  label?: string;
  size?: "sm" | "md";
}) {
  const { colors, isDark } = useTheme();
  const md = size === "md";

  return (
    <View
      style={[
        styles.badge,
        md && styles.badgeMd,
        {
          backgroundColor: isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.06)",
          borderColor: isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.12)",
        },
      ]}
    >
      <Image
        source={isDark ? darkIcon : lightIcon}
        style={[styles.wave, md && styles.waveMd]}
        contentFit="contain"
      />
      <Text
        style={[
          styles.label,
          md && styles.labelMd,
          { color: colors.content },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  badgeMd: {
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  wave: {
    width: 22,
    height: 10,
  },
  waveMd: {
    width: 34,
    height: 15,
  },
  label: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  labelMd: {
    fontSize: 11,
    letterSpacing: 1,
  },
});
