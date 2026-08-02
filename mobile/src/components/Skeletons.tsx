import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { colors, radius, spacing } from "../theme";

/** Pulsing placeholder blocks shown while lists load. */
function usePulse() {
  const opacity = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 650, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return opacity;
}

function Block({ w = "100%", h = 12, style }: { w?: number | string; h?: number; style?: object }) {
  const opacity = usePulse();
  return <Animated.View style={[{ width: w, height: h, borderRadius: radius.sm, backgroundColor: colors.card, opacity }, style]} />;
}

export function RowSkeleton() {
  return (
    <View style={styles.row}>
      <View style={[styles.icon, { backgroundColor: colors.card }]} />
      <View style={styles.body}>
        <Block w="55%" h={14} />
        <Block w="35%" h={10} style={{ marginTop: 8 }} />
      </View>
    </View>
  );
}

export function ListSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <View>
      {Array.from({ length: rows }, (_, i) => (
        <RowSkeleton key={i} />
      ))}
    </View>
  );
}

export function CardSkeleton({ width, height }: { width?: number; height?: number }) {
  const opacity = usePulse();
  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius.lg,
          backgroundColor: colors.card,
          opacity,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    height: 64,
  },
  icon: { width: 40, height: 40, borderRadius: radius.md },
  body: { flex: 1 },
});
