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
  const { colors, font, spacing } = useTheme();
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
        },
      ]}
      activeOpacity={0.8}
      onPress={() => (selectMode && onSelect ? onSelect(item) : onPress ? onPress(item) : undefined)}
      onLongPress={onLongPress ? () => onLongPress(item) : undefined}
      delayLongPress={350}
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
        >
          {selected && <MaterialCommunityIcons name="check" size={14} color="#fff" />}
        </TouchableOpacity>
      )}

      <View style={[styles.iconWrap, { backgroundColor: item.is_dir ? "transparent" : `${color}18` }]}>
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
        <Text style={[styles.title, { color: colors.content, fontSize: font.md }]} numberOfLines={1} maxFontSizeMultiplier={1.15}>
          {splitHighlight(item.name, highlight ?? "").map((part, i) =>
            part.hit ? (
              <Text key={i} style={{ color: colors.accent, fontWeight: "800" }}>{part.text}</Text>
            ) : (
              <Text key={i}>{part.text}</Text>
            )
          )}
        </Text>
        <Text style={[styles.sub, { color: colors.muted, fontSize: font.xs }]} numberOfLines={1} maxFontSizeMultiplier={1.15}>
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

export function EmptyState({ icon = "folder-open-outline", title, hint }: { icon?: string; title: string; hint?: string }) {
  const { colors, font, shadowSm } = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIconOuter, { backgroundColor: colors.surface, borderColor: colors.borderSoft }, shadowSm]}>
        <LinearGradient
          colors={["rgba(255,255,255,0.04)", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: 24, position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
        <View style={[styles.emptyIcon, { backgroundColor: colors.card }]}>
          <MaterialCommunityIcons name={icon as any} size={32} color={colors.muted} />
        </View>
      </View>
      <Text style={[styles.emptyTitle, { color: colors.content, fontSize: font.lg }]}>{title}</Text>
      {hint ? <Text style={[styles.emptyHint, { color: colors.muted, fontSize: font.sm }]}>{hint}</Text> : null}
    </View>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  const { colors, spacing } = useTheme();
  return (
    <Text
      style={[
        styles.section,
        {
          color: colors.muted,
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.xl,
        },
      ]}
    >
      {children}
    </Text>
  );
}

const ROW_HEIGHT = IS_ANDROID ? 58 : 68;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_ANDROID ? 10 : 12,
    height: ROW_HEIGHT,
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
    borderRadius: IS_ANDROID ? 12 : 14,
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
  title: { fontWeight: "600", letterSpacing: 0.1 },
  sub: { marginTop: 3 },
  more: { padding: 6 },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 64,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyIconOuter: {
    width: 80,
    height: 80,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { fontWeight: "700" },
  emptyHint: { textAlign: "center", lineHeight: 20, maxWidth: 280 },
  section: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    paddingBottom: 8,
  },
});

export { ROW_HEIGHT };
