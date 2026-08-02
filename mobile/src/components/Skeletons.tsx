import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { useTheme } from "../store/ThemeContext";

/** Pulsing placeholder blocks shown while lists load. */
function usePulse() {
  const opacity = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.8, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return opacity;
}

function Block({ w = "100%", h = 12, style }: { w?: number | string; h?: number; style?: object }) {
  const { colors, radius } = useTheme();
  const opacity = usePulse();
  return (
    <Animated.View
      style={[{ width: w, height: h, borderRadius: radius.sm, backgroundColor: colors.card, opacity }, style]}
    />
  );
}

export function RowSkeleton() {
  const { colors, radius, spacing } = useTheme();
  return (
    <View style={[styles.row, { paddingHorizontal: spacing.lg, gap: spacing.md }]}>
      <Animated.View
        style={[styles.icon, { backgroundColor: colors.card, borderRadius: radius.md, opacity: usePulse() }]}
      />
      <View style={styles.body}>
        <Block w="55%" h={14} />
        <Block w="35%" h={10} style={{ marginTop: 8 }} />
      </View>
    </View>
  );
}

export function ListSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <View style={{ paddingTop: 4 }}>
      {Array.from({ length: rows }, (_, i) => (
        <RowSkeleton key={i} />
      ))}
    </View>
  );
}

export function CardSkeleton({ width, height }: { width?: number; height?: number }) {
  const { colors, radius } = useTheme();
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

/** Grid card skeleton for storage roots. */
export function GridCardSkeleton() {
  const { colors, radius, spacing, isDark } = useTheme();
  const opacity = usePulse();
  const bar = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)";
  return (
    <Animated.View
      style={[
        styles.gridCard,
        {
          backgroundColor: colors.surface,
          borderColor: colors.borderSoft,
          borderRadius: radius.lg,
          padding: spacing.lg,
          opacity,
        },
      ]}
    >
      <View style={[styles.gridIcon, { backgroundColor: bar, borderRadius: radius.md }]} />
      <View style={{ marginTop: 12, gap: 8 }}>
        <View style={{ width: "65%", height: 14, borderRadius: 6, backgroundColor: bar }} />
        <View style={{ width: "40%", height: 10, borderRadius: 5, backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.05)" }} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    height: 68,
  },
  icon: { width: 46, height: 46 },
  body: { flex: 1 },
  gridCard: {
    flex: 1,
    borderWidth: 1,
  },
  gridIcon: {
    width: 48,
    height: 48,
  },
});
