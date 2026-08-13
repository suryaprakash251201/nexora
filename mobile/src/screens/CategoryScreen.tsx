import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSession } from "../store/SessionContext";
import { useTheme } from "../store/ThemeContext";
import { useAudio } from "../store/AudioContext";
import { FileRow, EmptyState, ROW_HEIGHT } from "../components/FileRow";
import { GridCard } from "../components/GridCard";
import { ListSkeleton, GridCardSkeleton } from "../components/Skeletons";
import { previewKind } from "../api/client";
import type { FileItem, SearchResult } from "../api/types";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Category">;

const PAGE = 200;

function toFileItem(r: SearchResult): FileItem {
  return {
    name: r.name,
    path: r.path,
    size: r.size,
    is_dir: r.is_dir,
    modified: r.modified,
    mime: r.mime,
    root_id: r.root_id,
    extension: r.extension,
  };
}

function monthKey(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  } catch {
    return "unknown";
  }
}

function monthLabel(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "long" });
  } catch {
    return "Other";
  }
}

const KIND_ICON: Record<string, string> = {
  image: "image-multiple",
  video: "play-circle",
  audio: "music-note",
  document: "file-document",
  archive: "package-variant",
};

/**
 * Category library — every file of one kind across ALL storage roots,
 * newest first, grouped by month/year. Replaces the old behaviour where the
 * Home category cards only showed a filtered view of the (tiny) recents list.
 */
