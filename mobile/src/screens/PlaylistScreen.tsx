import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSession } from "../store/SessionContext";
import { useTheme } from "../store/ThemeContext";
import { useAudio } from "../store/AudioContext";
import { FileRow, EmptyState, ROW_HEIGHT } from "../components/FileRow";
import { BottomSheet } from "../components/BottomSheet";
import { AudioCover } from "../components/AudioCover";
import { EqBars } from "../components/EqBars";
import { PressScale } from "../components/motion";
import { isAudioFile } from "../lib/fileMeta";
import type { FileItem, Playlist, PlaylistItem } from "../api/types";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Playlist">;

function toFileItem(p: PlaylistItem): FileItem {
  return {
    name: p.name,
    path: p.path,
    size: p.size || 0,
    is_dir: false,
    modified: p.modified || p.created_at,
    mime: p.mime,
    root_id: p.root_id,
    extension: p.extension,
  };
}

/**
 * Playlist detail — playlists are created/synced from the web app via the
 * shared /playlists API. Shows every track, plays the whole list in order,
 * and lets you remove tracks or toggle favorites on the go.
 */
export default function PlaylistScreen({ route, navigation }: Props) {
  const initial = route.params.playlist;
  const { api } = useSession();
  const { colors, font, gradients, radius, spacing, shadow, shadowSm, isDark } = useTheme();
  const { playTrack, currentTrack, player } = useAudio();
  const insets = useSafeAreaInsets();

  const [playlist, setPlaylist] = useState<Playlist>(initial);
  const [actionItem, setActionItem] = useState<PlaylistItem | null>(null);
  const [favoritedPaths, setFavoritedPaths] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState(false);

  // Live playing state for the row equalizer.
  useEffect(() => {
    if (!player) return;
    const sub = player.addListener("playingChange", ({ isPlaying }: { isPlaying: boolean }) =>
      setPlaying(isPlaying)
    );
    return () => {
      sub.remove();
    };
  }, [player]);

  const files = useMemo(() => playlist.items.map(toFileItem), [playlist.items]);

  // Keep the header in sync with the playlist name.
  useEffect(() => {
    navigation.setOptions({ title: playlist.name });
  }, [playlist.name, navigation]);

  // Load favorites so the row sheet can show the right heart state.
  useEffect(() => {
    let cancelled = false;
    api
      ?.listFavorites()
      .then((res) => {
        if (cancelled) return;
        setFavoritedPaths(new Set(res.items.map((f) => `${f.root_id}|${f.path}`)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Refresh from the server when the screen regains focus — keeps it in sync
  // with changes made in the web app.
  useEffect(() => {
    const unsub = navigation.addListener("focus", () => {
      api
        ?.listPlaylists()
        .then((res) => {
          const fresh = res.items.find((p) => p.id === playlist.id);
          if (fresh) setPlaylist(fresh);
        })
        .catch(() => {});
    });
    return unsub;
  }, [navigation, api, playlist.id]);

  const playAll = useCallback(
    (index = 0) => {
      if (files.length === 0) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      playTrack(files[index], files);
    },
    [files, playTrack]
  );

  const shuffleAll = useCallback(() => {
    if (files.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const shuffled = [...files].sort(() => Math.random() - 0.5);
    playTrack(shuffled[0], shuffled);
  }, [files, playTrack]);

  const openItem = useCallback(
    (item: PlaylistItem) => {
      const idx = playlist.items.findIndex((x) => x.root_id === item.root_id && x.path === item.path);
      playAll(Math.max(0, idx));
    },
    [playlist.items, playAll]
  );

  const toggleFavorite = useCallback(
    (item: PlaylistItem) => {
      if (!api) return;
      const key = `${item.root_id}|${item.path}`;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      if (favoritedPaths.has(key)) {
        api
          .removeFavorite(item.root_id, item.path)
          .then(() =>
            setFavoritedPaths((prev) => {
              const next = new Set(prev);
              next.delete(key);
              return next;
            })
          )
          .catch(() => {});
      } else {
        api
          .addFavorite(item.root_id, item.path)
          .then(() => setFavoritedPaths((prev) => new Set(prev).add(key)))
          .catch(() => {});
      }
    },
    [api, favoritedPaths]
  );

  const removeFromPlaylist = useCallback(
    (item: PlaylistItem) => {
      if (!api) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      setPlaylist((prev) => ({
        ...prev,
        items: prev.items.filter((x) => !(x.root_id === item.root_id && x.path === item.path)),
      }));
      setActionItem(null);
      api
        .removePlaylistItem(playlist.id, item.id)
        .then(() => {})
        .catch(() => Alert.alert("Could not remove track", "Try again in a moment."));
    },
    [api, playlist.id]
  );

  const coverUrl =
    playlist.cover_root_id && playlist.cover_path
      ? api?.thumbnailUrl(playlist.cover_root_id, playlist.cover_path, 512)
      : undefined;

  const renderRow = useCallback(
    ({ item, index }: { item: PlaylistItem; index: number }) => {
      const isCur =
        !!currentTrack && currentTrack.root_id === item.root_id && currentTrack.path === item.path;
      return (
        <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSoft }}>
          <FileRow
            item={toFileItem(item)}
            onPress={() => openItem(item)}
            onLongPress={() => setActionItem(item)}
            trailing={
              isCur && playing ? (
                <EqBars playing barCount={3} tint={colors.accent} />
              ) : isCur ? (
                <MaterialCommunityIcons name="volume-high" size={18} color={colors.accent} />
              ) : (
                <TouchableOpacity
                  style={[styles.rowPlay, { backgroundColor: colors.accentSoft }]}
                  onPress={() => openItem(item)}
                  hitSlop={8}
                >
                  <MaterialCommunityIcons name="play" size={14} color={colors.accent} style={{ marginLeft: 1 }} />
                </TouchableOpacity>
              )
            }
          />
        </View>
      );
    },
    [colors.borderSoft, colors.accentSoft, colors.accent, openItem, currentTrack, playing]
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <FlatList
        data={playlist.items}
        keyExtractor={(it, i) => it.root_id + it.path + i}
        renderItem={renderRow}
        getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        ListHeaderComponent={
          <View>
            {/* Playlist hero */}
            <View style={styles.hero}>
              <View style={[styles.coverWrap, shadow]}>
                {coverUrl ? (
                  <Image source={{ uri: coverUrl }} style={styles.cover} contentFit="cover" transition={200} />
                ) : playlist.items.length > 0 ? (
                  <AudioCover item={toFileItem(playlist.items[0])} size={512} iconSize={56} />
                ) : (
                  <LinearGradient colors={[...gradients.brand]} style={StyleSheet.absoluteFill}>
                    <View style={styles.coverPlaceholder}>
                      <MaterialCommunityIcons name="playlist-music" size={56} color="#fff" />
                    </View>
                  </LinearGradient>
                )}
              </View>
              <Text style={[styles.name, { color: colors.content, fontSize: font.xl }]} numberOfLines={2}>
                {playlist.name}
              </Text>
              <Text style={[styles.meta, { color: colors.muted, fontSize: font.sm }]}>
                {playlist.items.length} track{playlist.items.length === 1 ? "" : "s"}
                {playlist.is_public ? " · Public" : ""} · Synced with web
              </Text>

              <View style={styles.heroButtons}>
                <PressScale scaleTo={0.94}>
                <TouchableOpacity
                  style={[styles.playBtn, { borderRadius: radius.pill }]}
                  activeOpacity={0.85}
                  onPress={() => playAll(0)}
                  disabled={playlist.items.length === 0}
                >
                  <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                  <MaterialCommunityIcons name="play" size={20} color="#fff" />
                  <Text style={[styles.playBtnText, { fontSize: font.sm }]}>Play all</Text>
                </TouchableOpacity>
                </PressScale>

                <PressScale scaleTo={0.94}>
                <TouchableOpacity
                  style={[styles.shuffleBtn, { borderRadius: radius.pill, borderColor: colors.border }]}
                  activeOpacity={0.85}
                  onPress={shuffleAll}
                  disabled={playlist.items.length === 0}
                >
                  <MaterialCommunityIcons name="shuffle-variant" size={18} color={colors.content} />
                  <Text style={[styles.shuffleBtnText, { color: colors.content, fontSize: font.sm }]}>Shuffle</Text>
                </TouchableOpacity>
                </PressScale>
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="playlist-music"
            title="This playlist is empty"
            hint="Add songs to this playlist in the Nexora web app — it will show up here automatically."
          />
        }
      />

      <BottomSheet
        visible={actionItem !== null}
        onClose={() => setActionItem(null)}
        title={actionItem?.name}
        actions={[
          {
            label: "Play now",
            icon: "play-circle-outline",
            onPress: () => actionItem && openItem(actionItem),
          },
          {
            label: favoritedPaths.has(`${actionItem?.root_id}|${actionItem?.path}`) ? "Remove from favorites" : "Add to favorites",
            icon: "heart-outline",
            onPress: () => actionItem && toggleFavorite(actionItem),
          },
          {
            label: "Remove from playlist",
            icon: "playlist-remove",
            destructive: true,
            onPress: () => actionItem && removeFromPlaylist(actionItem),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 20,
  },
  coverWrap: {
    width: 200,
    height: 200,
    borderRadius: 24,
    overflow: "hidden",
    marginBottom: 18,
  },
  cover: { width: "100%", height: "100%" },
  coverPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  name: { fontWeight: "800", textAlign: "center", paddingHorizontal: 12 },
  meta: { marginTop: 6, fontWeight: "500", textAlign: "center" },
  heroButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 18,
  },
  playBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 28,
    paddingVertical: 12,
    overflow: "hidden",
  },
  playBtnText: { color: "#fff", fontWeight: "700" },
  shuffleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderWidth: 1,
  },
  shuffleBtnText: { fontWeight: "700" },
  rowPlay: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  rowIndex: {
    width: 32,
    alignItems: "flex-end",
    paddingRight: 4,
  },
  rowIndexText: { fontFamily: "monospace", fontSize: 12, fontWeight: "700" },
});
