import React, { memo, useState } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { useTheme } from "../store/ThemeContext";
import { formatBytes, formatDate, previewKind, mediaThumbnailUrl } from "../api/client";
import { fileIconFor, isAudioFile } from "../lib/fileMeta";
import { AudioCover } from "./AudioCover";
import type { FileItem } from "../api/types";

const IS_ANDROID = Platform.OS === "android";

const folderImage = require("../../assets/folder.png");

interface Props {
  item: FileItem;
  onPress?: (item: FileItem) => void;
  onLongPress?: (item: FileItem) => void;
  trailing?: React.ReactNode;
  subtitle?: string;
  showDate?: boolean;
  selected?: boolean;
  selectMode?: boolean;
  onSelect?: (item: FileItem) => void;
  /** Query substring to highlight in the row title (search results). */
  highlight?: string;
}

/** Splits text into matched/unmatched chunks for search-result highlighting. */
function splitHighlight(text: string, q: string): Array<{ text: string; hit: boolean }> {
  const needle = q.trim().toLowerCase();
  if (!needle) return [{ text, hit: false }];
  const out: Array<{ text: string; hit: boolean }> = [];
  const lower = text.toLowerCase();
  let i = 0;
  while (i < text.length) {
    const idx = lower.indexOf(needle, i);
    if (idx === -1) {
      out.push({ text: text.slice(i), hit: false });
      break;
    }
    if (idx > i) out.push({ text: text.slice(i, idx), hit: false });
    out.push({ text: text.slice(idx, idx + needle.length), hit: true });
    i = idx + needle.length;
  }
  return out;
}

/**
 * Memoized file/dir row with dynamic theme support.
 */
export const FileRow = memo(function FileRow({
  item,
  onPress,
  onLongPress,
  trailing,
  subtitle,
  showDate,
  selected,
  selectMode,
  onSelect,
  highlight,
}: Props) {
  const { colors, font, spacing, hairline } = useTheme();
  const { name, color } = fileIconFor(item, colors.accent);
  const sub =
    subtitle ??
    (item.is_dir ? "Folder" : `${formatBytes(item.size)}${showDate ? " · " + formatDate(item.modified) : ""}`);

  return (
    <TouchableOpacity
      style={[
        styles.row,
        {
          paddingHorizontal: spacing.lg,
          backgroundColor: selected ? colors.accentSoft : "transparent",
          minHeight: IS_ANDROID ? 60 : 70,
        },
      ]}
      activeOpacity={0.7}
      onPress={() => (selectMode && onSelect ? onSelect(item) : onPress ? onPress(item) : undefined)}
      onLongPress={onLongPress ? () => onLongPress(item) : undefined}
      delayLongPress={350}
      accessibilityLabel={item.name}
      accessibilityRole="button"
      accessibilityState={selected ? { selected: true } : undefined}
    >
      {selected && (
        <LinearGradient
          colors={["rgba(255,255,255,0.06)", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}
      {selectMode && (
        <TouchableOpacity
          style={[
            styles.checkbox,
            {
              backgroundColor: selected ? colors.accent : "transparent",
              borderColor: selected ? colors.accent : colors.muted,
            },
          ]}
          onPress={() => onSelect?.(item)}
          hitSlop={6}
        >
          {selected && <MaterialCommunityIcons name="check" size={14} color="#fff" />}
        </TouchableOpacity>
      )}

      <View
        style={[
          styles.iconWrap,
          {
            backgroundColor: item.is_dir ? "transparent" : `${color}1A`,
            borderRadius: IS_ANDROID ? 12 : 14,
          },
        ]}
      >
        {item.is_dir ? (
          <Image source={folderImage} style={{ width: 38, height: 38 }} contentFit="contain" />
        ) : isAudioFile(item) ? (
          <AudioCover item={item} size={160} />
        ) : previewKind(item) === "image" ? (
          <FileThumb item={item} iconName={name} iconColor={color} />
        ) : previewKind(item) === "video" ? (
          <>
            <MaterialCommunityIcons name={name as any} size={22} color={color} />
            <View style={styles.videoBadge}>
              <MaterialCommunityIcons name="play" size={9} color="#fff" />
            </View>
          </>
        ) : (
          <MaterialCommunityIcons name={name as any} size={22} color={color} />
        )}
      </View>

      <View style={styles.body}>
        <Text
          style={[styles.title, { color: colors.content, fontSize: font.md }]}
          numberOfLines={1}
          maxFontSizeMultiplier={1.15}
        >
          {splitHighlight(item.name, highlight ?? "").map((part, i) =>
            part.hit ? (
              <Text key={i} style={{ color: colors.accent, fontWeight: "800" }}>{part.text}</Text>
            ) : (
              <Text key={i}>{part.text}</Text>
            )
          )}
        </Text>
        <Text
          style={[styles.sub, { color: colors.muted, fontSize: font.xs }]}
          numberOfLines={1}
          maxFontSizeMultiplier={1.15}
        >
          {sub}
        </Text>
      </View>

      {trailing}
    </TouchableOpacity>
  );
});

/**
 * Real thumbnail for image files (server-generated), with the file icon
 * rendered underneath so the icon shows while the image streams in and as a
 * graceful fallback when the server has no thumbnail for the file.
 */
function FileThumb({ item, iconName, iconColor }: { item: FileItem; iconName: string; iconColor: string }) {
  const [failed, setFailed] = useState(false);
  const uri = mediaThumbnailUrl(item.root_id, item.path, 160);
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={styles.thumbFallback}>
        <MaterialCommunityIcons name={iconName as any} size={22} color={iconColor} />
      </View>
      {!failed && (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
          onError={() => setFailed(true)}
        />
      )}
    </View>
  );
}

export function Chevron() {
  const { colors } = useTheme();
  return <MaterialCommunityIcons name="chevron-right" size={20} color={colors.muted} />;
}

export function MoreButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity onPress={onPress} hitSlop={10} style={styles.more}>
      <MaterialCommunityIcons name="dots-vertical" size={20} color={colors.muted} />
    </TouchableOpacity>
  );
}

