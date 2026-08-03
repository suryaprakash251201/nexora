import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
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
import { FileRow, EmptyState, SectionLabel, Chevron } from "../components/FileRow";
import { ListSkeleton, GridCardSkeleton } from "../components/Skeletons";
import type { Root, FileItem } from "../api/types";
import type { RootStackParamList, MainTabParamList } from "../navigation/types";

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, "Home">,
  NativeStackNavigationProp<RootStackParamList>
>;

const QUICK_CATEGORIES = [
  { id: "photos", title: "Photos", icon: "image-multiple", filter: "image" as const, gradient: ["#5B8CFF", "#7C5BFF"] as const },
  { id: "docs", title: "Documents", icon: "file-document", filter: "document" as const, gradient: ["#F97316", "#FBBF24"] as const },
  { id: "music", title: "Audio", icon: "music-note", filter: "audio" as const, gradient: ["#2DD4BF", "#22C55E"] as const },
  { id: "videos", title: "Videos", icon: "play-circle", filter: "video" as const, gradient: ["#A78BFA", "#EF4444"] as const },
];

const ROOT_ICONS: Record<string, string> = {
  local: "folder-home-outline",
  smb: "lan",
  nfs: "server-network",
  sftp: "lock-outline",
  s3: "cloud-outline",
  default: "database-outline",
};

