import React, { memo } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useTheme } from "../store/ThemeContext";
import { previewKind, formatBytes, formatDate } from "../api/client";
import type { FileItem } from "../api/types";

const KIND_ICON: Record<string, [string, string]> = {
  image: ["image-outline", "#5B8CFF"],
  video: ["play-circle-outline", "#A78BFA"],
  audio: ["music-circle-outline", "#2DD4BF"],
  pdf: ["file-pdf-box", "#EF4444"],
  markdown: ["language-markdown-outline", "#35D3FF"],
  text: ["file-document-outline", "#8892A8"],
  code: ["code-braces", "#FBBF24"],
  other: ["file-outline", "#8892A8"],
};

const EXT_COLORS: Record<string, string> = {
  zip: "#F59E0B", rar: "#F59E0B", "7z": "#F59E0B", tar: "#F59E0B", gz: "#F59E0B",
  xlsx: "#22C55E", xls: "#22C55E", csv: "#22C55E",
  docx: "#3B82F6", doc: "#3B82F6", rtf: "#3B82F6",
  pptx: "#F97316", ppt: "#F97316",
  json: "#FBBF24", yaml: "#FBBF24", yml: "#FBBF24", xml: "#FBBF24",
  go: "#35D3FF", py: "#35D3FF", js: "#FBBF24", ts: "#5B8CFF", rs: "#F97316",
  exe: "#A78BFA", app: "#A78BFA", dmg: "#A78BFA", iso: "#A78BFA",
};

export function fileIconFor(item: FileItem, defaultAccent: string = "#5B8CFF"): { name: string; color: string } {
  if (item.is_dir) return { name: "folder", color: defaultAccent };
  const kind = previewKind(item);
  const [name, color] = KIND_ICON[kind] || KIND_ICON.other;
  const extColor = EXT_COLORS[(item.extension || "").toLowerCase()];
  return { name, color: extColor || color };
}

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
      activeOpacity={0.6}
      onPress={() => (selectMode && onSelect ? onSelect(item) : onPress ? onPress(item) : undefined)}
      onLongPress={onLongPress ? () => onLongPress(item) : undefined}
      delayLongPress={350}
    >
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

      <View style={[styles.iconWrap, { backgroundColor: `${color}18` }]}>
        <MaterialCommunityIcons name={name as any} size={22} color={color} />
      </View>

      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.content, fontSize: font.md }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.sub, { color: colors.muted, fontSize: font.xs }]} numberOfLines={1}>
          {sub}
        </Text>
      </View>

      {trailing}
    </TouchableOpacity>
  );
});

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

const ROW_HEIGHT = 68;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
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
    width: 46,
    height: 46,
    borderRadius: 14,
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
