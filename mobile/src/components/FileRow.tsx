import React, { memo } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, font, radius, spacing } from "../theme";
import { previewKind, formatBytes, formatDate } from "../api/client";
import type { FileItem } from "../api/types";

const KIND_ICON: Record<string, [string, string]> = {
  image: ["file-image-outline", "#5B8CFF"],
  video: ["video-outline", "#A78BFA"],
  audio: ["music-note", "#2DD4BF"],
  pdf: ["file-pdf-box", "#EF4444"],
  markdown: ["language-markdown-outline", "#35D3FF"],
  text: ["file-document-outline", "#8892A8"],
  code: ["code-tags", "#FBBF24"],
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

export function fileIconFor(item: FileItem): { name: string; color: string } {
  if (item.is_dir) return { name: "folder", color: colors.accent };
  const kind = previewKind(item);
  const [name, color] = KIND_ICON[kind];
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
}

/**
 * Memoized file/dir row. Keep the callback identities stable in parents
 * (useCallback) so FlatList rows don't re-render on scroll.
 */
export const FileRow = memo(function FileRow({ item, onPress, onLongPress, trailing, subtitle, showDate }: Props) {
  const { name, color } = fileIconFor(item);
  const sub =
    subtitle ??
    (item.is_dir ? "Folder" : `${formatBytes(item.size)} · ${showDate ? formatDate(item.modified) : ""}`.replace(/ · $/, ""));

  return (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.65}
      onPress={onPress ? () => onPress(item) : undefined}
      onLongPress={onLongPress ? () => onLongPress(item) : undefined}
      delayLongPress={400}
    >
      <View style={[styles.iconWrap, { backgroundColor: item.is_dir ? colors.accentSoft : colors.card }]}>
        <MaterialCommunityIcons name={name as any} size={20} color={color} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.sub} numberOfLines={1}>{sub}</Text>
      </View>
      {trailing}
    </TouchableOpacity>
  );
});

export function Chevron() {
  return <MaterialCommunityIcons name="chevron-right" size={20} color={colors.muted} />;
}

export function MoreButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} hitSlop={10} style={styles.more}>
      <MaterialCommunityIcons name="dots-horizontal" size={22} color={colors.muted} />
    </TouchableOpacity>
  );
}

export function EmptyState({ icon = "folder-open-outline", title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <MaterialCommunityIcons name={icon as any} size={30} color={colors.muted} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.emptyHint}>{hint}</Text> : null}
    </View>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

const ROW_HEIGHT = 64;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    height: ROW_HEIGHT,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, marginLeft: 4 },
  title: { color: colors.content, fontSize: font.md, fontWeight: "600" },
  sub: { color: colors.muted, fontSize: font.xs, marginTop: 2 },
  more: { padding: 4 },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 56,
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  emptyTitle: { color: colors.content, fontSize: font.md, fontWeight: "700" },
  emptyHint: { color: colors.muted, fontSize: font.sm, textAlign: "center", lineHeight: 19 },
  section: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 6,
  },
});

export { ROW_HEIGHT };
