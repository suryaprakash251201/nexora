import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Animated } from "react-native";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../store/ThemeContext";

// Map routes to MaterialCommunityIcons (since Lucide isn't installed natively yet)
const TAB_ICONS: Record<string, string> = {
  Home: "home-outline",
  Search: "magnify",
  Recents: "clock-outline",
  Settings: "cog-outline",
};

export function PremiumTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { bottom } = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const [containerWidth, setContainerWidth] = useState(0);

  // We use standard React Native Animated to prevent needing a native rebuild
  const [translateX] = useState(new Animated.Value(0));

  const tabCount = state.routes.length;
  const paddingHorizontal = 8;
  const availableWidth = Math.max(0, containerWidth - paddingHorizontal * 2);
  const tabWidth = availableWidth / tabCount;
  const pillWidth = tabWidth - 16; // soft horizontal inset
  const pillHeight = 50;

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
            backgroundColor: isDark ? "rgba(28, 28, 30, 0.95)" : "rgba(255, 255, 255, 0.95)",
            borderColor: isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)",
          }
        ]} 
        onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      >
        {/* Animated Background Pill */}
        {containerWidth > 0 && (
          <Animated.View
            style={[
              styles.activePill,
              {
                width: pillWidth,
                transform: [{ translateX }],
                backgroundColor: isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.08)",
              },
            ]}
          />
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
              accessibilityLabel={options.tabBarAccessibilityLabel}
              testID={options.tabBarTestID}
              onPress={onPress}
              style={styles.tabButton}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons
                name={iconName as any}
                size={22}
                color={isFocused ? colors.accent : (isDark ? "rgba(255,255,255,0.82)" : "rgba(0,0,0,0.6)")}
                style={[
                  styles.icon,
                  isFocused && { transform: [{ scale: 1.08 }] },
                ]}
              />
              <Text
                style={[
                  styles.label,
                  isFocused ? { color: colors.accent, opacity: 1 } : { color: isDark ? "rgba(255, 255, 255, 0.75)" : "rgba(0, 0, 0, 0.6)" },
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
    width: "100%",
    alignItems: "center",
  },
  container: {
    flexDirection: "row",
    width: "84%", // 82-86% of screen width
    height: 68,
    borderRadius: 34,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
    alignItems: "center",
    paddingHorizontal: 8,
  },
  activePill: {
    position: "absolute",
    left: 0,
    top: 9, // vertically center (68 - 50) / 2
    height: 50,
    borderRadius: 25, // capsule
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
    fontSize: 12,
    fontWeight: "500",
  },
});
