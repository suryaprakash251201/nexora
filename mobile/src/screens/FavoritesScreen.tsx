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
import * as Haptics from "expo-haptics";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSession } from "../store/SessionContext";
import { useTheme } from "../store/ThemeContext";
import { EmptyState } from "../components/FileRow";
import { AudioCover } from "../components/AudioCover";
import { fileIconFor, isAudioFile } from "../lib/fileMeta";
import { BottomSheet } from "../components/BottomSheet";
import { ListSkeleton } from "../components/Skeletons";
import { formatDate } from "../api/client";
import type { FavoriteItem, FileItem } from "../api/types";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Favorites">;

export default function FavoritesScreen({ navigation }: Props) {
  const { api } = useSession();
  const { colors, font, radius, spacing } = useTheme();

  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [actionItem, setActionItem] = useState<FavoriteItem | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!api) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await api.listFavorites();
        setItems(res.items);
      } catch (e: any) {
        setError(e?.message || "Failed to load favorites.");
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

  const reveal = async (f: FavoriteItem) => {
    if (!api) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const item: FileItem = await api.stat(f.root_id, f.path);
      navigation.navigate("Preview", { item, rootId: f.root_id });
    } catch {
      // Fall back to opening the root folder if stat fails.
      navigation.navigate("Browser", { rootId: f.root_id, rootName: f.root_name || "Storage", path: f.path.replace(/\/[^/]+$/, "") });
    }
  };

  const remove = async (f: FavoriteItem) => {
    if (!api || busyPath) return;
    setBusyPath(f.path);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      await api.removeFavorite(f.root_id, f.path);
      setItems((prev) => prev.filter((x) => x.root_id !== f.root_id || x.path !== f.path));
      setActionItem(null);
    } catch (e: any) {
      setError(e?.message || "Could not remove favorite.");
    } finally {
      setBusyPath(null);
    }
  };

  const toFileItem = (f: FavoriteItem): FileItem => ({
    name: f.name,
    path: f.path,
    size: 0,
    is_dir: false,
    modified: f.created_at,
    mime: "",
    root_id: f.root_id,
    extension: f.name.includes(".") ? f.name.split(".").pop() || "" : "",
  });

  const renderRow = ({ item }: { item: FavoriteItem }) => {
    const { name, color } = fileIconFor(toFileItem(item), colors.accent);
    return (
      <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSoft }}>
        <TouchableOpacity
          style={[styles.row, { paddingHorizontal: spacing.lg }]}
          activeOpacity={0.6}
          onPress={() => reveal(item)}
          onLongPress={() => setActionItem(item)}
          delayLongPress={350}
        >
          <View style={[styles.iconWrap, { backgroundColor: `${color}18`, borderRadius: radius.md }]}>
            {isAudioFile(toFileItem(item)) ? (
              <AudioCover item={toFileItem(item)} size={160} />
            ) : (
              <MaterialCommunityIcons name={name as any} size={22} color={color} />
            )}
          </View>
          <View style={styles.body}>
            <Text style={[styles.title, { color: colors.content, fontSize: font.md }]} numberOfLines={1}>{item.name}</Text>
            <Text style={[styles.sub, { color: colors.muted, fontSize: font.xs }]} numberOfLines={1}>
              {item.root_name || "Storage"} · {formatDate(item.created_at)}
            </Text>
          </View>
          <TouchableOpacity style={styles.heart} onPress={() => remove(item)} hitSlop={10}>
            {busyPath === item.path ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <MaterialCommunityIcons name="heart" size={20} color={colors.danger} />
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <FlatList
        data={items}
        keyExtractor={(it) => it.root_id + it.path}
        renderItem={renderRow}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
        ListEmptyComponent={
          loading ? (
            <ListSkeleton rows={7} />
          ) : (
            <EmptyState
              icon={error ? "alert-circle-outline" : "heart-outline"}
              title={error || "No favorites yet"}
              hint={error ? "Pull down to retry." : "Tap the heart on any file in List or Preview to pin it here."}
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
            label: "Open",
            icon: "eye-outline",
            onPress: () => actionItem && reveal(actionItem),
          },
          {
            label: "Remove from favorites",
            icon: "heart-remove-outline",
            destructive: true,
            onPress: () => actionItem && remove(actionItem),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
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
    overflow: "hidden",
  },
  body: { flex: 1, marginLeft: 2 },
  title: { fontWeight: "600", letterSpacing: 0.1 },
  sub: { marginTop: 3, fontWeight: "500" },
  heart: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});