export function EmptyState({
  icon = "folder-open-outline",
  title,
  hint,
  action,
}: {
  icon?: string;
  title: string;
  hint?: string;
  action?: { label: string; onPress: () => void; icon?: string };
}) {
  const { colors, font, radius, spacing, shadowSm } = useTheme();
  return (
    <View style={styles.empty}>
      <View
        style={[
          styles.emptyIconOuter,
          { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radius.xl },
          shadowSm,
        ]}
      >
        <LinearGradient
          colors={["rgba(255,255,255,0.04)", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: radius.xl }]}
        />
        <View style={[styles.emptyIcon, { backgroundColor: colors.card, borderRadius: radius.md }]}>
          <MaterialCommunityIcons name={icon as any} size={32} color={colors.accent} style={{ opacity: 0.85 }} />
        </View>
      </View>
      <Text style={[styles.emptyTitle, { color: colors.content, fontSize: font.lg }]}>{title}</Text>
      {hint ? (
        <Text style={[styles.emptyHint, { color: colors.muted, fontSize: font.sm, maxWidth: 300 }]}>{hint}</Text>
      ) : null}
      {action ? (
        <TouchableOpacity
          onPress={action.onPress}
          activeOpacity={0.85}
          style={[
            styles.emptyAction,
            { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2, marginTop: spacing.sm },
          ]}
          accessibilityLabel={action.label}
          accessibilityRole="button"
        >
          {action.icon ? (
            <MaterialCommunityIcons name={action.icon as any} size={16} color="#fff" />
          ) : null}
          <Text style={[styles.emptyActionText, { fontSize: font.sm }]}>{action.label}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  const { colors, spacing, font } = useTheme();
  return (
    <Text
      style={[
        styles.section,
        {
          color: colors.muted,
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.xl,
          fontSize: font.xxs,
        },
      ]}
    >
      {children}
    </Text>
  );
}

const ROW_HEIGHT = IS_ANDROID ? 60 : 70;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_ANDROID ? 10 : 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrap: {
    width: IS_ANDROID ? 40 : 46,
    height: IS_ANDROID ? 40 : 46,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
  },
  thumbFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  videoBadge: {
    position: "absolute",
    bottom: 3,
    right: 3,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, marginLeft: 2 },
  title: { fontWeight: "600", letterSpacing: -0.1 },
  sub: { marginTop: 3, letterSpacing: 0.1 },
  more: { padding: 6 },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 64,
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyIconOuter: {
    width: 88,
    height: 88,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  emptyIcon: {
    width: 60,
    height: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { fontWeight: "700", letterSpacing: -0.2 },
  emptyHint: { textAlign: "center", lineHeight: 20 },
  emptyAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  emptyActionText: { color: "#fff", fontWeight: "700" },
  section: {
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.4,
    paddingBottom: 8,
  },
});

export { ROW_HEIGHT };