export default function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { api, user } = useSession();
  const { colors, font, gradients, radius, spacing, shadow, shadowSm, isDark } = useTheme();

  const [roots, setRoots] = useState<Root[]>([]);
  const [recents, setRecents] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!api) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [r, rc] = await Promise.all([api.listRoots(), api.listRecents()]);
      setRoots(r.roots.filter((x) => x.enabled));
      setRecents(rc.items.slice(0, 6));
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
  const openSearch = useCallback(() => {
    navigation.navigate("Recents", { focusSearch: true });
  }, [navigation]);
  const openCategory = useCallback(
    (filter: string) => navigation.navigate("Recents", { filter }),
    [navigation]
  );
  const openFile = useCallback(
    (item: FileItem) => navigation.navigate("Preview", { item, rootId: item.root_id }),
    [navigation]
  );

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
        <View style={[styles.hero, { paddingTop: insets.top + 12 }]}>
          <LinearGradient colors={[...gradients.hero]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={styles.headerRow}>
            <View>
              <View style={{ width: 120, height: 14, borderRadius: 6, backgroundColor: colors.card }} />
              <View style={{ width: 140, height: 26, borderRadius: 8, backgroundColor: colors.card, marginTop: 8 }} />
            </View>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card }} />
          </View>
        </View>
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md, flexDirection: "row", marginTop: spacing.lg }}>
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
      contentContainerStyle={{ paddingBottom: 130 }}
      data={roots}
      keyExtractor={(r) => r.id}
      numColumns={2}
      columnWrapperStyle={roots.length > 0 ? { paddingHorizontal: spacing.lg, gap: spacing.md, marginBottom: spacing.md } : undefined}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
      renderItem={({ item }) => {
        const iconName = ROOT_ICONS[item.type.toLowerCase()] || ROOT_ICONS.default;
        return (
          <TouchableOpacity
            style={[
              styles.rootCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.borderSoft,
                borderRadius: radius.lg,
                padding: spacing.lg,
              },
              shadowSm,
            ]}
            activeOpacity={0.75}
            onPress={() => openRoot(item)}
          >
            <View style={styles.rootCardTop}>
              <View style={styles.rootIconWrap}>
                <LinearGradient
                  colors={[...gradients.brand]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                <MaterialCommunityIcons name={iconName as any} size={22} color="#fff" />
              </View>

              <View
                style={[
                  styles.permBadge,
                  { backgroundColor: item.permission === "write" ? "rgba(34,197,94,0.15)" : colors.card },
                ]}
              >
                <MaterialCommunityIcons
                  name={item.permission === "write" ? "pencil" : "eye"}
                  size={12}
                  color={item.permission === "write" ? colors.success : colors.muted}
                />
              </View>
            </View>

            <View style={{ marginTop: 14 }}>
              <Text style={[styles.rootName, { color: colors.content, fontSize: font.md }]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={[styles.rootType, { color: colors.muted, fontSize: font.xs }]}>
                {item.type.toUpperCase()} storage
              </Text>
            </View>

            <View style={styles.rootCardFooter}>
              <Text style={[styles.rootActionLabel, { color: colors.accent, fontSize: font.xs }]}>Browse</Text>
              <View style={[styles.rootArrowWrap, { backgroundColor: colors.accentSoft }]}>
                <MaterialCommunityIcons name="arrow-right" size={14} color={colors.accent} />
              </View>
            </View>
          </TouchableOpacity>
        );
      }}
      ListHeaderComponent={
        <View>
          {/* Dashboard Header */}
          <View style={[styles.hero, { paddingTop: insets.top + 12 }]}>
            <LinearGradient colors={[...gradients.hero]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />

            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.greeting, { color: colors.muted, fontSize: font.sm }]}>{greeting}</Text>
                <Text style={[styles.heroName, { color: colors.content }]}>{firstName || "Explorer"}</Text>
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

            {/* Quick Search trigger */}
            <TouchableOpacity
              style={[
                styles.searchBar,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.borderSoft,
                  borderRadius: radius.xl,
                },
                shadowSm,
              ]}
              activeOpacity={0.8}
              onPress={openSearch}
            >
              <MaterialCommunityIcons name="magnify" size={22} color={colors.accent} />
              <Text style={[styles.searchPlaceholder, { color: colors.muted, fontSize: font.md }]}>Search files, tags or storage…</Text>
              <View style={[styles.searchPill, { backgroundColor: colors.card }]}>
                <Text style={{ color: colors.muted, fontSize: 10, fontWeight: "700" }}>SEARCH</Text>
              </View>
            </TouchableOpacity>

            {error ? (
              <TouchableOpacity style={[styles.errorPill, { borderColor: "rgba(239,68,68,0.3)" }]} onPress={() => load(true)}>
                <MaterialCommunityIcons name="alert-circle-outline" size={14} color={colors.danger} />
                <Text style={[styles.errorText, { color: colors.danger, fontSize: font.xs }]}>{error} — Tap to retry</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Quick Categories Bar */}
          <View style={styles.quickWrap}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: 12 }}>
              {QUICK_CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  style={styles.quickCard}
                  activeOpacity={0.7}
                  onPress={() => openCategory(cat.filter)}
                >
                  <View style={[styles.quickIconWrap, shadowSm]}>
                    <LinearGradient
                      colors={[...cat.gradient]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                    <MaterialCommunityIcons name={cat.icon as any} size={24} color="#fff" />
                  </View>
                  <Text style={[styles.quickLabel, { color: colors.content, fontSize: font.xs }]}>{cat.title}</Text>
                </TouchableOpacity>
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
              shadowSm,
            ]}
          >
            <View style={styles.statItem}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <MaterialCommunityIcons name="server" size={16} color={colors.accent} />
                <Text style={[styles.statValue, { color: colors.content, fontSize: font.lg }]}>{roots.length}</Text>
              </View>
              <Text style={[styles.statLabel, { color: colors.muted, fontSize: font.xs }]}>Active Roots</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.borderSoft }]} />
            <View style={styles.statItem}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <MaterialCommunityIcons name="clock-outline" size={16} color={colors.purple} />
                <Text style={[styles.statValue, { color: colors.content, fontSize: font.lg }]}>{recents.length}</Text>
              </View>
              <Text style={[styles.statLabel, { color: colors.muted, fontSize: font.xs }]}>Recent Files</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.borderSoft }]} />
            <View style={styles.statItem}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <MaterialCommunityIcons name="shield-check" size={16} color={colors.success} />
                <Text style={[styles.statValue, { color: colors.success, fontSize: font.sm }]}>Connected</Text>
              </View>
              <Text style={[styles.statLabel, { color: colors.muted, fontSize: font.xs }]}>Connected</Text>
            </View>
          </View>

          <SectionLabel>Storage Locations</SectionLabel>
        </View>
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
        recents.length > 0 ? (
          <View style={{ marginTop: 8 }}>
            <View style={styles.sectionRow}>
              <SectionLabel>Recent files</SectionLabel>
              <TouchableOpacity
                style={styles.seeAll}
                onPress={() => navigation.navigate("Recents")}
              >
                <Text style={[styles.seeAllText, { color: colors.accent, fontSize: font.sm }]}>See all</Text>
                <Chevron />
              </TouchableOpacity>
            </View>
            <View
              style={[
                styles.recentsCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.borderSoft,
                  borderRadius: radius.xl,
                  marginHorizontal: spacing.lg,
                },
                shadowSm,
              ]}
            >
              {recents.map((f, i) => (
                <View
                  key={f.root_id + f.path}
                  style={i < recents.length - 1 ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSoft } : undefined}
                >
                  <FileRow item={f} onPress={openFile} showDate />
                </View>
              ))}
            </View>
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  // ── Hero Header ──
  hero: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    overflow: "hidden",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  greeting: { fontWeight: "600" },
  heroName: { fontSize: 30, fontWeight: "800", letterSpacing: 0.2, marginTop: 2 },
  avatarBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarText: { color: "#fff", fontSize: 18, fontWeight: "800" },

  // ── Search Trigger ──
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    height: 52,
    gap: 12,
    borderWidth: 1,
  },
  searchPlaceholder: { flex: 1, fontWeight: "500" },
  searchPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },

  // ── Error Pill ──
  errorPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
    backgroundColor: "rgba(239,68,68,0.10)",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
  },
  errorText: { fontWeight: "600" },

  // ── Quick Categories ──
  quickWrap: { marginTop: 12, marginBottom: 8 },
  quickCard: {
    alignItems: "center",
    width: 78,
    gap: 8,
  },
  quickIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  quickLabel: { fontWeight: "600", textAlign: "center" },

  // ── Stats Bar ──
  statsBar: {
    flexDirection: "row",
    marginTop: 14,
    marginBottom: 8,
    borderWidth: 1,
    paddingVertical: 14,
  },
  statItem: { flex: 1, alignItems: "center", gap: 3 },
  statValue: { fontWeight: "800" },
  statLabel: { fontWeight: "600" },
  statDivider: { width: 1, marginVertical: 4 },

  // ── Storage Root Card ──
  rootCard: {
    flex: 1,
    borderWidth: 1,
  },
  rootCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  rootIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  permBadge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  rootName: { fontWeight: "700" },
  rootType: { marginTop: 2, fontWeight: "600" },
  rootCardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 14,
  },
  rootActionLabel: { fontWeight: "700" },
  rootArrowWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Recents Section ──
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: 20,
    marginBottom: 2,
  },
  seeAll: { flexDirection: "row", alignItems: "center", gap: 2, padding: 4, marginTop: 18 },
  seeAllText: { fontWeight: "700" },
  recentsCard: {
    borderWidth: 1,
    overflow: "hidden",
  },
});
