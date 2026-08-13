import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSession } from "../store/SessionContext";
import { useTheme } from "../store/ThemeContext";
import { useAudio } from "../store/AudioContext";
import { useSettings, haptic } from "../store/SettingsContext";
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
  const { prefs, setPref } = useSettings();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "grid">(prefs.viewMode);
  // Fullscreen photo pager (image gallery only). The open/closed state and
  // the current page are kept SEPARATE so a late onMomentumScrollEnd (fired
  // after the user hits ✕ while the pager is still decelerating) can never
  // re-open the modal by writing back a page index.
  const [pagerOpen, setPagerOpen] = useState(false);
  const [pagerIdx, setPagerIdx] = useState(0);
  const { width: winW } = useWindowDimensions();
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
      haptic();
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

  // ── Gallery helpers (kind === "image") ──────────────────────────────
  const pagerItem = pagerOpen ? items[pagerIdx] : undefined;
  const downloadOrSharePhoto = async (share: boolean) => {
    if (!api || !pagerItem) return;
    try {
      const target = new File(
        Paths.cache,
        "nexora-" + pagerItem.name.replace(/[^\w.\-]+/g, "_")
      );
      await File.downloadFileAsync(
        api.rawFileUrl(pagerItem.root_id, pagerItem.path),
        target
      );
      if (share && (await Sharing.isAvailableAsync())) {
        await Sharing.shareAsync(target.uri, { mimeType: pagerItem.mime || undefined });
      } else {
        Alert.alert("Downloaded", `"${pagerItem.name}" saved to the app cache.`);
      }
    } catch (e: any) {
      Alert.alert("Download failed", e?.message || "Something went wrong.");
    }
  };

  const galleryList = useMemo(() => items.filter((it) => !it.is_dir), [items]);

  const renderGalleryCell = useCallback(
    (item: SearchResult, index: number) => (
      <TouchableOpacity
        style={styles.galCell}
        activeOpacity={0.85}
        onPress={() => {
          setPagerIdx(index);
          setPagerOpen(true);
        }}
        onLongPress={() => openItem(item)}
        delayLongPress={350}
      >
        <Image
          source={{ uri: api?.thumbnailUrl(item.root_id, item.path, 512) }}
          style={styles.galImg}
          contentFit="cover"
          transition={150}
          cachePolicy="memory-disk"
        />
      </TouchableOpacity>
    ),
    [api, openItem]
  );

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
            {items.length} photo{items.length === 1 ? "" : "s"} · tap to view
          </Text>
          <View style={{ flex: 1 }} />
          {/* View mode toggle — hidden in gallery mode (photos are always a gallery) */}
          {kind !== "image" && (
            <TouchableOpacity
              style={[styles.viewToggle, { backgroundColor: colors.surfaceElevated }]}
              onPress={() => {
                haptic();
                const next = viewMode === "list" ? "grid" : "list";
                setViewMode(next);
                setPref("viewMode", next);
              }}
              hitSlop={8}
            >
              <MaterialCommunityIcons
                name={viewMode === "list" ? "view-grid-outline" : "format-list-bulleted"}
                size={18}
                color={colors.content}
              />
            </TouchableOpacity>
          )}
        </View>
      ) : null,
    [items.length, colors, font.sm, kind, radius.xl, spacing.lg, viewMode, setPref]
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
      {kind === "image" ? (
        /* ══ IMAGE GALLERY — dense 3-column grid + fullscreen pager ══ */
        <>
          <FlatList
            data={galleryList}
            numColumns={3}
            keyExtractor={(it) => it.root_id + it.path}
            renderItem={({ item, index }) => renderGalleryCell(item, index)}
            contentContainerStyle={{ paddingBottom: insets.bottom + 120, paddingHorizontal: 2 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
            ListHeaderComponent={header()}
            ListEmptyComponent={empty()}
            ListFooterComponent={
              loadingMore ? <ActivityIndicator style={{ marginVertical: 16 }} color={colors.accent} /> : null
            }
          />

          {/* Fullscreen photo pager — swipe between photos, tap image to close */}
          <Modal
            visible={pagerOpen}
            transparent={false}
            animationType="fade"
            onRequestClose={() => setPagerOpen(false)}
            statusBarTranslucent
          >
            <View style={styles.pagerRoot}>
              <FlatList
                data={galleryList}
                horizontal
                pagingEnabled
                initialScrollIndex={pagerIdx}
                getItemLayout={(_, i) => ({ length: winW, offset: winW * i, index: i })}
                onMomentumScrollEnd={(e) =>
                  setPagerIdx(Math.round(e.nativeEvent.contentOffset.x / winW))
                }
                keyExtractor={(it) => it.root_id + it.path}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    activeOpacity={1}
                    style={[styles.pagerPage, { width: winW }]}
                    onPress={() => setPagerOpen(false)}
                  >
                    <Image
                      source={{ uri: api?.thumbnailUrl(item.root_id, item.path, 1600) }}
                      style={styles.pagerImg}
                      contentFit="contain"
                      transition={150}
                      cachePolicy="memory-disk"
                    />
                  </TouchableOpacity>
                )}
              />

              {/* Top bar: close + counter */}
              <View style={[styles.pagerTop, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity style={styles.pagerClose} onPress={() => setPagerOpen(false)} activeOpacity={0.8} hitSlop={8}>
                  <MaterialCommunityIcons name="close" size={24} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.pagerCount}>
                  {pagerIdx + 1} / {galleryList.length}
                </Text>
                <View style={{ width: 44 }} />
              </View>

              {/* Bottom bar: download / share current photo */}
              <View style={[styles.pagerFooter, { paddingBottom: insets.bottom + 20 }]}>
                <TouchableOpacity style={styles.pagerBtn} onPress={() => downloadOrSharePhoto(false)} activeOpacity={0.85}>
                  <MaterialCommunityIcons name="download" size={20} color="#fff" />
                  <Text style={styles.pagerBtnText}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.pagerBtn} onPress={() => downloadOrSharePhoto(true)} activeOpacity={0.85}>
                  <MaterialCommunityIcons name="share-variant" size={20} color="#fff" />
                  <Text style={styles.pagerBtnText}>Share</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.pagerBtn}
                  onPress={() => {
                    const cur = pagerItem;
                    setPagerOpen(false);
                    if (cur) {
                      navigation.navigate("Preview", { item: toFileItem(cur), rootId: cur.root_id });
                    }
                  }}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons name="open-in-new" size={20} color="#fff" />
                  <Text style={styles.pagerBtnText}>Info</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        </>
      ) : (
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
          ListFooterComponent={
            loadingMore ? <ActivityIndicator style={{ marginVertical: 16 }} color={colors.accent} /> : null
          }
        />
      )}
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

  // ── Image gallery (kind === "image") ──
  galCell: {
    flex: 1,
    aspectRatio: 1,
    margin: 1.5,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: "rgba(128,128,128,0.12)",
  },
  galImg: { width: "100%", height: "100%" },
  pagerRoot: { flex: 1, backgroundColor: "#000" },
  pagerPage: { height: "100%", alignItems: "center", justifyContent: "center" },
  pagerImg: { width: "100%", height: "100%" },
  pagerTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  pagerClose: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  pagerCount: { color: "#fff", fontWeight: "700", fontSize: 15, fontVariant: ["tabular-nums"] },
  pagerFooter: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 14,
    paddingTop: 16,
  },
  pagerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  pagerBtnText: { color: "#fff", fontWeight: "600", fontSize: 13 },

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
