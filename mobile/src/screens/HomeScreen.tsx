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
  TextInput,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSession } from "../store/SessionContext";
import { colors, font, gradients, radius, shadowSm, shadow, spacing } from "../theme";
import { FileRow, EmptyState, SectionLabel, Chevron } from "../components/FileRow";
import { ListSkeleton } from "../components/Skeletons";
import { formatBytes } from "../api/client";
import type { Root, FileItem } from "../api/types";
import type { RootStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const QUICK_ACTIONS = [
  { id: "favs", title: "Favorites", icon: "heart-outline", color: colors.danger },
  { id: "photos", title: "Photos", icon: "image-outline", color: colors.blue },
  { id: "docs", title: "Documents", icon: "file-document-outline", color: colors.amber },
  { id: "shared", title: "Shared", icon: "account-group-outline", color: colors.success },
];

export default function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const { api, user } = useSession();
  const [roots, setRoots] = useState<Root[]>([]);
  const [recents, setRecents] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

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
      contentContainerStyle={{ paddingBottom: 120 }}
      data={roots}
      keyExtractor={(r) => r.id}
      numColumns={2}
      columnWrapperStyle={roots.length > 0 ? styles.gridRow : undefined}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.rootCard} activeOpacity={0.7} onPress={() => openRoot(item)}>
          <LinearGradient colors={[colors.surfaceElevated, colors.surface]} style={[StyleSheet.absoluteFill, { borderRadius: radius.lg }]} />
          <View style={styles.rootIconWrap}>
            <View style={styles.rootIcon}>
              <MaterialCommunityIcons name="server" size={24} color={colors.accent} />
            </View>
            <View style={[styles.badge, item.permission === "write" ? styles.badgeWrite : styles.badgeRead]}>
              <MaterialCommunityIcons 
                name={item.permission === "write" ? "pencil" : "eye-outline"} 
                size={12} 
                color={item.permission === "write" ? colors.success : colors.muted} 
              />
            </View>
          </View>
          <View style={{ marginTop: 12 }}>
            <Text style={styles.rootName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.rootType}>{item.type} storage</Text>
          </View>
        </TouchableOpacity>
      )}
      ListHeaderComponent={
        <View>
          <View style={styles.hero}>
            <LinearGradient colors={[...gradients.hero]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
            
            <View style={styles.headerTop}>
              <View>
                <Text style={styles.heroGreet}>{greeting}, {firstName || "there"}</Text>
                <Text style={styles.heroTitle}>Storage</Text>
              </View>
              <TouchableOpacity style={styles.profileBtn}>
                <MaterialCommunityIcons name="account-circle" size={36} color={colors.accent} />
              </TouchableOpacity>
            </View>

            <View style={styles.searchWrap}>
              <MaterialCommunityIcons name="magnify" size={22} color={colors.muted} />
              <TextInput 
                style={styles.searchInput}
                placeholder="Search files and folders..."
                placeholderTextColor={colors.muted}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>

            {error ? (
              <TouchableOpacity style={styles.errorPill} onPress={() => load(true)}>
                <MaterialCommunityIcons name="alert-circle-outline" size={14} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.quickActionsWrap}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickActionsScroll}>
              {QUICK_ACTIONS.map(action => (
                <TouchableOpacity key={action.id} style={styles.quickActionCard} activeOpacity={0.7}>
                  <View style={[styles.quickActionIcon, { backgroundColor: action.color + "20" }]}>
                    <MaterialCommunityIcons name={action.icon as any} size={24} color={action.color} />
                  </View>
                  <Text style={styles.quickActionText}>{action.title}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <SectionLabel>Storage Locations</SectionLabel>
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
          <View style={{ marginTop: 8 }}>
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
            <View style={styles.recentsCardContainer}>
              {recents.map((f, i) => (
                <View key={f.root_id + f.path} style={[styles.recentItemWrap, i !== recents.length -1 && styles.recentItemBorder]}>
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
  root: { flex: 1, backgroundColor: colors.bg },
  hero: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    overflow: "hidden",
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  heroGreet: { color: colors.muted, fontSize: font.sm, fontWeight: "600" },
  heroTitle: { color: colors.content, fontSize: font.xxl, fontWeight: "800", letterSpacing: 0.3, marginTop: 4 },
  profileBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
    ...shadowSm,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    height: 48,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    ...shadowSm,
  },
  searchInput: {
    flex: 1,
    marginLeft: 12,
    color: colors.content,
    fontSize: font.md,
  },
  heroSub: { color: colors.muted, fontSize: font.xs, marginTop: 2 },
  heroBar: { height: 14, borderRadius: 7, backgroundColor: colors.card, marginTop: 10 },
  errorPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 16,
    backgroundColor: "rgba(239,68,68,0.12)",
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  errorText: { color: colors.danger, fontSize: font.xs },
  
  quickActionsWrap: {
    marginTop: 8,
    marginBottom: 16,
  },
  quickActionsScroll: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  quickActionCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    width: 90,
    ...shadowSm,
  },
  quickActionIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  quickActionText: {
    color: colors.content,
    fontSize: font.xs,
    fontWeight: "600",
  },

  gridRow: { paddingHorizontal: spacing.lg, gap: spacing.md, marginBottom: spacing.md },
  rootCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow,
  },
  rootIconWrap: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  rootIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  rootName: { color: colors.content, fontSize: font.lg, fontWeight: "700" },
  rootType: { color: colors.muted, fontSize: font.xs, textTransform: "capitalize", marginTop: 4 },
  badge: {
    borderRadius: radius.pill,
    padding: 6,
    backgroundColor: colors.surfaceMuted,
  },
  badgeWrite: { backgroundColor: "rgba(34,197,94,0.15)" },
  badgeRead: { backgroundColor: "rgba(255,255,255,0.08)" },
  
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: spacing.lg,
    marginBottom: 8,
  },
  seeAll: { flexDirection: "row", alignItems: "center", gap: 2, padding: 4, marginTop: spacing.lg },
  seeAllText: { color: colors.accent, fontSize: font.sm, fontWeight: "600" },

  recentsCardContainer: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    overflow: "hidden",
    ...shadowSm,
  },
  recentItemWrap: {
    backgroundColor: "transparent",
  },
  recentItemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSoft,
  }
});
