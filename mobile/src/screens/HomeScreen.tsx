import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useNavigation } from "@react-navigation/native";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../store/SessionContext";
import { useTheme } from "../store/ThemeContext";
import { EmptyState, SectionLabel } from "../components/FileRow";
import { ListSkeleton, GridCardSkeleton } from "../components/Skeletons";
import { previewKind } from "../api/client";
import type { Root, FileItem, Playlist, FavoriteItem } from "../api/types";
import type { RootStackParamList, MainTabParamList } from "../navigation/types";
import { useAudio } from "../store/AudioContext";
import { PressScale, FadeSlideIn } from "../components/motion";

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, "Home">,
  NativeStackNavigationProp<RootStackParamList>
>;

/** Android renders ~15% tighter so the dashboard doesn't balloon. */
const IS_ANDROID = Platform.OS === "android";

type QuickAction =
  | { id: string; title: string; icon: string; kind: string; gradient: readonly [string, string] }
  | { id: string; title: string; icon: string; screen: "Favorites" | "Trash"; gradient: readonly [string, string] };

const QUICK_CATEGORIES: QuickAction[] = [
  { id: "photos", title: "Photos", icon: "image-multiple", kind: "image" as const, gradient: ["#4F46E5", "#8B5CF6"] as const },
  { id: "docs", title: "Documents", icon: "file-document", kind: "document" as const, gradient: ["#F59E0B", "#F97316"] as const },
  { id: "music", title: "Audio", icon: "music-note", kind: "audio" as const, gradient: ["#14B8A6", "#10B981"] as const },
  { id: "videos", title: "Videos", icon: "play-circle", kind: "video" as const, gradient: ["#F43F5E", "#E11D48"] as const },
  { id: "favorites", title: "Favorites", icon: "heart", screen: "Favorites" as const, gradient: ["#EF4444", "#F97316"] as const },
  { id: "trash", title: "Trash", icon: "delete-restore", screen: "Trash" as const, gradient: ["#64748B", "#475569"] as const },
];

const ROOT_ICONS: Record<string, string> = {
  local: "folder-home-outline",
  smb: "lan",
  nfs: "server-network",
  sftp: "lock-outline",
  s3: "cloud-outline",
  default: "database-outline",
};

