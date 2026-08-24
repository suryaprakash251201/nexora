import React, { useEffect, useState } from "react";
import { Platform, View, Text, TouchableOpacity, StyleSheet, Animated } from "react-native";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../store/ThemeContext";
import { haptic } from "../store/SettingsContext";

// Map routes to MaterialCommunityIcons (since Lucide isn't installed natively yet)
const TAB_ICONS: Record<string, string> = {
  Home: "home-outline",
  Search: "magnify",
  Recents: "clock-outline",
  Settings: "cog-outline",
};

/** Fixed height of the pill container — MiniPlayer uses this to sit flush above. */
export const TAB_BAR_BASE_HEIGHT = Platform.OS === "android" ? 60 : 68;
/** Extra space reserved below the pill for the home indicator. */
export function tabBarTotalHeight(bottomInset: number): number {
  return TAB_BAR_BASE_HEIGHT + Math.max(bottomInset, 18);
}

/** Height of the sliding active pill inside the bar. */
const PILL_HEIGHT = Platform.OS === "android" ? 44 : 50;

/**
 * PremiumTabBar v2 — "blended chrome":
 * - Real frosted-glass surface (expo-blur) that melts into scrolling content
 * - Gradient brand capsule slides between tabs (blue -> violet)
 * - Soft outer glow on the active pill; tiny scale lift on the icon
 * - Light haptic tick on tab change (respects the user's haptics preference)
 */
export function PremiumTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { bottom } = useSafeAreaInsets();
  const { colors, gradients, isDark } = useTheme();
  const [containerWidth, setContainerWidth] = useState(0);

  // We use standard React Native Animated to prevent needing a native rebuild
  const [translateX] = useState(new Animated.Value(0));

  const tabCount = state.routes.length;
  const paddingHorizontal = 8;
  const availableWidth = Math.max(0, containerWidth - paddingHorizontal * 2);
  const tabWidth = availableWidth / tabCount;
  const pillWidth = tabWidth - 16; // soft horizontal inset
  const pillHeight = PILL_HEIGHT;

  useEffect(() => {
    if (tabWidth > 0) {
      Animated.spring(translateX, {
        toValue: paddingHorizontal + state.index * tabWidth + (tabWidth - pillWidth) / 2,
        useNativeDriver: true,
        friction: 12, // stiffer spring, less bounce
        tension: 65,
      }).start();
    }
  }, [state.index, tabWidth, paddingHorizontal, pillWidth]);

  return (
    <View style={[styles.wrapper, { paddingBottom: Math.max(bottom, 18) }]}>
      <View
        style={[
          styles.container,
          {
            borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
            backgroundColor: isDark ? "rgba(16,17,24,0.72)" : "rgba(255,255,255,0.78)",
          },
        ]}
        onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      >
        {/* Frosted glass layer (native blur on iOS; dimezis on Android). */}
        <BlurView
          intensity={isDark ? 55 : 70}
          tint={isDark ? "dark" : "light"}
          experimentalBlurMethod={Platform.OS === "android" ? ("dimezisBlurView" as const) : undefined}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {/* Brand-tinted veil so the bar reads as Nexora, not system chrome. */}
        <LinearGradient
          colors={
            isDark
              ? ["rgba(91,140,255,0.10)", "rgba(122,92,255,0.04)", "transparent"]
              : ["rgba(91,140,255,0.06)", "transparent"]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        {/* Animated Background Pill */}
        {containerWidth > 0 && (
          <Animated.View
            style={[
              styles.activePill,
              {
                width: pillWidth,
                transform: [{ translateX }],
              },
            ]}
          >
            {/* Soft outer glow behind the gradient capsule */}
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  borderRadius: PILL_HEIGHT / 2,
                  backgroundColor: colors.accent,
                  opacity: isDark ? 0.22 : 0.16,
                },
                Platform.OS === "ios" ? { shadowColor: colors.accent, shadowOpacity: 0.5, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } } : { elevation: 6 },
              ]}
            />
            <LinearGradient
              colors={[gradients.brand[0], gradients.brand[1]]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[StyleSheet.absoluteFill, { borderRadius: PILL_HEIGHT / 2, opacity: isDark ? 0.28 : 0.2 }]}
            />
          </Animated.View>
        )}

        {/* Tab Items */}
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const label =
            options.tabBarLabel !== undefined
              ? options.tabBarLabel
              : options.title !== undefined
              ? options.title
              : route.name;

          const isFocused = state.index === index;
          const iconName = TAB_ICONS[route.name] || "circle-outline";

          const onPress = () => {
            if (!isFocused) haptic("light");
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          return (
            <TouchableOpacity
              key={route.key}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label as string}
              testID={options.tabBarButtonTestID}
              onPress={onPress}
              style={styles.tabButton}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons
                name={iconName as any}
                size={Platform.OS === "android" ? 20 : 22}
                color={isFocused ? colors.accent : (isDark ? "rgba(255,255,255,0.82)" : "rgba(0,0,0,0.6)")}
                style={[
                  styles.icon,
                  isFocused && { transform: [{ scale: 1.12 }] },
                ]}
              />
              <Text
                style={[
                  styles.label,
                  isFocused
                    ? { color: colors.accent, opacity: 1, fontWeight: "700" }
                    : { color: isDark ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0.6)", fontWeight: "500" },
                ]}
              >
                {label as string}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    bottom: 0,
    left: 14,
    right: 14,
    alignItems: "center",
  },
  container: {
    flexDirection: "row",
    width: "100%",
    height: TAB_BAR_BASE_HEIGHT,
    borderRadius: 34,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 22,
    elevation: 8,
    alignItems: "center",
    paddingHorizontal: 8,
  },
  activePill: {
    position: "absolute",
    left: 0,
    top: (TAB_BAR_BASE_HEIGHT - PILL_HEIGHT) / 2,
    height: PILL_HEIGHT,
    borderRadius: PILL_HEIGHT / 2, // capsule
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    zIndex: 1, // ensure it sits on top of pill
  },
  icon: {
    marginBottom: 2, // tight spacing below icon
  },
  label: {
    fontSize: Platform.OS === "android" ? 11 : 12,
  },
});
