import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../store/ThemeContext";

/**
 * SectionDivider — uppercase eyebrow label used to title each section on
 * the Home screen. Renders a thin gradient line on the trailing edge so the
 * label feels like a continuous "head" rather than a floating word.
 *
 *   <SectionDivider label="Storage Locations" />
 *   <SectionDivider label="Liked Songs" inline />  // strips vertical padding
 */
export function SectionDivider({
  label,
  inline = false,
  trailing,
}: {
  label: string;
  /** When true, the divider hugs its content (no top padding) — useful when
   * sitting inside a flex row that already supplies the vertical rhythm. */
  inline?: boolean;
  /** Optional right-side element (badge, action button). */
  trailing?: React.ReactNode;
}) {
  const { colors, spacing, font } = useTheme();
  return (
    <View
      style={[
        styles.wrap,
        {
          paddingHorizontal: spacing.lg,
          paddingTop: inline ? 0 : spacing.xl,
          paddingBottom: spacing.sm,
        },
      ]}
    >
      <Text
        style={[
          styles.label,
          { color: colors.muted, fontSize: font.xxs, letterSpacing: 1.4 },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {trailing ? <View style={{ marginLeft: spacing.sm }}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: {
    fontWeight: "800",
    textTransform: "uppercase",
  },
});
