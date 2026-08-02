import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
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
import type { FileItem } from "../api/types";
import type { RootStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function RecentsScreen() {
  const navigation = useNavigation<Nav>();
  const { api } = useSession();
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search state.
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<FileItem[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!api) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await api.listRecents();
      setItems(res.items);
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

  const runSearch = useCallback(
    async (q: string) => {
      if (!api || !q.trim()) return;
      setSearching(true);
      setSearchError(null);
      try {
        const res = await api.search(q.trim());
        setSearchResults(res.results);
      } catch (e: any) {
        setSearchError(e?.message || "Search failed.");
      } finally {
        setSearching(false);
      }
    },
    [api]
  );

  const displayItems = query.trim() ? searchResults : items;

  const renderRow = ({ item }: { item: FileItem }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.7}
      onPress={() => navigation.navigate("Preview", { item, rootId: item.root_id })}
    >
      <FileIcon item={item} size={36} />
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.rowSub}>
          {item.is_dir ? "Folder" : formatBytes(item.size)} · {formatDate(item.modified)}
          {query.trim() ? ` · ${item.path}` : ""}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.root}>
      {/* Search bar */}
      <View style={styles.searchWrap}>
        <MaterialCommunityIcons name="magnify" size={18} color={colors.muted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={(q) => {
            setQuery(q);
            if (!q.trim()) setSearchResults([]);
          }}
          onSubmitEditing={() => runSearch(query)}
          placeholder="Search files…"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {searching && <ActivityIndicator size="small" color={colors.accent} />}
        {query.trim() !== "" && !searching && (
          <TouchableOpacity onPress={() => { setQuery(""); setSearchResults([]); }}>
            <MaterialCommunityIcons name="close-circle" size={18} color={colors.muted} />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={displayItems}
        keyExtractor={(it) => it.root_id + it.path}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
        renderItem={renderRow}
        ListEmptyComponent={
          loading ? (
            <View style={styles.centerPad}>
              <ActivityIndicator size="large" color={colors.accent} />
            </View>
          ) : query.trim() ? (
            <EmptyState icon="file-search-outline" title={searchError || "No matches"} hint="Try a different search term." />
          ) : (
            <EmptyState icon="history" title={error || "No recent files"} hint={error ? "Pull down to retry." : "Files you open will appear here."} />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  searchInput: { flex: 1, color: colors.content, fontSize: font.md, padding: 0 },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: 11,
  },
  rowBody: { flex: 1 },
  rowTitle: { color: colors.content, fontSize: font.md, fontWeight: "500" },
  rowSub: { color: colors.muted, fontSize: font.xs, marginTop: 2 },
  centerPad: { paddingVertical: 64 },
});
