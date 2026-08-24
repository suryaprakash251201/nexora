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
import { LinearGradient } from "expo-linear-gradient";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useSession } from "../store/SessionContext";
import { useTheme } from "../store/ThemeContext";
import { FileRow, EmptyState, ROW_HEIGHT } from "../components/FileRow";
import { ListSkeleton } from "../components/Skeletons";
import { previewKind } from "../api/client";
import type { FileItem } from "../api/types";
import type { RootStackParamList, MainTabParamList } from "../navigation/types";
import { useAudio } from "../store/AudioContext";
import AsyncStorage from "@react-native-async-storage/async-storage";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type TabRoute = RouteProp<MainTabParamList, "Recents">;
type FilterTag = "all" | "image" | "document" | "video" | "audio";

const VALID_FILTERS: FilterTag[] = ["all", "image", "document", "video", "audio"];
const RECENT_SEARCHES_KEY = "nexora.searchRecents";

export default function RecentsScreen({ variant = "recents" }: { variant?: "recents" | "search" }) {
  const navigation = useNavigation<Nav>();
  const route = useRoute<TabRoute>();
  const { api } = useSession();
  const { colors, font, radius, spacing, shadow, shadowSm } = useTheme();
  const { playTrack } = useAudio();
  const searchRef = useRef<TextInput>(null);

  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(variant !== "search");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<FileItem[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterTag>("all");
  // Hidden “show everything” mode: tapping a category chip with an empty box
  // searches "." (all files) server-side WITHOUT typing "." into the input.
  const [searchAll, setSearchAll] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeq = useRef(0);

  // ── Recent searches (persisted) ──────────────────────────────────────
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  useEffect(() => {
    if (variant !== "search") return;
    AsyncStorage.getItem(RECENT_SEARCHES_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) setRecentSearches(arr.slice(0, 8));
        } catch { /* corrupted — ignore */ }
      })
      .catch(() => {});
  }, [variant]);

  const rememberSearch = useCallback((q: string) => {
    const term = q.trim();
    if (!term) return;
    setRecentSearches((prev) => {
      const next = [term, ...prev.filter((x) => x.toLowerCase() !== term.toLowerCase())].slice(0, 8);
      AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const removeRecentSearch = useCallback((term: string) => {
    setRecentSearches((prev) => {
      const next = prev.filter((x) => x !== term);
      AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  // Clear any pending debounce when the screen unmounts.
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

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
    if (variant === "search") return; // search tab is search-first — no recents list
    load();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [load, variant]);

  // Consume params sent from Home (search bar tap → focus; quick category → filter).
  useEffect(() => {
    if (route.params?.filter && VALID_FILTERS.includes(route.params.filter as FilterTag)) {
      setActiveFilter(route.params.filter as FilterTag);
      // Auto-trigger a search to fetch all matching files from the server,
      // rather than just filtering the limited "recents" list.
      if (!query.trim() && !searchAll) {
        setSearchAll(true);
        runSearch(".");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.filter]);

  useEffect(() => {
    if (route.params?.focusSearch || variant === "search") {
      const t = setTimeout(() => searchRef.current?.focus(), variant === "search" ? 450 : 350);
      return () => clearTimeout(t);
    }
  }, [route.params?.focusSearch, variant]);

  const runSearch = useCallback(
    async (q: string) => {
      if (!api || !q.trim()) return;
      const seq = ++searchSeq.current;
      setSearching(true);
      setSearchError(null);
      try {
        const res = await api.search(q.trim());
        if (seq === searchSeq.current) setSearchResults(res.items || []);
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
      setSearchAll(false); // typing exits “show all files” mode
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

  /** Runs a search immediately (chips, keyboard submit) — bypasses debounce. */
  const runSearchNow = useCallback(
    (q: string) => {
      setQuery(q);
      setSearchAll(false);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!q.trim()) {
        setSearchResults([]);
        setSearching(false);
        setSearchError(null);
        return;
      }
      rememberSearch(q);
      runSearch(q);
    },
    [runSearch, rememberSearch]
  );

  // Clear any pending debounce when the screen unmounts.
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const selectFilter = useCallback(
    (tag: FilterTag) => {
      setActiveFilter(tag);
      // In search mode a chip tap should fetch matching files from the server,
      // not just filter an empty (no-query) list — without typing "." into the box.
      if (variant === "search" && !query.trim() && !searchAll) {
        setSearchAll(true);
        runSearch(".");
      }
    },
    [variant, query, searchAll, runSearch]
  );

  const baseItems = useMemo(
    () => (query.trim() || searchAll ? searchResults : items),
    [query, searchAll, searchResults, items]
  );

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
    (item: FileItem) => {
      if (item.is_dir) {
        // Folders open inside the file explorer, not the preview card.
        navigation.navigate("Browser", { rootId: item.root_id, rootName: item.name, path: item.path });
      } else if (previewKind(item) === "audio") {
        playTrack(item, displayItems.filter((x) => !x.is_dir && previewKind(x) === "audio"));
      } else {
        navigation.navigate("Preview", { item, rootId: item.root_id });
      }
    },
    [navigation, playTrack, displayItems]
  );

  // Directly play an audio row from the trailing button.
  const playAudioNow = useCallback(
    (item: FileItem) => {
      playTrack(item, displayItems.filter((x) => !x.is_dir && previewKind(x) === "audio"));
    },
    [playTrack, displayItems]
  );

  const renderRow = useCallback(
    ({ item }: { item: FileItem }) => (
      <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSoft }}>
        <FileRow
          item={item}
          onPress={openFile}
          highlight={variant === "search" ? query : undefined}
          subtitle={item.is_dir ? "Folder" : query.trim() ? item.path.replace(/\/[^/]+$/, "") || "/" : undefined}
          showDate={!query.trim()}
          trailing={
            !item.is_dir && previewKind(item) === "audio" ? (
              <TouchableOpacity
                onPress={() => playAudioNow(item)}
                hitSlop={10}
                style={[styles.playBtn, { backgroundColor: colors.accentSoft }]}
              >
                <MaterialCommunityIcons name="play" size={16} color={colors.accent} style={{ marginLeft: 1 }} />
              </TouchableOpacity>
            ) : undefined
          }
        />
      </View>
    ),
    [colors.borderSoft, colors.accentSoft, colors.accent, openFile, playAudioNow, query]
  );

  const emptyState =
    variant === "search" && !query.trim() && !searchAll ? (
      <EmptyState
        icon="magnify"
        title={searchError || "Search your files"}
        hint={searchError ? "Try again in a moment." : "Find files by name, type, or content across all your storage."}
      />
    ) : undefined;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {/* Search Input Bar */}
      <View style={styles.searchContainer}>
        <View style={[styles.searchWrap, { backgroundColor: colors.surfaceElevated, borderColor: query ? colors.accent : colors.borderSoft, borderRadius: radius.xl }, shadow]}>
          <LinearGradient
            colors={["rgba(255,255,255,0.06)", "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.glassHighlight}
          />
          <MaterialCommunityIcons name="magnify" size={20} color={query ? colors.accent : colors.muted} />
          <TextInput
            ref={searchRef}
            style={[styles.searchInput, { color: colors.content, fontSize: font.md }]}
            value={query}
            onChangeText={onChangeQuery}
            placeholder="Search all files and contents…"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => runSearchNow(query)}
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
          {(
            [
              { id: "all", label: "All", icon: "view-grid-outline" },
              { id: "image", label: "Photos", icon: "image-multiple" },
              { id: "document", label: "Docs", icon: "file-document" },
              { id: "video", label: "Videos", icon: "play-circle" },
              { id: "audio", label: "Audio", icon: "music-note" },
            ] as { id: FilterTag; label: string; icon: string }[]
          ).map((tag) => (
            <TouchableOpacity
              key={tag.id}
              style={[
                styles.filterTagPill,
                {
                  backgroundColor: activeFilter === tag.id ? colors.accent : colors.card,
                  borderColor: activeFilter === tag.id ? colors.accent : colors.borderSoft,
                },
              ]}
              onPress={() => selectFilter(tag.id)}
            >
              <MaterialCommunityIcons
                name={tag.icon as any}
                size={13}
                color={activeFilter === tag.id ? "#fff" : colors.muted}
              />
              <Text
                style={{
                  color: activeFilter === tag.id ? "#fff" : colors.muted,
                  fontSize: font.xs,
                  fontWeight: "700",
                }}
              >
                {tag.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Recent searches (search tab, empty query) */}
        {variant === "search" && !query.trim() && recentSearches.length > 0 && (
          <View style={styles.recentRow}>
            <MaterialCommunityIcons name="history" size={14} color={colors.muted} />
            {recentSearches.map((term) => (
              <TouchableOpacity
                key={term}
                style={[styles.recentChip, { backgroundColor: colors.card, borderColor: colors.borderSoft }]}
                onPress={() => runSearchNow(term)}
                onLongPress={() => removeRecentSearch(term)}
              >
                <Text style={{ color: colors.content, fontSize: font.xs, fontWeight: "600" }} numberOfLines={1}>
                  {term}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {(query.trim() !== "" || searchAll) && (
          <Text style={[styles.resultCount, { color: colors.muted, fontSize: font.xs }]}>
            {searching
              ? "Searching server…"
              : searchAll && !query.trim()
                ? `Showing all ${displayItems.length} file${displayItems.length === 1 ? "" : "s"}`
                : `${displayItems.length} result${displayItems.length !== 1 ? "s" : ""}`}
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
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 130 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              if (variant === "search") {
                if (query.trim()) runSearch(query);
                else if (searchAll) runSearch(".");
              } else {
                load(true);
              }
            }}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          emptyState
            ? emptyState
            : loading ? (
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
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
  },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  recentChip: {
    flexDirection: "row",
    alignItems: "center",
    maxWidth: 150,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  resultCount: {
    fontWeight: "600",
    paddingLeft: 4,
    marginTop: 2,
  },
  playBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  glassHighlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 24,
    pointerEvents: "none",
  },
});
