import React from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useTheme } from "../store/ThemeContext";

/**
 * Nexora brand mark — a rounded gradient tile with a layered
 * server/stack glyph. Used on the splash, login hero and settings.
 */
export function AppIcon({ size = 68, style }: { size?: number; style?: object }) {
  const { gradients, shadow } = useTheme();
  const icon = size * 0.44;
  return (
    <View
      style={[
        styles.wrap,
        { width: size, height: size, borderRadius: size * 0.26, ...shadow },
        style,
      ]}
    >
      <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={[styles.glow, { borderRadius: size * 0.3 }]} />
      <View style={styles.iconRing}>
        <MaterialCommunityIcons name="cloud-outline" size={icon} color="#fff" style={{ opacity: 0.95 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  glow: {
    position: "absolute",
    top: "-40%",
    left: "-20%",
    right: "-20%",
    height: "85%",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  iconRing: {
    alignItems: "center",
    justifyContent: "center",
  },
});

/** Small colored tile used for generic previews / empty art. */
export function GlyphTile({ icon, color, size = 72 }: { icon: string; color?: string; size?: number }) {
  const { colors, shadowSm } = useTheme();
  const c = color ?? colors.accent;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.24,
        backgroundColor: `${c}20`,
        borderWidth: 1,
        borderColor: `${c}30`,
        alignItems: "center",
        justifyContent: "center",
        ...shadowSm,
      }}
    >
      <MaterialCommunityIcons name={icon as any} size={size * 0.5} color={c} />
    </View>
  );
}
