import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

/**
 * Animated equalizer bars. Animations run on the native driver, so this is
 * cheap even while the audio timeline updates every 500ms.
 */
export function EqBars({ playing, tint, barCount = 5 }: { playing: boolean; tint: string; barCount?: number }) {
  const bars = useRef(
    Array.from({ length: barCount }, (_, i) => {
      const v = new Animated.Value(0.2);
      return { v, lo: 0.12 + (i % 2) * 0.15, hi: 0.62 + (i % 3) * 0.22 };
    })
  ).current;

  useEffect(() => {
    if (!playing) {
      bars.forEach((b) => b.v.stopAnimation());
      bars.forEach((b) => b.v.setValue(0.2));
      return;
    }
    const loops = bars.map((b, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(b.v, { toValue: b.hi, duration: 620 + i * 100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(b.v, { toValue: b.lo, duration: 620 + i * 100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [playing, bars]);

  return (
    <View style={styles.row}>
      {bars.map((b, i) => (
        <Animated.View key={i} style={[styles.bar, { backgroundColor: tint, transform: [{ scaleY: b.v }] }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 3, height: 16 },
  bar: { width: 3, height: 14, borderRadius: 2, opacity: 0.9 },
});
