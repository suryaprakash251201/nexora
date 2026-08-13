import React from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { useTheme } from "../store/ThemeContext";

const darkIcon = require("../../assets/lossless-wave-light.png");
const lightIcon = require("../../assets/lossless-wave.png");

/**
 * LosslessWave — the lossless sound-wave glyph, image only (no text label),
 * sized up so it reads as a prominent quality mark. Shown in the mini
 * player, fullscreen player and the vinyl preview player for lossless
 * tracks. Picks the white glyph on dark themes and the dark glyph on light.
 */
export function LosslessWave({ size = "sm" }: { size?: "sm" | "md" | "lg" }) {
  const { isDark } = useTheme();
  const md = size === "md";
  const lg = size === "lg";

  return (
    <View style={lg ? styles.wrapLg : md ? styles.wrapMd : styles.wrap}>
      <Image
        source={isDark ? darkIcon : lightIcon}
        style={lg ? styles.waveLg : md ? styles.waveMd : styles.wave}
        contentFit="contain"
      />
    </View>
  );
}

export default LosslessWave;

const styles = StyleSheet.create({
  wrap: {
    height: 14,
    justifyContent: "center",
  },
  wrapMd: {
    height: 22,
    justifyContent: "center",
  },
  wrapLg: {
    height: 30,
    justifyContent: "center",
  },
  wave: {
    width: 50,
    height: 14,
  },
  waveMd: {
    width: 80,
    height: 22,
  },
  waveLg: {
    width: 108,
    height: 30,
  },
});