export default function CategoryScreen({ route, navigation }: Props) {
  const { kind, title } = route.params;
  const { api } = useSession();
  const { colors, font, gradients, radius, spacing } = useTheme();
  const { playTrack, currentTrack } = useAudio();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const offsetRef = useRef(0);
  const seqRef = useRef(0);

  useEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  const load = useCallback(
    async (refresh = false) => {
      if (!api) return;
      const seq = ++seqRef.current;
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await api.library(kind, PAGE, refresh ? 0 : offsetRef.current);
        if (seq !== seqRef.current) return;
        setItems((prev) => (refresh ? res.items : [...prev, ...res.items]));
        offsetRef.current = (refresh ? 0 : offsetRef.current) + res.items.length;
        setHasMore(res.has_more);
      } catch (e: any) {
        if (seq !== seqRef.current) return;
        setError(e?.message || "Could not load this library.");
      } finally {
        if (seq === seqRef.current) {
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    },
    [api, kind]
  );

  useEffect(() => {
    load(true);
    return () => {
      seqRef.current++;
    };
  }, [load]);

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore || loading) return;
    setLoadingMore(true);
    load(false);
  }, [hasMore, loadingMore, loading, load]);

  // Group by month/year, newest first (the API already returns newest first).
  const sections = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    for (const it of items) {
      const key = monthKey(it.modified);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, list]) => ({ key, label: monthLabel(list[0].modified), items: list }));
  }, [items]);

  const openItem = useCallback(
    (r: SearchResult) => {
      const item = toFileItem(r);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      if (item.is_dir) {
        // Open folders inside the file explorer.
        navigation.navigate("Browser", {
          rootId: item.root_id,
          rootName: item.name,
          path: item.path,
        });
      } else if (previewKind(item) === "audio") {
        playTrack(item, items.filter((x) => !x.is_dir && previewKind(toFileItem(x)) === "audio").map(toFileItem));
      } else {
        navigation.navigate("Preview", { item, rootId: item.root_id });
      }
    },
    [navigation, playTrack, items]
  );

  const isCurrent = (r: SearchResult) =>
    !!currentTrack && currentTrack.root_id === r.root_id && currentTrack.path === r.path;

  const renderItemRow = useCallback(
    (item: SearchResult) => (
      <View
        key={item.root_id + item.path}
        style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSoft }}
      >
        <FileRow
          item={toFileItem(item)}
          onPress={() => openItem(item)}
          trailing={
            isCurrent(item) ? (
              <EqBarsInline />
            ) : (
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.muted} style={{ opacity: 0.4 }} />
            )
          }
        />
      </View>
    ),
    [colors.borderSoft, openItem, isCurrent]
  );

  const renderGridItem = useCallback(
    (item: SearchResult) => {
      const file = toFileItem(item);
      return (
        <GridCard
          key={item.root_id + item.path}
          item={file}
          rawUrl={api && previewKind(file) === "image" ? api.thumbnailUrl(file.root_id, file.path, 512) : undefined}
          onPress={() => openItem(item)}
          onLongPress={() => openItem(item)}
          onMorePress={() => openItem(item)}
        />
      );
    },
    [api, openItem]
  );

  const renderSection = useCallback(
    (section: { key: string; label: string; items: SearchResult[] }) => (
      <View>
        <View style={[styles.sectionHeader, { paddingHorizontal: spacing.lg }]}>
          <MaterialCommunityIcons name="calendar-month-outline" size={14} color={colors.accent} />
          <Text style={[styles.sectionTitle, { color: colors.content, fontSize: font.sm }]}>
            {section.label}
          </Text>
          <Text style={[styles.sectionCount, { color: colors.muted, fontSize: font.xs }]}>
            {section.items.length}
          </Text>
        </View>
        {section.items.map(renderItemRow)}
      </View>
    ),
    [spacing.lg, font.sm, font.xs, colors, renderItemRow]
  );

  const header = useCallback(
    () =>
      items.length > 0 ? (
        <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radius.xl, marginHorizontal: spacing.lg }]}>
          <LinearGradient colors={["rgba(255,255,255,0.04)", "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <MaterialCommunityIcons name={(KIND_ICON[kind] || "folder") as any} size={18} color={colors.accent} />
          <Text style={[styles.summaryText, { color: colors.content, fontSize: font.sm }]}>
            {items.length} file{items.length === 1 ? "" : "s"} across your storage
          </Text>
          <View style={{ flex: 1 }} />
          {/* View mode toggle — list / grid */}
          <TouchableOpacity
            style={[styles.viewToggle, { backgroundColor: colors.surfaceElevated }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              setViewMode(viewMode === "list" ? "grid" : "list");
            }}
            hitSlop={8}
          >
            <MaterialCommunityIcons
              name={viewMode === "list" ? "view-grid-outline" : "format-list-bulleted"}
              size={18}
              color={colors.content}
            />
          </TouchableOpacity>
        </View>
      ) : null,
    [items.length, colors, font.sm, kind, radius.xl, spacing.lg, viewMode]
  );

  const empty = useCallback(
    () =>
      loading ? (
        viewMode === "grid" ? (
          <View style={styles.gridSkeleton}>
            <GridCardSkeleton />
            <GridCardSkeleton />
            <GridCardSkeleton />
            <GridCardSkeleton />
          </View>
        ) : (
          <ListSkeleton rows={8} />
        )
      ) : (
        <EmptyState
          icon={error ? "alert-circle-outline" : KIND_ICON[kind] || "folder-outline"}
          title={error || `No ${title.toLowerCase()} found`}
          hint={error ? "Pull down to retry." : `Files in ${title} across all your storage will appear here.`}
        />
      ),
    [loading, viewMode, error, kind, title]
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <FlatList
        key={viewMode}
        data={viewMode === "list" ? (sections as any) : items}
        keyExtractor={(it) => (viewMode === "list" ? (it as any).key : (it as SearchResult).root_id + (it as SearchResult).path)}
        numColumns={viewMode === "grid" ? 2 : 1}
        renderItem={viewMode === "list" ? ({ item }) => renderSection(item as any) : ({ item }) => renderGridItem(item as SearchResult)}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120, paddingHorizontal: viewMode === "grid" ? 6 : 0 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={header()}
        ListEmptyComponent={empty()}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginVertical: 16 }} color={colors.accent} /> : null}
      />
    </View>
  );
}

/** Inline animated EQ indicator for the currently playing row. */
function EqBarsInline() {
  const { colors } = useTheme();
  return (
    <View style={styles.eqRow}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.eqBar, { backgroundColor: colors.accent }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  summaryCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 4,
    borderWidth: 1,
    overflow: "hidden",
  },
  summaryText: { fontWeight: "600" },
  viewToggle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  gridSkeleton: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 6,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 18,
    paddingBottom: 6,
  },
  sectionTitle: { fontWeight: "700", textTransform: "capitalize" },
  sectionCount: { fontWeight: "600", marginLeft: 2 },
  eqRow: { flexDirection: "row", alignItems: "center", gap: 3, height: 16 },
  eqBar: {
    width: 3,
    height: 14,
    borderRadius: 2,
    opacity: 0.9,
  },
});
