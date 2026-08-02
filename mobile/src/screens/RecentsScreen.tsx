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
import { useTheme } from "../store/ThemeContext";
import { FileRow, EmptyState, ROW_HEIGHT } from "../components/FileRow";
import { ListSkeleton } from "../components/Skeletons";
import { previewKind } from "../api/client";
import type { FileItem } from "../api/types";
import type { RootStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type FilterTag = "all" | "image" | "document" | "video" | "audio";

export default function RecentsScreen() {
  const navigation = useNavigation<Nav>();
  const { api } = useSession();
  const { colors, font, radius, spacing, shadowSm } = useTheme();

  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<FileItem[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterTag>("all");

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
      setError(e?.message || "Failed to load recents.");
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

  const baseItems = useMemo(() => (query.trim() ? searchResults : items), [query, searchResults, items]);

  const displayItems = useMemo(() => {
    if (activeFilter === "all") return baseItems;
    return baseItems.filter((item) => {
      const k = previewKind(item);
      if (activeFilter === "image") return k === "image";
      if (activeFilter === "video") return k === "video";
      if (activeFilter === "audio") return k === "audio";
      if (activeFilter === "document") return ["pdf", "text", "code", "markdown"].includes(k);
      return true;
    });
  }, [baseItems, activeFilter]);

  const openFile = useCallback(
    (item: FileItem) => navigation.navigate("Preview", { item, rootId: item.root_id }),
    [navigation]
  );

  const renderRow = useCallback(
    ({ item }: { item: FileItem }) => (
      <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSoft }}>
        <FileRow
          item={item}
          onPress={openFile}
          subtitle={item.is_dir ? "Folder" : query.trim() ? item.path.replace(/\/[^/]+$/, "") || "/" : undefined}
          showDate={!query.trim()}
        />
      </View>
    ),
    [colors.borderSoft, openFile, query]
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {/* Search Input Bar */}
      <View style={styles.searchContainer}>
        <View style={[styles.searchWrap, { backgroundColor: colors.surfaceElevated, borderColor: query ? colors.accent : colors.borderSoft }, shadowSm]}>
          <MaterialCommunityIcons name="magnify" size={20} color={query ? colors.accent : colors.muted} />
          <TextInput
            style={[styles.searchInput, { color: colors.content, fontSize: font.md }]}
            value={query}
            onChangeText={onChangeQuery}
            placeholder="Search all files and contents…"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            selectionColor={colors.accent}
          />
          {searching && <ActivityIndicator size="small" color={colors.accent} />}
          {query.trim() !== "" && !searching && (
            <TouchableOpacity onPress={() => onChangeQuery("")} hitSlop={8} style={styles.clearBtn}>
              <MaterialCommunityIcons name="close-circle" size={18} color={colors.muted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter Category Chips */}
        <View style={styles.filterRow}>
          {(["all", "image", "document", "video", "audio"] as FilterTag[]).map((tag) => (
            <TouchableOpacity
              key={tag}
              style={[
                styles.filterTagPill,
                {
                  backgroundColor: activeFilter === tag ? colors.accent : colors.card,
                  borderColor: activeFilter === tag ? colors.accent : colors.borderSoft,
                },
              ]}
              onPress={() => setActiveFilter(tag)}
            >
              <Text
                style={{
                  color: activeFilter === tag ? "#fff" : colors.muted,
                  fontSize: font.xs,
                  fontWeight: "700",
                  textTransform: "capitalize",
                }}
              >
                {tag === "image" ? "Photos" : tag === "document" ? "Docs" : tag}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {query.trim() !== "" && (
          <Text style={[styles.resultCount, { color: colors.muted, fontSize: font.xs }]}>
            {searching ? "Searching server…" : `${displayItems.length} result${displayItems.length !== 1 ? "s" : ""}`}
          </Text>
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
        contentContainerStyle={{ paddingBottom: 130 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
        ListEmptyComponent={
          loading ? (
            <ListSkeleton rows={8} />
          ) : query.trim() ? (
            <EmptyState
              icon="file-search-outline"
              title={searchError || "No matching files"}
              hint={searchError ? "Try again in a moment." : "Try a different search term or change the filter."}
            />
          ) : (
            <EmptyState
              icon="history"
              title={error || "No recent files"}
              hint={error ? "Pull down to retry." : "Files you open will appear here for fast access."}
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  searchContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  searchInput: { flex: 1, padding: 0 },
  clearBtn: { padding: 2 },
  filterRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 2,
  },
  filterTagPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  resultCount: {
    fontWeight: "600",
    paddingLeft: 4,
    marginTop: 2,
  },
});
