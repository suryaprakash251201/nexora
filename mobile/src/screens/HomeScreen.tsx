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
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSession } from "../store/SessionContext";
import { colors, font, gradients, radius, shadowSm, spacing } from "../theme";
import { FileRow, EmptyState, SectionLabel, Chevron } from "../components/FileRow";
import { ListSkeleton } from "../components/Skeletons";
import { formatBytes } from "../api/client";
import type { Root, FileItem } from "../api/types";
import type { RootStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const { api, user } = useSession();
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
      setRecents(rc.items.slice(0, 8));
    } catch (e: any) {
      setError(e?.message || "Failed to load.");
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
  const openFile = useCallback(
    (item: FileItem) => navigation.navigate("Preview", { item, rootId: item.root_id }),
    [navigation]
  );

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }, []);
  const firstName = user?.display_name?.split(" ")[0] || user?.username || "";

  if (loading) {
    return (
      <View style={styles.root}>
        <View style={styles.hero}>
          <LinearGradient colors={[...gradients.hero]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <Text style={styles.heroGreet}>Hello 👋</Text>
          <View style={[styles.heroBar, { width: 150 }]} />
        </View>
        <ListSkeleton rows={5} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.root}
      contentContainerStyle={{ paddingBottom: 32 }}
      data={roots}
      keyExtractor={(r) => r.id}
      numColumns={2}
      columnWrapperStyle={roots.length > 0 ? styles.gridRow : undefined}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.rootCard} activeOpacity={0.7} onPress={() => openRoot(item)}>
          <View style={styles.rootIcon}>
            <MaterialCommunityIcons name="server" size={22} color={colors.accent} />
          </View>
          <Text style={styles.rootName} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.rootType}>{item.type}</Text>
          <View style={[styles.badge, item.permission === "write" ? styles.badgeWrite : styles.badgeRead]}>
            <Text style={[styles.badgeText, { color: item.permission === "write" ? colors.success : colors.muted }]}>
              {item.permission === "write" ? "read/write" : "read-only"}
            </Text>
          </View>
        </TouchableOpacity>
      )}
      ListHeaderComponent={
        <View>
          <View style={styles.hero}>
            <LinearGradient colors={[...gradients.hero]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
            <Text style={styles.heroGreet}>{greeting}, {firstName || "there"}</Text>
            <Text style={styles.heroTitle}>Storage</Text>
            <Text style={styles.heroSub}>{roots.length} root{roots.length === 1 ? "" : "s"} available</Text>
            {error ? (
              <TouchableOpacity style={styles.errorPill} onPress={() => load(true)}>
                <MaterialCommunityIcons name="alert-circle-outline" size={14} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      }
      ListEmptyComponent={
        !loading && roots.length === 0 ? (
          <EmptyState
            icon="server-off"
            title="No storage roots"
            hint="You don't have access to any storage. Ask an admin to grant you a root."
          />
        ) : null
      }
      ListFooterComponent={
        recents.length > 0 ? (
          <View>
            <View style={styles.sectionRow}>
              <SectionLabel>Recent files</SectionLabel>
              <TouchableOpacity
                style={styles.seeAll}
                onPress={() => navigation.navigate("Recents" as never)}
              >
                <Text style={styles.seeAllText}>See all</Text>
                <Chevron />
              </TouchableOpacity>
            </View>
            {recents.map((f) => (
              <FileRow key={f.root_id + f.path} item={f} onPress={openFile} showDate />
            ))}
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  hero: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    gap: 4,
    overflow: "hidden",
  },
  heroGreet: { color: colors.muted, fontSize: font.sm, fontWeight: "600" },
  heroTitle: { color: colors.content, fontSize: font.xxl, fontWeight: "800", letterSpacing: 0.3 },
  heroSub: { color: colors.muted, fontSize: font.xs, marginTop: 2 },
  heroBar: { height: 14, borderRadius: 7, backgroundColor: colors.card, marginTop: 10 },
  errorPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    backgroundColor: "rgba(239,68,68,0.12)",
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  errorText: { color: colors.danger, fontSize: font.xs },
  gridRow: { paddingHorizontal: spacing.lg, gap: spacing.md, marginBottom: spacing.md },
  rootCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 6,
    ...shadowSm,
  },
  rootIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  rootName: { color: colors.content, fontSize: font.md, fontWeight: "700" },
  rootType: { color: colors.muted, fontSize: font.xs, textTransform: "capitalize" },
  badge: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 4,
  },
  badgeWrite: { backgroundColor: "rgba(34,197,94,0.12)" },
  badgeRead: { backgroundColor: colors.card },
  badgeText: { fontSize: font.xs, fontWeight: "700" },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: spacing.lg,
  },
  seeAll: { flexDirection: "row", alignItems: "center", gap: 2, padding: 4 },
  seeAllText: { color: colors.accent, fontSize: font.sm, fontWeight: "600" },
});
