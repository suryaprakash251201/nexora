import React from "react";
import { Text, View, StyleSheet } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors } from "../theme";
import { previewKind } from "../api/client";
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

export function FileIcon({ item, size = 40 }: { item: FileItem; size?: number }) {
  if (item.is_dir) {
    return (
      <View style={[styles.iconWrap, { backgroundColor: colors.accentSoft }]}>
        <MaterialCommunityIcons name="folder" size={size * 0.55} color={colors.accent} />
      </View>
    );
  }
  const kind = previewKind(item);
  const [name, color] = KIND_ICON[kind];
  const extColor = EXT_COLORS[(item.extension || "").toLowerCase()];
  return (
    <View style={[styles.iconWrap, { backgroundColor: colors.card }]}>
      <MaterialCommunityIcons name={name as any} size={size * 0.55} color={extColor || color} />
    </View>
  );
}

export function EmptyState({ icon = "folder-open-outline", title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <View style={styles.empty}>
      <MaterialCommunityIcons name={icon as any} size={48} color={colors.muted} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.emptyHint}>{hint}</Text> : null}
    </View>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyTitle: {
    color: colors.content,
    fontSize: 15,
    fontWeight: "600",
  },
  emptyHint: {
    color: colors.muted,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  section: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
});