function favoriteToFile(f: FavoriteItem): FileItem {
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

export default function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { api, user } = useSession();
  const { colors, font, gradients, radius, spacing, shadow, shadowSm, isDark } = useTheme();
  const { playTrack } = useAudio();

  const [roots, setRoots] = useState<Root[]>([]);
  const [recents, setRecents] = useState<FileItem[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [likedSongs, setLikedSongs] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!api) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [r, rc, pl, fav] = await Promise.all([
        api.listRoots(),
        api.listRecents(),
        api.listPlaylists(),
        api.listFavorites(),
      ]);
      setRoots(r.roots.filter((x) => x.enabled));
      setRecents(rc.items.slice(0, 6));
      setPlaylists(pl.items || []);
      // “Liked Songs” = favorited audio files, newest first.
      const songs = (fav.items || [])
        .filter((f) => previewKind(favoriteToFile(f)) === "audio")
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(0, 10)
        .map(favoriteToFile);
      setLikedSongs(songs);
    } catch (e: any) {
      setError(e?.message || "Failed to load storage system.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const openRoot = useCallback(
    (root: Root) => navigation.navigate("Browser", { rootId: root.id, rootName: root.name }),
    [navigation]
  );

  const openCategory = useCallback(
    (kind: string, title: string) => navigation.navigate("Category", { kind, title }),
    [navigation]
  );
  const openFile = useCallback(
    (item: FileItem) => {
      if (item.is_dir) {
        navigation.navigate("Browser", { rootId: item.root_id, rootName: item.name, path: item.path });
      } else if (previewKind(item) === "audio") {
        playTrack(item, recents.filter((x) => previewKind(x) === "audio"));
      } else {
        navigation.navigate("Preview", { item, rootId: item.root_id });
      }
    },
    [navigation, playTrack, recents]
  );

  // Liked songs open from the single “Liked Songs” card on Home.

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 6) return "Good night";
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  const firstName = user?.display_name?.split(" ")[0] || user?.username || "";
  const initials = (user?.display_name || user?.username || "?").slice(0, 1).toUpperCase();

  if (loading) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <View style={[styles.hero, { paddingTop: insets.top + 20 }]}>
          <LinearGradient colors={[...gradients.hero]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={styles.headerRow}>
            <View>
              <View style={{ width: IS_ANDROID ? 100 : 120, height: 16, borderRadius: 8, backgroundColor: colors.card }} />
              <View style={{ width: IS_ANDROID ? 140 : 160, height: IS_ANDROID ? 26 : 32, borderRadius: 8, backgroundColor: colors.card, marginTop: 10 }} />
            </View>
            <View style={{ width: IS_ANDROID ? 44 : 52, height: IS_ANDROID ? 44 : 52, borderRadius: IS_ANDROID ? 22 : 26, backgroundColor: colors.card }} />
          </View>
        </View>
        <View style={{ paddingHorizontal: spacing.xl, gap: spacing.md, flexDirection: "row", marginTop: spacing.xl }}>
          <GridCardSkeleton />
          <GridCardSkeleton />
        </View>
        <ListSkeleton rows={4} />
      </View>
    );
  }

  return (
    <FlatList
      style={[styles.root, { backgroundColor: colors.bg }]}
      contentContainerStyle={{ paddingBottom: 140 }}
      data={roots}
      keyExtractor={(r) => r.id}
      numColumns={2}
      columnWrapperStyle={roots.length > 0 ? { paddingHorizontal: spacing.lg, gap: spacing.md, marginBottom: spacing.md } : undefined}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
      renderItem={({ item }) => {
        const iconName = ROOT_ICONS[item.type.toLowerCase()] || ROOT_ICONS.default;
        return (
          <PressScale style={{ flex: 1 }}>
            <TouchableOpacity
              style={[
                styles.rootCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.borderSoft,
                  borderRadius: radius.xl,
                  padding: spacing.lg,
                },
                shadow,
              ]}
              activeOpacity={0.8}
              onPress={() => openRoot(item)}
            >
            <LinearGradient
              colors={["rgba(255,255,255,0.05)", "transparent"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.glassHighlight}
            />
              <View style={styles.rootCardTop}>
              <View style={styles.rootIconWrap}>
                <LinearGradient
                  colors={[...gradients.brand]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                <MaterialCommunityIcons name={iconName as any} size={24} color="#fff" />
              </View>
            </View>

            <View style={{ marginTop: IS_ANDROID ? 14 : 20 }}>
              <Text style={[styles.rootName, { color: colors.content, fontSize: font.lg }]} numberOfLines={1} maxFontSizeMultiplier={1.15}>
                {item.name}
              </Text>
              <Text style={[styles.rootType, { color: colors.muted, fontSize: font.sm }]} maxFontSizeMultiplier={1.15}>
                {item.type.toUpperCase()} Storage
              </Text>
            </View>

            <View style={styles.rootCardFooter}>
              <Text style={[styles.rootActionLabel, { color: colors.accent, fontSize: font.sm }]} maxFontSizeMultiplier={1.15}>Browse</Text>
              <View style={[styles.rootArrowWrap, { backgroundColor: colors.accentSoft }]}>
                <MaterialCommunityIcons name="arrow-right" size={16} color={colors.accent} />
              </View>
            </View>
            </TouchableOpacity>
          </PressScale>
        );
      }}
      ListHeaderComponent={
        <FadeSlideIn distance={18}>
        <View>
          {/* Dashboard Header */}
          <View style={[styles.hero, { paddingTop: insets.top + 24 }]}>
            <LinearGradient colors={[...gradients.hero]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />

            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.greeting, { color: colors.muted, fontSize: font.md }]} maxFontSizeMultiplier={1.15}>{greeting}</Text>
                <Text style={[styles.heroName, { color: colors.content }]} maxFontSizeMultiplier={1.15}>{firstName || "Explorer"}</Text>
              </View>
              <TouchableOpacity
                style={[styles.avatarBtn, shadowSm]}
                activeOpacity={0.85}
                onPress={() => navigation.navigate("Settings")}
              >
                <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                <Text style={styles.avatarText}>{initials}</Text>
              </TouchableOpacity>
            </View>



            {error ? (
              <TouchableOpacity style={[styles.errorPill, { borderColor: "rgba(244,63,94,0.3)" }]} onPress={() => load(true)}>
                <MaterialCommunityIcons name="alert-circle-outline" size={16} color={colors.danger} />
                <Text style={[styles.errorText, { color: colors.danger, fontSize: font.sm }]}>{error} — Tap to retry</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Quick Categories Bar */}
          <View style={styles.quickWrap}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: 16 }}>
              {QUICK_CATEGORIES.map((cat, ci) => (
                <FadeSlideIn key={cat.id} delay={120 + ci * 60} distance={10}>
                  <PressScale scaleTo={0.93}>
                    <TouchableOpacity
                      style={styles.quickCard}
                      activeOpacity={0.75}
                      onPress={() => ("screen" in cat ? navigation.navigate(cat.screen) : openCategory(cat.kind, cat.title))}
                    >
                  <View style={[styles.quickIconWrap, shadowSm]}>
                    <LinearGradient
                      colors={[...cat.gradient]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                    <MaterialCommunityIcons name={cat.icon as any} size={IS_ANDROID ? 24 : 28} color="#fff" />
                  </View>
                  <Text style={[styles.quickLabel, { color: colors.content, fontSize: font.sm }]} maxFontSizeMultiplier={1.15}>{cat.title}</Text>
                    </TouchableOpacity>
                  </PressScale>
                </FadeSlideIn>
              ))}
            </ScrollView>
          </View>

          {/* Storage Overview Stats Card */}
          <View
            style={[
              styles.statsBar,
              {
                backgroundColor: colors.surface,
                borderColor: colors.borderSoft,
                borderRadius: radius.xl,
                marginHorizontal: spacing.lg,
              },
              shadow,
            ]}
          >
            <LinearGradient
              colors={["rgba(255,255,255,0.03)", "transparent"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.glassHighlight}
            />
            <View style={styles.statItem}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <MaterialCommunityIcons name="server" size={18} color={colors.accent} />
                <Text style={[styles.statValue, { color: colors.content, fontSize: font.xl }]}>{roots.length}</Text>
              </View>
              <Text style={[styles.statLabel, { color: colors.muted, fontSize: font.sm }]}>Active Roots</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.borderSoft }]} />
            <View style={styles.statItem}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <MaterialCommunityIcons name="clock-outline" size={18} color={colors.purple} />
                <Text style={[styles.statValue, { color: colors.content, fontSize: font.xl }]}>{recents.length}</Text>
              </View>
              <Text style={[styles.statLabel, { color: colors.muted, fontSize: font.sm }]}>Recent Files</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.borderSoft }]} />
            <View style={styles.statItem}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <MaterialCommunityIcons name="shield-check" size={18} color={colors.success} />
                <Text style={[styles.statValue, { color: colors.success, fontSize: font.md }]}>Secure</Text>
              </View>
              <Text style={[styles.statLabel, { color: colors.muted, fontSize: font.sm }]}>Connection</Text>
            </View>
          </View>

          <SectionLabel>Storage Locations</SectionLabel>
        </View>
        </FadeSlideIn>
      }
      ListEmptyComponent={
        !loading && roots.length === 0 ? (
          <EmptyState
            icon="server-off"
            title="No storage roots"
            hint="You don't have access to any storage roots yet. Contact your administrator."
          />
        ) : null
      }
      ListFooterComponent={
        <View style={{ marginTop: 12 }}>
          {/* Playlists — created in the web app, synced via /playlists */}
          {playlists.length > 0 && (
            <View style={{ marginBottom: 24 }}>
              <View style={styles.sectionRow}>
                <SectionLabel>Your Playlists</SectionLabel>
                <Text style={[styles.playlistSync, { color: colors.muted, fontSize: font.xs }]}>synced with web</Text>
              </View>
              {/* One playlist card — tap to open the full list of playlists */}
              <TouchableOpacity
                style={[styles.playlistCard, { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radius.xl, marginHorizontal: spacing.lg }, shadowSm]}
                activeOpacity={0.8}
                onPress={() => navigation.navigate("Playlists")}
              >
                <LinearGradient colors={["rgba(255,255,255,0.06)", "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                <View style={styles.playlistCover}>
                  <LinearGradient colors={[...gradients.brand]} style={StyleSheet.absoluteFill} />
                  <MaterialCommunityIcons name="playlist-music" size={IS_ANDROID ? 22 : 26} color="#fff" />
                </View>
                <View style={styles.playlistBody}>
                  <Text style={[styles.playlistTitle, { color: colors.content, fontSize: font.md }]}>Playlists</Text>
                  <Text style={[styles.playlistSub, { color: colors.muted, fontSize: font.xs }]}>
                    {playlists.length} playlist{playlists.length === 1 ? "" : "s"} · tap to open
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={22} color={colors.muted} style={{ opacity: 0.5 }} />
              </TouchableOpacity>
            </View>
          )}

          {recents.filter(f => previewKind(f) === "audio").length > 0 && (
            <View style={{ marginBottom: 24 }}>
              <View style={styles.sectionRow}>
                <SectionLabel>Recently Played Songs</SectionLabel>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: 12 }}>
                {recents.filter(f => previewKind(f) === "audio").slice(0, 5).map(f => (
                  <TouchableOpacity
                    key={f.root_id + f.path}
                    style={[styles.audioCard, { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radius.xl }, shadowSm]}
                    activeOpacity={0.8}
                    onPress={() => openFile(f)}
                  >
                    <LinearGradient colors={["rgba(255,255,255,0.06)", "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                    <View style={styles.audioIcon}>
                      <MaterialCommunityIcons name="music-circle" size={32} color={colors.accent} />
                    </View>
                    <Text style={[styles.audioTitle, { color: colors.content, fontSize: font.sm }]} numberOfLines={1}>{f.name}</Text>
                    <Text style={[styles.audioSub, { color: colors.muted, fontSize: font.xs }]}>Music</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Liked Songs — one cover card that opens the full liked list */}
          {likedSongs.length > 0 && (
            <View style={{ marginBottom: 24 }}>
              <View style={styles.sectionRow}>
                <SectionLabel>Liked Songs</SectionLabel>
              </View>
              <TouchableOpacity
                style={[styles.likedCard, { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radius.xl, marginHorizontal: spacing.lg }, shadowSm]}
                activeOpacity={0.8}
                onPress={() => navigation.navigate("Liked")}
              >
                <LinearGradient colors={["rgba(255,255,255,0.06)", "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                <View style={styles.likedCover}>
                  <LinearGradient colors={["#F43F5E", "#BE123C"]} style={StyleSheet.absoluteFill} />
                  <MaterialCommunityIcons name="heart" size={IS_ANDROID ? 26 : 30} color="#fff" />
                </View>
                <View style={styles.likedBody}>
                  <Text style={[styles.likedTitle, { color: colors.content, fontSize: font.md }]}>Liked Songs</Text>
                  <Text style={[styles.likedSub, { color: colors.muted, fontSize: font.xs }]}>
                    {likedSongs.length} song{likedSongs.length === 1 ? "" : "s"} · tap to open
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={22} color={colors.muted} style={{ opacity: 0.5 }} />
              </TouchableOpacity>
            </View>
          )}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  glassHighlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 24,
    pointerEvents: "none",
  },

  // ── Hero Header ──
  hero: {
    paddingHorizontal: IS_ANDROID ? 20 : 24,
    paddingBottom: IS_ANDROID ? 22 : 28,
    overflow: "hidden",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: IS_ANDROID ? 18 : 24,
  },
  greeting: { fontWeight: "600", letterSpacing: 0.5 },
  heroName: { fontSize: IS_ANDROID ? 28 : 34, fontWeight: "800", letterSpacing: 0.2, marginTop: 4 },
  avatarBtn: {
    width: IS_ANDROID ? 44 : 52,
    height: IS_ANDROID ? 44 : 52,
    borderRadius: IS_ANDROID ? 22 : 26,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarText: { color: "#fff", fontSize: IS_ANDROID ? 18 : 20, fontWeight: "800" },

  // ── Search Trigger ──
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    height: 58,
    gap: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  searchPlaceholder: { flex: 1, fontWeight: "500" },
  searchPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },

  // ── Error Pill ──
  errorPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    backgroundColor: "rgba(244,63,94,0.12)",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
  },
  errorText: { fontWeight: "600" },

  // ── Quick Categories ──
  quickWrap: { marginTop: IS_ANDROID ? 12 : 16, marginBottom: IS_ANDROID ? 12 : 16 },
  quickCard: {
    alignItems: "center",
    width: IS_ANDROID ? 72 : 84,
    gap: IS_ANDROID ? 8 : 10,
  },
  quickIconWrap: {
    width: IS_ANDROID ? 54 : 64,
    height: IS_ANDROID ? 54 : 64,
    borderRadius: IS_ANDROID ? 18 : 22,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  quickLabel: { fontWeight: "600", textAlign: "center" },

  // ── Stats Bar ──
  statsBar: {
    flexDirection: "row",
    marginTop: IS_ANDROID ? 12 : 16,
    marginBottom: IS_ANDROID ? 12 : 16,
    borderWidth: 1,
    paddingVertical: IS_ANDROID ? 13 : 18,
    overflow: "hidden",
  },
  statItem: { flex: 1, alignItems: "center", gap: 4 },
  statValue: { fontWeight: "800" },
  statLabel: { fontWeight: "600" },
  statDivider: { width: 1, marginVertical: 4 },

  // ── Storage Root Card ──
  rootCard: {
    flex: 1,
    borderWidth: 1,
    overflow: "hidden",
  },
  rootCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  rootIconWrap: {
    width: IS_ANDROID ? 44 : 52,
    height: IS_ANDROID ? 44 : 52,
    borderRadius: IS_ANDROID ? 14 : 16,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  rootName: { fontWeight: "700" },
  rootType: { marginTop: 4, fontWeight: "600" },
  rootCardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: IS_ANDROID ? 12 : 18,
  },
  rootActionLabel: { fontWeight: "700" },
  rootArrowWrap: {
    width: IS_ANDROID ? 24 : 28,
    height: IS_ANDROID ? 24 : 28,
    borderRadius: IS_ANDROID ? 12 : 14,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Recents Section ──
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: 24,
    marginBottom: 8,
  },
  playlistSync: { fontWeight: "600", marginTop: 18 },
  likedCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  likedCover: {
    width: IS_ANDROID ? 48 : 56,
    height: IS_ANDROID ? 48 : 56,
    borderRadius: IS_ANDROID ? 14 : 16,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  likedBody: { flex: 1 },
  likedTitle: { fontWeight: "700" },
  likedSub: { marginTop: 3, fontWeight: "500" },
  playlistCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  playlistCover: {
    width: IS_ANDROID ? 46 : 52,
    height: IS_ANDROID ? 46 : 52,
    borderRadius: IS_ANDROID ? 14 : 16,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    overflow: "hidden",
  },
  playlistBody: { flex: 1 },
  playlistTitle: { fontWeight: "700", marginBottom: 2 },
  playlistSub: { fontWeight: "600" },

  seeAll: { flexDirection: "row", alignItems: "center", gap: 2, padding: 4, marginTop: 18 },
  seeAllText: { fontWeight: "700" },
  recentsCard: {
    borderWidth: 1,
    overflow: "hidden",
  },
  audioCard: {
    width: IS_ANDROID ? 124 : 140,
    padding: IS_ANDROID ? 12 : 16,
    borderWidth: 1,
    overflow: "hidden",
    alignItems: "flex-start",
  },
  audioIcon: {
    width: IS_ANDROID ? 40 : 48,
    height: IS_ANDROID ? 40 : 48,
    borderRadius: IS_ANDROID ? 20 : 24,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: IS_ANDROID ? 10 : 12,
  },
  audioTitle: { fontWeight: "700", marginBottom: 2 },
  audioSub: { fontWeight: "600" },
});
