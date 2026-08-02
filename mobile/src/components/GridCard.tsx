import React, { memo } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useTheme } from "../store/ThemeContext";
import { fileIconFor } from "./FileRow";
import { previewKind, formatBytes, formatDate } from "../api/client";
import type { FileItem } from "../api/types";

interface Props {
  item: FileItem;
  rawUrl?: string;
  onPress: (item: FileItem) => void;
  onLongPress: (item: FileItem) => void;
  onMorePress: (item: FileItem) => void;
  selected?: boolean;
  selectMode?: boolean;
  onSelect?: (item: FileItem) => void;
}

export const GridCard = memo(function GridCard({
  item,
  rawUrl,
  onPress,
  onLongPress,
  onMorePress,
  selected,
  selectMode,
  onSelect,
}: Props) {
  const { colors, font, radius, spacing, shadowSm, isDark } = useTheme();
  const { name: iconName, color: iconColor } = fileIconFor(item);
  const kind = previewKind(item);
  const isImage = kind === "image" && rawUrl;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: selected ? colors.accentSoft : colors.surface,
          borderColor: selected ? colors.accent : colors.borderSoft,
          borderRadius: radius.lg,
          padding: spacing.md,
        },
        shadowSm,
      ]}
      activeOpacity={0.7}
      onPress={() => (selectMode && onSelect ? onSelect(item) : onPress(item))}
      onLongPress={() => onLongPress(item)}
      delayLongPress={350}
    >
      {/* Thumbnail or File Icon area */}
      <View style={[styles.previewArea, { borderRadius: radius.md, backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)" }]}>
        {isImage ? (
          <Image
            source={{ uri: rawUrl }}
            style={[styles.imageThumb, { borderRadius: radius.md }]}
            contentFit="cover"
            transition={150}
          />
        ) : (
          <View style={[styles.iconBox, { backgroundColor: `${iconColor}18`, borderRadius: radius.md }]}>
            <MaterialCommunityIcons name={iconName as any} size={32} color={iconColor} />
          </View>
        )}

        {/* Selection Checkbox Pill */}
        {selectMode && (
          <TouchableOpacity
            style={[
              styles.checkbox,
              {
                backgroundColor: selected ? colors.accent : "rgba(0,0,0,0.4)",
                borderColor: selected ? colors.accent : "#fff",
              },
            ]}
            onPress={() => onSelect?.(item)}
          >
            {selected && <MaterialCommunityIcons name="check" size={14} color="#fff" />}
          </TouchableOpacity>
        )}

        {/* More Actions Trigger */}
        {!selectMode && (
          <TouchableOpacity
            style={[styles.moreBtn, { backgroundColor: isDark ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.85)" }]}
            onPress={() => onMorePress(item)}
            hitSlop={6}
          >
            <MaterialCommunityIcons name="dots-vertical" size={16} color={isDark ? "#fff" : colors.content} />
          </TouchableOpacity>
        )}
      </View>

      {/* Info Body */}
      <View style={styles.info}>
        <Text style={[styles.title, { color: colors.content, fontSize: font.sm }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.meta, { color: colors.muted, fontSize: font.xs }]}>
          {item.is_dir ? "Folder" : formatBytes(item.size)}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  card: {
    flex: 1,
    margin: 6,
    borderWidth: 1,
    minHeight: 140,
  },
  previewArea: {
    height: 90,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
  },
  imageThumb: {
    width: "100%",
    height: "100%",
  },
  iconBox: {
    width: 54,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  checkbox: {
    position: "absolute",
    top: 6,
    left: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  moreBtn: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    marginTop: 8,
    gap: 2,
  },
  title: {
    fontWeight: "600",
  },
  meta: {
    fontWeight: "500",
  },
});
