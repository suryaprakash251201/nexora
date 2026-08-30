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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSession } from "../store/SessionContext";
import { useTheme } from "../store/ThemeContext";
import { ListSkeleton } from "../components/Skeletons";
import { EmptyState } from "../components/FileRow";
import type { Playlist } from "../api/types";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Playlists">;

/**
 * All playlists — opened from the "Playlists" card on Home. Every playlist
 * shows its playlist icon, name and track count; tap to open the detail
 * screen (play all, shuffle, manage tracks).
 */
export default function PlaylistsScreen({ navigation }: Props) {
  const { api } = useSession();
  const { colors, font, gradients, radius, spacing, shadowSm } = useTheme();
  const insets = useSafeAreaInsets();

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!api) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const [mine, pub] = await Promise.all([
          api.listPlaylists().catch(() => ({ items: [] as Playlist[] })),
          api.listPublicPlaylists().catch(() => ({ items: [] as Playlist[] })),
        ]);
        const seen = new Set((mine.items || []).map((pl) => pl.id));
        const publicOnly = (pub.items || []).filter((pl) => !seen.has(pl.id));
        // Show private/shared first, then public from others
        setPlaylists([...(mine.items || []), ...publicOnly]);
      } catch (e: any) {
        setError(e?.message || "Failed to load playlists.");
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

  // Refresh when returning from a playlist detail (tracks may have changed).
  useEffect(() => {
    const unsub = navigation.addListener("focus", () => load(false));
    return unsub;
  }, [navigation, load]);

  const renderRow = useCallback(
    ({ item }: { item: Playlist }) => (
      <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSoft }}>
        <TouchableOpacity
          style={[styles.row, { paddingHorizontal: spacing.lg }]}
          activeOpacity={0.7}
          onPress={() => navigation.navigate("Playlist", { playlist: item })}
        >
          <View style={[styles.rowIcon, { backgroundColor: colors.accentSoft, borderRadius: radius.md }]}>
            <MaterialCommunityIcons name="playlist-music" size={24} color={colors.accent} />
            <View style={[styles.rowCount, { backgroundColor: colors.surface }]}>
              <MaterialCommunityIcons name="music-note" size={10} color={colors.accent} />
              <Text style={[styles.rowCountText, { color: colors.accent, fontSize: font.xs }]}>{item.items.length}</Text>
            </View>
          </View>
          <View style={styles.rowBody}>
            <Text style={[styles.rowTitle, { color: colors.content, fontSize: font.md }]} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={[styles.rowSub, { color: colors.muted, fontSize: font.xs }]}>
              {item.items.length} track{item.items.length === 1 ? "" : "s"}
              {item.is_public ? " · Public" : ""}
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={colors.muted} style={{ opacity: 0.5 }} />
        </TouchableOpacity>
      </View>
    ),
    [colors, font, navigation, radius, spacing]
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <FlatList
        data={playlists}
        keyExtractor={(p) => p.id}
        renderItem={renderRow}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
        ListHeaderComponent={
          playlists.length > 0 ? (
            <View style={[styles.hero, { paddingHorizontal: spacing.lg }]}>
              <View style={[styles.coverWrap, shadowSm]}>
                <LinearGradient colors={[...gradients.brand]} style={StyleSheet.absoluteFill}>
                  <View style={styles.coverInner}>
                    <MaterialCommunityIcons name="playlist-music" size={40} color="#fff" />
                  </View>
                </LinearGradient>
              </View>
              <Text style={[styles.title, { color: colors.content, fontSize: font.xl }]}>Playlists</Text>
              <Text style={[styles.meta, { color: colors.muted, fontSize: font.sm }]}>
                {playlists.length} playlist{playlists.length === 1 ? "" : "s"} · synced with web
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          loading ? (
            <ListSkeleton rows={6} />
          ) : (
            <EmptyState
              icon={error ? "alert-circle-outline" : "playlist-music"}
              title={error || "No playlists yet"}
              hint={error ? "Pull down to retry." : "Create playlists in the Nexora web app — they appear here automatically."}
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: { alignItems: "center", paddingTop: 16, paddingBottom: 18 },
  coverWrap: {
    width: 120,
    height: 120,
    borderRadius: 24,
    overflow: "hidden",
    marginBottom: 14,
  },
  coverInner: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontWeight: "800" },
  meta: { marginTop: 4, fontWeight: "500" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    height: 68,
  },
  rowIcon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  rowCount: {
    position: "absolute",
    bottom: -4,
    right: -6,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  rowCountText: { fontWeight: "700" },
  rowBody: { flex: 1, marginLeft: 2 },
  rowTitle: { fontWeight: "600" },
  rowSub: { marginTop: 3, fontWeight: "500" },
});
