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
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSession } from "../store/SessionContext";
import { colors, font, radius, spacing } from "../theme";
import { FileIcon, EmptyState } from "../components/FileIcon";
import { formatBytes, formatDate } from "../api/client";
import type { Root, FileItem } from "../api/types";
import type { RootStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const { api } = useSession();
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
      setRecents(rc.items.slice(0, 10));
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const data: Array<{ key: string; root?: Root }> = [{ key: "header" }, ...roots.map((r) => ({ key: r.id, root: r }))];

  return (
    <FlatList
      style={styles.root}
      contentContainerStyle={{ paddingBottom: 32 }}
      data={data}
      keyExtractor={(i) => i.key}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
      renderItem={({ item }) => {
        if (item.key === "header") {
          return (
            <View style={styles.header}>
              <Text style={styles.title}>Storage</Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </View>
          );
        }
        const root = item.root!;
        return (
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.7}
            onPress={() => navigation.navigate("Browser", { rootId: root.id, rootName: root.name })}
          >
            <View style={styles.rootIcon}>
              <MaterialCommunityIcons name="server" size={22} color={colors.accent} />
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>{root.name}</Text>
              <Text style={styles.rowSub}>
                {root.type} · {root.permission === "write" ? "read/write" : "read-only"}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.muted} />
          </TouchableOpacity>
        );
      }}
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
            <Text style={styles.section}>Recent files</Text>
            {recents.map((f) => (
              <TouchableOpacity
                key={f.root_id + f.path}
                style={styles.row}
                activeOpacity={0.7}
                onPress={() =>
                  navigation.navigate("Preview", { item: f, rootId: f.root_id })
                }
              >
                <FileIcon item={f} size={36} />
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{f.name}</Text>
                  <Text style={styles.rowSub}>
                    {f.is_dir ? "Folder" : formatBytes(f.size)} · {formatDate(f.modified)}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  title: { color: colors.content, fontSize: font.xl, fontWeight: "700" },
  error: { color: colors.danger, fontSize: font.sm, marginTop: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
  },
  rootIcon: {
    width: 44, height: 44, borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: "center", justifyContent: "center",
  },
  rowBody: { flex: 1 },
  rowTitle: { color: colors.content, fontSize: font.md, fontWeight: "600" },
  rowSub: { color: colors.muted, fontSize: font.xs, marginTop: 2 },
  section: {
    color: colors.muted, fontSize: 11, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 1,
    paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.sm,
  },
});
