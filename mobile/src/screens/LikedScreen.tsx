import React, { useCallback, useEffect, useState } from "react";
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
import { useSession } from "../store/SessionContext";
import { useTheme } from "../store/ThemeContext";
import { useAudio } from "../store/AudioContext";
import { FileRow, EmptyState, ROW_HEIGHT } from "../components/FileRow";
import { ListSkeleton } from "../components/Skeletons";
import { previewKind } from "../api/client";
import type { FileItem, FavoriteItem } from "../api/types";

function toFileItem(f: FavoriteItem): FileItem {
  return {
    name: f.name,
    path: f.path,
    size: 0,
    is_dir: false,
    modified: f.created_at,
    mime: "",
    root_id: f.root_id,
    extension: f.name.includes(".") ? f.name.split(".").pop() || "" : "",
  };
}

/**
 * Liked Songs — every favorited audio file, newest first, playable as a
 * continuous queue. Opened from the "Liked Songs" card on Home.
 */
export default function LikedScreen() {
  const { api } = useSession();
  const { colors, font, gradients, radius, spacing, shadowSm } = useTheme();
  const { playTrack, currentTrack, player } = useAudio();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!player) return;
    const sub = player.addListener("playingChange", ({ isPlaying }: { isPlaying: boolean }) =>
      setPlaying(isPlaying)
    );
    return () => {
      sub.remove();
    };
  }, [player]);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!api) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await api.listFavorites();
        const songs = (res.items || [])
          .filter((f) => previewKind(toFileItem(f)) === "audio")
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        setItems(songs);
      } catch (e: any) {
        setError(e?.message || "Failed to load liked songs.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [api]
  );

  useEffect(() => {
    load();
  }, [load]);

  const playAll = useCallback(
    (index = 0) => {
      if (items.length === 0) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      playTrack(toFileItem(items[index]), items.map(toFileItem));
    },
    [items, playTrack]
  );

  const openItem = useCallback(
    (f: FavoriteItem) => {
      const idx = items.findIndex((x) => x.root_id === f.root_id && x.path === f.path);
      playAll(Math.max(0, idx));
    },
    [items, playAll]
  );

  const unlike = useCallback(
    async (f: FavoriteItem) => {
      if (!api || busyPath) return;
      setBusyPath(f.path);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      try {
        await api.removeFavorite(f.root_id, f.path);
        setItems((prev) => prev.filter((x) => x.root_id !== f.root_id || x.path !== f.path));
      } catch {
        setError("Could not remove from liked songs.");
      } finally {
        setBusyPath(null);
      }
    },
    [api, busyPath]
  );

  const isCurrent = (f: FavoriteItem) =>
    !!currentTrack && currentTrack.root_id === f.root_id && currentTrack.path === f.path;

  const renderRow = useCallback(
    ({ item }: { item: FavoriteItem }) => {
      const cur = isCurrent(item);
      return (
        <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSoft }}>
          <FileRow
            item={toFileItem(item)}
            onPress={() => openItem(item)}
            onLongPress={() => unlike(item)}
            trailing={
              cur && playing ? (
                <View style={styles.eqRow}>
                  {[0, 1, 2].map((i) => (
                    <View key={i} style={[styles.eqBar, { backgroundColor: colors.accent }]} />
                  ))}
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.heartBtn, { backgroundColor: "rgba(244,63,94,0.12)" }]}
                  onPress={() => unlike(item)}
                  hitSlop={8}
                >
                  {busyPath === item.path ? (
                    <ActivityIndicator size="small" color={colors.danger} />
                  ) : (
                    <MaterialCommunityIcons name="heart" size={16} color={colors.danger} />
                  )}
                </TouchableOpacity>
              )
            }
          />
        </View>
      );
    },
    [colors.borderSoft, colors.accent, colors.danger, busyPath, openItem, unlike, isCurrent, playing]
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <FlatList
        data={items}
        keyExtractor={(it) => it.root_id + it.path}
        renderItem={renderRow}
        getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
        ListHeaderComponent={
          items.length > 0 ? (
            <View style={[styles.hero, { paddingHorizontal: spacing.lg }]}>
              <View style={[styles.coverWrap, shadowSm]}>
                <LinearGradient colors={["#F43F5E", "#BE123C"]} style={StyleSheet.absoluteFill}>
                  <View style={styles.coverInner}>
                    <MaterialCommunityIcons name="heart" size={44} color="#fff" />
                  </View>
                </LinearGradient>
              </View>
              <Text style={[styles.title, { color: colors.content, fontSize: font.xl }]}>Liked Songs</Text>
              <Text style={[styles.meta, { color: colors.muted, fontSize: font.sm }]}>
                {items.length} song{items.length === 1 ? "" : "s"} · tap a row to play
              </Text>
              <TouchableOpacity
                style={[styles.playAll, { borderRadius: radius.pill }]}
                activeOpacity={0.85}
                onPress={() => playAll(0)}
              >
                <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                <MaterialCommunityIcons name="play" size={18} color="#fff" />
                <Text style={[styles.playAllText, { fontSize: font.sm }]}>Play all</Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
        ListEmptyComponent={
          loading ? (
            <ListSkeleton rows={8} />
          ) : (
            <EmptyState
              icon={error ? "alert-circle-outline" : "heart-outline"}
              title={error || "No liked songs yet"}
              hint={error ? "Pull down to retry." : "Tap the heart on any song to add it here."}
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: { alignItems: "center", paddingTop: 16, paddingBottom: 16 },
  coverWrap: {
    width: 132,
    height: 132,
    borderRadius: 22,
    overflow: "hidden",
    marginBottom: 14,
  },
  coverInner: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontWeight: "800" },
  meta: { marginTop: 4, fontWeight: "500" },
  playAll: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 26,
    paddingVertical: 11,
    overflow: "hidden",
  },
  playAllText: { color: "#fff", fontWeight: "700" },
  heartBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  eqRow: { flexDirection: "row", alignItems: "center", gap: 3, height: 16, width: 30, justifyContent: "center" },
  eqBar: { width: 3, height: 14, borderRadius: 2, opacity: 0.9 },
});
