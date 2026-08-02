import React from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, gradients, radius, shadow } from "../theme";

/**
 * Nexora brand mark — a rounded gradient tile with a layered
 * server/stack glyph. Used on the splash, login hero and settings.
 */
export function AppIcon({ size = 68, style }: { size?: number; style?: object }) {
  const icon = size * 0.46;
  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: size * 0.26 }, style]}>
      <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={[styles.glow, { borderRadius: size * 0.3 }]} />
      <MaterialCommunityIcons name="server" size={icon} color="#fff" style={{ opacity: 0.95 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    ...shadow,
  },
  glow: {
    position: "absolute",
    top: "-45%",
    left: "-25%",
    right: "-25%",
    height: "90%",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
});

/** Small colored tile used for generic previews / empty art. */
export function GlyphTile({ icon, color = colors.accent, size = 72 }: { icon: string; color?: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.24,
        backgroundColor: `${color}26`,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <MaterialCommunityIcons name={icon as any} size={size * 0.5} color={color} />
    </View>
  );
}
