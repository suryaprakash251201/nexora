import React from "react";
import { StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useTheme } from "../store/ThemeContext";

/**
 * Nexora brand mark — the official logo (assets/logo.svg): gradient shield
 * with the white “N”. Rendered as a vector SVG so it stays crisp at any size.
 *
 * Matches web/public/logo.svg (source of truth, same file as the web favicon).
 */
export function AppIcon({ size = 68, style }: { size?: number; style?: object }) {
  const { shadow } = useTheme();
  return (
    <View
      style={[
        styles.wrap,
        {
          width: size,
          height: size,
          ...shadow,
        },
        style,
      ]}
    >
      <Image
        source={require("../../assets/logo.svg")}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        transition={150}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
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
