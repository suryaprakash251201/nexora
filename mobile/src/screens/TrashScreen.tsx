import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSession } from "../store/SessionContext";
import { useTheme } from "../store/ThemeContext";
import { EmptyState, fileIconFor } from "../components/FileRow";
import { BottomSheet } from "../components/BottomSheet";
import { ListSkeleton } from "../components/Skeletons";
import { formatBytes, formatDate } from "../api/client";
import type { TrashItem, FileItem } from "../api/types";

export default function TrashScreen() {
  const { api } = useSession();
  const { colors, font, radius, spacing } = useTheme();

  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionItem, setActionItem] = useState<TrashItem | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!api) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await api.listTrash();
        setItems(res.items);
      } catch (e: any) {
        setError(e?.message || "Failed to load trash.");
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

  const restore = async (t: TrashItem) => {
    if (!api || busyId) return;
    setBusyId(t.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await api.restoreTrash(t.id);
      setItems((prev) => prev.filter((x) => x.id !== t.id));
      setActionItem(null);
      Alert.alert("Restored", `"${t.name}" moved back to its original location.`);
    } catch (e: any) {
      Alert.alert("Could not restore", e?.message || "Something went wrong.");
    } finally {
      setBusyId(null);
    }
  };

  const purge = (t: TrashItem) => {
    if (!api || busyId) return;
    Alert.alert("Delete permanently", `Permanently delete "${t.name}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setBusyId(t.id);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          try {
            await api.deleteTrash(t.id);
            setItems((prev) => prev.filter((x) => x.id !== t.id));
            setActionItem(null);
          } catch (e: any) {
            Alert.alert("Could not delete", e?.message || "Something went wrong.");
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  const toFileItem = (t: TrashItem): FileItem => ({
    name: t.name,
    path: t.original_path,
    size: t.size,
    is_dir: t.is_dir,
    modified: t.deleted_at,
    mime: "",
    root_id: t.root_id,
    extension: t.name.includes(".") ? t.name.split(".").pop() || "" : "",
  });

  const renderRow = ({ item }: { item: TrashItem }) => {
    const { name, color } = fileIconFor(toFileItem(item), colors.accent);
    return (
      <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSoft }}>
        <TouchableOpacity
          style={[styles.row, { paddingHorizontal: spacing.lg }]}
          activeOpacity={0.6}
          onPress={() => setActionItem(item)}
        >
          <View style={[styles.iconWrap, { backgroundColor: `${color}18`, borderRadius: radius.md }]}>
            <MaterialCommunityIcons name={name as any} size={22} color={color} />
          </View>
          <View style={styles.body}>
            <Text style={[styles.title, { color: colors.content, fontSize: font.md }]} numberOfLines={1}>{item.name}</Text>
            <Text style={[styles.sub, { color: colors.muted, fontSize: font.xs }]} numberOfLines={1}>
              {item.root_name || "Storage"} · {formatBytes(item.size)} · {formatDate(item.deleted_at)}
            </Text>
          </View>
          {busyId === item.id ? (
            <ActivityIndicator size="small" color={colors.accent} style={{ marginRight: 8 }} />
          ) : (
            <MaterialCommunityIcons name="chevron-right" size={20} color={colors.muted} style={{ opacity: 0.5, marginRight: 4 }} />
          )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {items.length > 0 && (
        <View style={[styles.headerBar, { borderBottomColor: colors.borderSoft }]}>
          <Text style={[styles.headerText, { color: colors.muted, fontSize: font.xs }]}>
            {items.length} item{items.length === 1 ? "" : "s"} in trash · restore before {""}
          </Text>
        </View>
      )}
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        renderItem={renderRow}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
        ListEmptyComponent={
          loading ? (
            <ListSkeleton rows={7} />
          ) : (
            <EmptyState
              icon={error ? "alert-circle-outline" : "delete-restore"}
              title={error || "Trash is empty"}
              hint={error ? "Pull down to retry." : "Deleted files and folders land here so you can restore them."}
            />
          )
        }
      />

      <BottomSheet
        visible={actionItem !== null}
        onClose={() => setActionItem(null)}
        title={actionItem?.name}
        actions={[
          {
            label: "Restore",
            icon: "restore",
            onPress: () => actionItem && restore(actionItem),
          },
          {
            label: "Delete permanently",
            icon: "delete-forever-outline",
            destructive: true,
            onPress: () => actionItem && purge(actionItem),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerBar: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerText: { fontWeight: "600" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    height: 68,
  },
  iconWrap: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, marginLeft: 2 },
  title: { fontWeight: "600", letterSpacing: 0.1 },
  sub: { marginTop: 3, fontWeight: "500" },
});