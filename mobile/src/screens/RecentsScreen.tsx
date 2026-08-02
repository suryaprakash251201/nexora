import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { FileRow, EmptyState, ROW_HEIGHT } from "../components/FileRow";
import { ListSkeleton } from "../components/Skeletons";
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

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<FileItem[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeq = useRef(0);

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
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [load]);

  const runSearch = useCallback(
    async (q: string) => {
      if (!api || !q.trim()) return;
      const seq = ++searchSeq.current;
      setSearching(true);
      setSearchError(null);
      try {
        const res = await api.search(q.trim());
        if (seq === searchSeq.current) setSearchResults(res.results);
      } catch (e: any) {
        if (seq === searchSeq.current) setSearchError(e?.message || "Search failed.");
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    },
    [api]
  );

  const onChangeQuery = useCallback(
    (q: string) => {
      setQuery(q);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!q.trim()) {
        setSearchResults([]);
        setSearching(false);
        setSearchError(null);
        return;
      }
      debounceRef.current = setTimeout(() => runSearch(q), 300);
    },
    [runSearch]
  );

  const displayItems = useMemo(() => (query.trim() ? searchResults : items), [query, searchResults, items]);

  const openFile = useCallback(
    (item: FileItem) => navigation.navigate("Preview", { item, rootId: item.root_id }),
    [navigation]
  );

  const renderRow = useCallback(
    ({ item }: { item: FileItem }) => (
      <FileRow
        item={item}
        onPress={openFile}
        subtitle={
          item.is_dir ? "Folder" : query.trim() ? (item.path.replace(/\/[^/]+$/, "") || "/") : undefined
        }
        showDate={!query.trim()}
      />
    ),
    [openFile, query]
  );

  return (
    <View style={styles.root}>
      {/* Search bar */}
      <View style={[styles.searchWrap, query !== "" && styles.searchWrapActive]}>
        <MaterialCommunityIcons name="magnify" size={18} color={colors.muted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={onChangeQuery}
          placeholder="Search all files…"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          selectionColor={colors.accent}
        />
        {searching && <ActivityIndicator size="small" color={colors.accent} />}
        {query.trim() !== "" && !searching && (
          <TouchableOpacity onPress={() => onChangeQuery("")} hitSlop={8}>
            <MaterialCommunityIcons name="close-circle" size={18} color={colors.muted} />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={displayItems}
        keyExtractor={(it) => it.root_id + it.path}
        renderItem={renderRow}
        getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
        initialNumToRender={16}
        maxToRenderPerBatch={12}
        windowSize={7}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
        ListEmptyComponent={
          loading ? (
            <ListSkeleton rows={8} />
          ) : query.trim() ? (
            <EmptyState
              icon="file-search-outline"
              title={searchError || "No matches"}
              hint={searchError ? "Try again in a moment." : "Try a different search term."}
            />
          ) : (
            <EmptyState
              icon="history"
              title={error || "No recent files"}
              hint={error ? "Pull down to retry." : "Files you open will appear here."}
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchWrapActive: { borderColor: colors.accent, backgroundColor: colors.surface },
  searchInput: { flex: 1, color: colors.content, fontSize: font.md, padding: 0 },
});
