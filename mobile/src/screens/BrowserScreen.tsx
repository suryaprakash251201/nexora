import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";

import { useSession } from "../store/SessionContext";
import { useTheme } from "../store/ThemeContext";
import { FileRow, EmptyState, ROW_HEIGHT } from "../components/FileRow";
import { GridCard } from "../components/GridCard";
import { BottomSheet } from "../components/BottomSheet";
import { ListSkeleton, GridCardSkeleton } from "../components/Skeletons";
import { previewKind } from "../api/client";
import { copyShareLink } from "../lib/shareLink";
import type { FileItem, FileListResponse } from "../api/types";
import type { RootStackParamList } from "../navigation/types";
import { useAudio } from "../store/AudioContext";

type Props = NativeStackScreenProps<RootStackParamList, "Browser">;

const PAGE = 100;
type SortField = "name" | "size" | "modified" | "extension";
type SortOrder = "asc" | "desc";
type FilterCategory = "all" | "image" | "document" | "audio" | "video";

const haptic = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

export default function BrowserScreen({ route, navigation }: Props) {
  const { rootId, rootName } = route.params;
  const { api } = useSession();
  const { colors, font, gradients, radius, spacing, shadow, shadowSm, isDark } = useTheme();
  const { playTrack } = useAudio();
  const insets = useSafeAreaInsets();

  const [path, setPath] = useState(route.params.path || "");
  const [items, setItems] = useState<FileItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // View Mode: "list" | "grid"
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");

  // Selection state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  // Sort & Filter state
  const [showSortSheet, setShowSortSheet] = useState(false);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [filterCategory, setFilterCategory] = useState<FilterCategory>("all");

  // Dialog Sheets
  const [actionItem, setActionItem] = useState<FileItem | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameItem, setRenameItem] = useState<FileItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadFilename, setUploadFilename] = useState("");
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadDone, setUploadDone] = useState(0);
  const uploadAbortRef = useRef<(() => void) | null>(null);
  const uploadCancelRef = useRef(false);

  const loadRef = useRef(0);

  const load = useCallback(
    async (atPath: string, start = 0, append = false) => {
      if (!api) return;
      const ticket = ++loadRef.current;
      if (start === 0 && !append) setLoading(true);
      setError(null);
      try {
        const res: FileListResponse = await api.listFiles(rootId, atPath, start, PAGE);
        if (ticket !== loadRef.current) return;
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
        setTotal(res.total);
        setOffset(start + res.items.length);
        setHasMore(res.has_more);
      } catch (e: any) {
        if (ticket !== loadRef.current) return;
        setError(e?.message || "Failed to load folder.");
      } finally {
        if (ticket === loadRef.current) {
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    },
    [api, rootId]
  );

  useEffect(() => {
    setSelectMode(false);
    setSelectedPaths(new Set());
    load(path, 0);
  }, [path, load]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    load(path, 0);
  }, [load, path]);

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    load(path, offset, true);
  }, [hasMore, loadingMore, load, path, offset]);

  // Process items with Sort and Category Filter
  const processedItems = useMemo(() => {
    let list = [...items];

    // Filter
    if (filterCategory !== "all") {
      list = list.filter((item) => {
        if (item.is_dir) return true; // keep folders
        const k = previewKind(item);
        if (filterCategory === "image") return k === "image";
        if (filterCategory === "video") return k === "video";
        if (filterCategory === "audio") return k === "audio";
        if (filterCategory === "document") return ["pdf", "text", "code", "markdown"].includes(k);
        return true;
      });
    }

    // Sort: Folders always first, then by sortField
    list.sort((a, b) => {
      if (a.is_dir && !b.is_dir) return -1;
      if (!a.is_dir && b.is_dir) return 1;

      let valA: any = a.name.toLowerCase();
      let valB: any = b.name.toLowerCase();

      if (sortField === "size") {
        valA = a.size;
        valB = b.size;
      } else if (sortField === "modified") {
        valA = new Date(a.modified).getTime();
        valB = new Date(b.modified).getTime();
      } else if (sortField === "extension") {
        valA = (a.extension || "").toLowerCase();
        valB = (b.extension || "").toLowerCase();
      }

      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });

    return list;
  }, [items, sortField, sortOrder, filterCategory]);

  const openItem = useCallback(
    (item: FileItem) => {
      if (item.is_dir) {
        setPath(item.path);
      } else if (previewKind(item) === "audio") {
        playTrack(item, processedItems.filter(x => !x.is_dir && previewKind(x) === "audio"));
      } else {
        navigation.navigate("Preview", { item, rootId });
      }
    },
    [navigation, rootId, playTrack, processedItems]
  );

  const showActions = useCallback((item: FileItem) => {
    haptic();
    setActionItem(item);
  }, []);

  // Multi-Selection Logic
  const toggleSelect = useCallback((item: FileItem) => {
    haptic();
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(item.path)) {
        next.delete(item.path);
      } else {
        next.add(item.path);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (selectedPaths.size === processedItems.length) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(processedItems.map((i) => i.path)));
    }
  }, [processedItems, selectedPaths]);

  // Bulk Delete
  const handleBulkDelete = useCallback(() => {
    if (selectedPaths.size === 0 || !api) return;
    Alert.alert(
      "Delete Selected",
      `Delete ${selectedPaths.size} item${selectedPaths.size === 1 ? "" : "s"}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              for (const itemPath of selectedPaths) {
                await api.remove(rootId, itemPath);
              }
              setSelectedPaths(new Set());
              setSelectMode(false);
              load(path, 0);
            } catch (e: any) {
              Alert.alert("Delete failed", e?.message || "Something went wrong.");
            }
          },
        },
      ]
    );
  }, [api, path, rootId, selectedPaths, load]);

  // ── Upload ──────────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!api) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
      if (result.canceled) return;
      haptic();
      const assets = result.assets;
      uploadCancelRef.current = false;
      setUploading(true);
      setUploadProgress(0);
      setUploadTotal(assets.length);
      setUploadDone(0);
      let ok = 0;
      try {
        for (let i = 0; i < assets.length; i++) {
          if (uploadCancelRef.current) break;
          const doc = assets[i];
          setUploadFilename(doc.name);
          setUploadDone(i);
          const form = new FormData();
          form.append("files", {
            uri: doc.uri,
            name: doc.name,
            type: doc.mimeType || "application/octet-stream",
          } as any);
          const { promise, abort } = api.upload(rootId, path, form, (pct) => setUploadProgress(pct));
          uploadAbortRef.current = abort;
          await promise;
          uploadAbortRef.current = null;
          ok += 1;
        }
        setUploadDone(ok);
        if (!uploadCancelRef.current) {
          Alert.alert("Upload complete", `${ok} file${ok === 1 ? "" : "s"} uploaded.`);
        }
        load(path, 0);
      } finally {
        setUploading(false);
        setUploadFilename("");
        uploadAbortRef.current = null;
      }
    } catch (e: any) {
      setUploading(false);
      setUploadFilename("");
      uploadAbortRef.current = null;
      if (!uploadCancelRef.current) {
        Alert.alert("Upload failed", e?.message || "Something went wrong.");
      }
    } finally {
      setUploadProgress(0);
    }
  };

  const cancelUpload = useCallback(() => {
    uploadCancelRef.current = true;
    uploadAbortRef.current?.();
    uploadAbortRef.current = null;
    setUploading(false);
    setUploadFilename("");
  }, []);

  // ── Create Folder ───────────────────────────────────────────────────
  const handleCreateFolder = async () => {
    if (!api || !newFolderName.trim()) return;
    try {
      await api.createDir(rootId, path, newFolderName.trim());
      setShowNewFolder(false);
      setNewFolderName("");
      load(path, 0);
    } catch (e: any) {
      Alert.alert("Could not create folder", e?.message || "Something went wrong.");
    }
  };

  // ── Rename / Delete / Share Single ─────────────────────────────────
  const handleRename = async () => {
    if (!api || !renameItem || !renameValue.trim()) return;
    try {
      await api.rename(rootId, renameItem.path, renameValue.trim());
      setRenameItem(null);
      load(path, 0);
    } catch (e: any) {
      Alert.alert("Rename failed", e?.message || "Something went wrong.");
    }
  };

  const confirmDelete = useCallback(
    (item: FileItem) => {
      Alert.alert("Delete", `Move "${item.name}" to trash?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            if (!api) return;
            try {
              await api.remove(rootId, item.path);
              load(path, 0);
            } catch (e: any) {
              Alert.alert("Delete failed", e?.message || "Something went wrong.");
            }
          },
        },
      ]);
    },
    [api, load, path, rootId]
  );

  const downloadAndShare = useCallback(
    async (item: FileItem) => {
      if (!api) return;
      try {
        const target = new File(Paths.cache, "nexora-" + item.name.replace(/[^\w.\-]+/g, "_"));
        await File.downloadFileAsync(api.rawFileUrl(item.root_id || rootId, item.path), target);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(target.uri);
        } else {
          Alert.alert("Downloaded", `Saved to ${target.uri}`);
        }
      } catch (e: any) {
        Alert.alert("Download failed", e?.message || "Something went wrong.");
      }
    },
    [api, rootId]
  );

  const breadcrumbs = path.split("/").filter(Boolean);

  const renderListItem = useCallback(
    ({ item }: { item: FileItem }) => (
      <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSoft }}>
        <FileRow
          item={item}
          onPress={openItem}
          onLongPress={() => {
            setSelectMode(true);
            toggleSelect(item);
          }}
          selectMode={selectMode}
          selected={selectedPaths.has(item.path)}
          onSelect={toggleSelect}
          trailing={
            selectMode ? undefined : (
              <TouchableOpacity onPress={() => showActions(item)} hitSlop={10} style={[styles.moreHit, { backgroundColor: colors.card }]}>
                <MaterialCommunityIcons name="dots-vertical" size={20} color={colors.content} />
              </TouchableOpacity>
            )
          }
        />
      </View>
    ),
    [colors, openItem, selectMode, selectedPaths, showActions, toggleSelect]
  );

  const renderGridItem = useCallback(
    ({ item }: { item: FileItem }) => (
      <GridCard
        item={item}
        rawUrl={api && previewKind(item) === "image" ? api.thumbnailUrl(item.root_id || rootId, item.path, 512) : undefined}
        onPress={openItem}
        onLongPress={() => {
          setSelectMode(true);
          toggleSelect(item);
        }}
        onMorePress={showActions}
        selectMode={selectMode}
        selected={selectedPaths.has(item.path)}
        onSelect={toggleSelect}
      />
    ),
    [api, openItem, rootId, selectMode, selectedPaths, showActions, toggleSelect]
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {/* Selection Mode Header or Breadcrumb Header */}
      {selectMode ? (
        <View style={[styles.selectionBar, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderSoft }, shadowSm]}>
          <TouchableOpacity onPress={() => { setSelectMode(false); setSelectedPaths(new Set()); }}>
            <MaterialCommunityIcons name="close" size={24} color={colors.content} />
          </TouchableOpacity>
          <Text style={[styles.selectionTitle, { color: colors.content, fontSize: font.md }]}>
            {selectedPaths.size} selected
          </Text>
          <TouchableOpacity onPress={selectAll} style={[styles.selectionPill, { backgroundColor: colors.card }]}>
            <Text style={{ color: colors.accent, fontSize: font.xs, fontWeight: "700" }}>
              {selectedPaths.size === processedItems.length ? "Deselect All" : "Select All"}
            </Text>
          </TouchableOpacity>
          {selectedPaths.size > 0 && (
            <TouchableOpacity onPress={handleBulkDelete} style={[styles.selectionDeleteBtn, { backgroundColor: "rgba(239,68,68,0.15)" }]}>
              <MaterialCommunityIcons name="delete" size={18} color={colors.danger} />
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <View style={styles.crumbsContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "center", paddingRight: 16 }}>
            <TouchableOpacity onPress={() => setPath("")} style={{ flexDirection: "row", alignItems: "center" }} activeOpacity={0.7}>
              <MaterialCommunityIcons name={path === "" ? "home" : "home-outline"} size={path === "" ? 24 : 22} color={path === "" ? colors.content : colors.muted} />
              {path === "" && (
                <Text style={{ color: colors.content, fontSize: font.xl, fontWeight: "800", marginLeft: 8 }}>{rootName}</Text>
              )}
            </TouchableOpacity>
            
            {breadcrumbs.map((segment, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              const targetPath = breadcrumbs.slice(0, idx + 1).join("/");
              return (
                <React.Fragment key={targetPath}>
                  <MaterialCommunityIcons name="chevron-right" size={20} color={colors.muted} style={{ marginHorizontal: 4 }} />
                  <TouchableOpacity onPress={() => !isLast && setPath(targetPath)} disabled={isLast} activeOpacity={0.7}>
                    <Text style={{ color: isLast ? colors.content : colors.muted, fontSize: isLast ? font.xl : font.lg, fontWeight: isLast ? "800" : "600" }}>
                      {segment}
                    </Text>
                  </TouchableOpacity>
                </React.Fragment>
              );
            })}
            
            {!loading && total > 0 ? (
              <View style={[styles.countBadge, { backgroundColor: colors.accentSoft, marginLeft: 12 }]}>
                <MaterialCommunityIcons name="file-multiple" size={12} color={colors.accent} />
                <Text style={[styles.count, { color: colors.accent, fontSize: font.xs }]}>{processedItems.length}</Text>
              </View>
            ) : null}
          </ScrollView>
        </View>
      )}

      {/* Top Actions Bar (Moved from bottom) */}
      {!selectMode && (
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 16, gap: 10 }}>
          {/* View Mode Toggle */}
          <TouchableOpacity
            style={[styles.actionCircleBtn, { backgroundColor: colors.surfaceElevated }, shadowSm]}
            onPress={() => {
              haptic();
              setViewMode(viewMode === "list" ? "grid" : "list");
            }}
          >
            <MaterialCommunityIcons name={viewMode === "list" ? "view-grid-outline" : "format-list-bulleted"} size={20} color={colors.content} />
          </TouchableOpacity>

          {/* Sort & Filter Trigger */}
          <TouchableOpacity
            style={[styles.actionCircleBtn, { backgroundColor: colors.surfaceElevated }, shadowSm]}
            onPress={() => {
              haptic();
              setShowSortSheet(true);
            }}
          >
            <MaterialCommunityIcons name="sort-variant" size={20} color={sortField !== "name" || sortOrder !== "asc" || filterCategory !== "all" ? colors.accent : colors.content} />
            {(sortField !== "name" || sortOrder !== "asc" || filterCategory !== "all") && (
              <View style={[styles.sortDot, { backgroundColor: colors.accent }]} />
            )}
          </TouchableOpacity>

          {/* New Folder */}
          <TouchableOpacity style={[styles.actionBtnElevated, { backgroundColor: colors.surfaceElevated }, shadowSm]} onPress={() => setShowNewFolder(true)}>
            <MaterialCommunityIcons name="folder-plus-outline" size={18} color={colors.content} />
            <Text style={[styles.actionText, { color: colors.content, fontSize: font.sm }]}>Folder</Text>
          </TouchableOpacity>

          {/* Primary Upload Button */}
          <TouchableOpacity style={[styles.uploadBtnContainer, shadowSm]} onPress={handleUpload} disabled={uploading}>
            <LinearGradient colors={[...gradients.brand]} style={styles.uploadGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
              {uploading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <MaterialCommunityIcons name="upload" size={18} color="#fff" />
              )}
              <Text style={styles.uploadText}>Upload</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}

      {/* File List / Grid View */}
      <FlatList
        key={viewMode}
        data={processedItems}
        keyExtractor={(it) => it.path}
        numColumns={viewMode === "grid" ? 2 : 1}
        renderItem={viewMode === "grid" ? renderGridItem : renderListItem}
        getItemLayout={viewMode === "list" ? (_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index }) : undefined}
        initialNumToRender={16}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews={viewMode === "list"}
        contentContainerStyle={{ paddingBottom: 140, paddingHorizontal: viewMode === "grid" ? 6 : 0 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
        ListEmptyComponent={
          loading ? (
            viewMode === "grid" ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", padding: 6 }}>
                <GridCardSkeleton />
                <GridCardSkeleton />
                <GridCardSkeleton />
                <GridCardSkeleton />
              </View>
            ) : (
              <ListSkeleton rows={9} />
            )
          ) : (
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyCard, { backgroundColor: colors.surfaceElevated }, shadow]}>
                <LinearGradient
                  colors={["rgba(255,255,255,0.03)", "transparent"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.glassHighlight}
                />
                <EmptyState
                  icon={error ? "alert-circle-outline" : "folder-open-outline"}
                  title={error || "This folder is empty"}
                  hint={error ? "Pull down to retry." : "Use the upload button below to add files."}
                />
                {!error && (
                  <TouchableOpacity onPress={handleUpload} style={styles.emptyUploadBtn} activeOpacity={0.8}>
                    <LinearGradient colors={[...gradients.brand]} style={styles.emptyUploadGradient} start={{x:0, y:0}} end={{x:1, y:1}}>
                      <MaterialCommunityIcons name="upload" size={20} color="#fff" />
                      <Text style={styles.emptyUploadText}>Upload File</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginVertical: 16 }} color={colors.accent} /> : null}
      />


      {/* Sort & Filter Sheet */}
      <BottomSheet visible={showSortSheet} onClose={() => setShowSortSheet(false)} title="Sort & Filter">
        <View style={styles.sheetSection}>
          <Text style={[styles.sheetSectionTitle, { color: colors.muted }]}>SORT BY</Text>
          <View style={styles.chipRow}>
            {(["name", "size", "modified", "extension"] as SortField[]).map((f) => (
              <TouchableOpacity
                key={f}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: sortField === f ? colors.accent : colors.card,
                    borderColor: sortField === f ? colors.accent : colors.borderSoft,
                  },
                ]}
                onPress={() => setSortField(f)}
              >
                <Text style={{ color: sortField === f ? "#fff" : colors.content, fontSize: font.xs, fontWeight: "600", textTransform: "capitalize" }}>
                  {f === "modified" ? "Date" : f === "extension" ? "Type" : f}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.sheetSection}>
          <Text style={[styles.sheetSectionTitle, { color: colors.muted }]}>ORDER</Text>
          <View style={styles.chipRow}>
            {(["asc", "desc"] as SortOrder[]).map((o) => (
              <TouchableOpacity
                key={o}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: sortOrder === o ? colors.accent : colors.card,
                    borderColor: sortOrder === o ? colors.accent : colors.borderSoft,
                  },
                ]}
                onPress={() => setSortOrder(o)}
              >
                <Text style={{ color: sortOrder === o ? "#fff" : colors.content, fontSize: font.xs, fontWeight: "600" }}>
                  {o === "asc" ? "Ascending A-Z" : "Descending Z-A"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.sheetSection}>
          <Text style={[styles.sheetSectionTitle, { color: colors.muted }]}>FILTER CATEGORY</Text>
          <View style={styles.chipRow}>
            {(["all", "image", "document", "video", "audio"] as FilterCategory[]).map((c) => (
              <TouchableOpacity
                key={c}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: filterCategory === c ? colors.accent : colors.card,
                    borderColor: filterCategory === c ? colors.accent : colors.borderSoft,
                  },
                ]}
                onPress={() => setFilterCategory(c)}
              >
                <Text style={{ color: filterCategory === c ? "#fff" : colors.content, fontSize: font.xs, fontWeight: "600", textTransform: "capitalize" }}>
                  {c}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </BottomSheet>

      {/* Upload Progress Sheet */}
      <BottomSheet
        visible={uploading}
        onClose={() => {}}
        title={uploadTotal > 1 ? `Uploading ${Math.min(uploadDone + 1, uploadTotal)} of ${uploadTotal}` : "Uploading…"}
      >
        <View style={styles.progressWrap}>
          {uploadFilename ? <Text style={[styles.progressFilename, { color: colors.content, fontSize: font.md }]} numberOfLines={1}>{uploadFilename}</Text> : null}
          <View style={[styles.progressTrack, { backgroundColor: "rgba(255,255,255,0.08)" }]}>
            <View style={[styles.progressFill, { width: `${uploadProgress}%`, shadowColor: gradients.brand[0], elevation: 4 }]}>
              <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
            </View>
          </View>
          <View style={styles.progressFooter}>
            <Text style={[styles.progressPctText, { color: colors.muted, fontSize: font.sm }]}>
              {uploadTotal > 1 ? `${uploadDone} of ${uploadTotal} complete` : "Uploading file"}
            </Text>
            <Text style={[styles.progressPctValue, { color: colors.content, fontSize: font.sm }]}>{uploadProgress}%</Text>
          </View>
          <TouchableOpacity
            style={[styles.uploadCancelBtn, { borderColor: colors.borderSoft }]}
            onPress={cancelUpload}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="close" size={16} color={colors.danger} />
            <Text style={[styles.uploadCancelText, { color: colors.danger, fontSize: font.sm }]}>Cancel upload</Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>

      {/* Item Action Sheet */}
      <BottomSheet
        visible={actionItem !== null}
        onClose={() => setActionItem(null)}
        title={actionItem?.name}
        actions={[
          ...(actionItem && !actionItem.is_dir
            ? [{ label: "Download & share", icon: "share-variant", onPress: () => actionItem && downloadAndShare(actionItem) }]
            : []),
          ...(actionItem
            ? [
                {
                  label: "Add to favorites",
                  icon: "heart-outline",
                  onPress: () => {
                    if (!actionItem || !api) return;
                    api.addFavorite(actionItem.root_id || rootId, actionItem.path).then(() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                      Alert.alert("Favorited", `"${actionItem.name}" added to favorites.`);
                    }).catch((e: any) => Alert.alert("Could not favorite", e?.message || "Something went wrong."));
                  },
                },
                {
                  label: "Copy share link",
                  icon: "link-variant",
                  onPress: () => {
                    if (!actionItem || !api) return;
                    copyShareLink(api, actionItem.root_id || rootId, actionItem.path).then((url) => {
                      if (url) Alert.alert("Link copied", url);
                    });
                  },
                },
              ]
            : []),
          {
            label: "Rename",
            icon: "pencil-outline",
            onPress: () => {
              if (!actionItem) return;
              setRenameItem(actionItem);
              setRenameValue(actionItem.name);
            },
          },
          {
            label: "Delete",
            icon: "delete-outline",
            destructive: true,
            onPress: () => actionItem && confirmDelete(actionItem),
          },
        ]}
      />

      {/* New Folder Sheet */}
      <BottomSheet visible={showNewFolder} onClose={() => setShowNewFolder(false)} title="New folder">
        <TextInput
          style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.border, color: colors.content, borderRadius: radius.md }]}
          value={newFolderName}
          onChangeText={setNewFolderName}
          placeholder="Folder name"
          placeholderTextColor={colors.muted}
          autoFocus
          onSubmitEditing={handleCreateFolder}
          selectionColor={colors.accent}
        />
        <TouchableOpacity
          style={[styles.sheetPrimary, { backgroundColor: colors.accent, borderRadius: radius.md }, !newFolderName.trim() && { opacity: 0.5 }]}
          disabled={!newFolderName.trim()}
          onPress={handleCreateFolder}
        >
          <Text style={styles.sheetPrimaryText}>Create Folder</Text>
        </TouchableOpacity>
      </BottomSheet>

      {/* Rename Sheet */}
      <BottomSheet visible={renameItem !== null} onClose={() => setRenameItem(null)} title="Rename">
        <TextInput
          style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.border, color: colors.content, borderRadius: radius.md }]}
          value={renameValue}
          onChangeText={setRenameValue}
          placeholder="New name"
          placeholderTextColor={colors.muted}
          autoFocus
          onSubmitEditing={handleRename}
          selectionColor={colors.accent}
        />
        <TouchableOpacity
          style={[styles.sheetPrimary, { backgroundColor: colors.accent, borderRadius: radius.md }, !renameValue.trim() && { opacity: 0.5 }]}
          disabled={!renameValue.trim()}
          onPress={handleRename}
        >
          <Text style={styles.sheetPrimaryText}>Rename Item</Text>
        </TouchableOpacity>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  glassHighlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 24,
    pointerEvents: "none",
  },

  // Selection Bar
  selectionBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  selectionTitle: { fontWeight: "700" },
  selectionPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  selectionDeleteBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },

  // Crumbs
  crumbsContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 10,
  },
  crumbsCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 24,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.03)",
    overflow: "hidden",
  },
  crumbsInner: { alignItems: "center", gap: 4 },
  crumbPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
  },
  crumb: { maxWidth: 120, fontWeight: "600" },
  countBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 8,
  },
  count: { fontWeight: "700" },
  moreHit: {
    padding: 6,
    borderRadius: 14,
  },

  // Empty state
  emptyContainer: {
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 32,
  },
  emptyCard: {
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
    width: "100%",
  },
  emptyUploadBtn: {
    marginTop: 16,
    width: "100%",
    borderRadius: 14,
    overflow: "hidden",
  },
  emptyUploadGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    gap: 8,
  },
  emptyUploadText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },

  // Actions Bar
  actions: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    borderWidth: 1,
    borderRadius: 24,
    padding: 8,
  },
  actionCircleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtnElevated: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 22,
    paddingVertical: 12,
  },
  actionText: { fontWeight: "600" },
  uploadBtnContainer: {
    flex: 1.4,
    borderRadius: 22,
    overflow: "hidden",
  },
  uploadGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
  },
  uploadText: { color: "#fff", fontSize: 13, fontWeight: "700" },

  // Sort Sheet
  sheetSection: { marginBottom: 16 },
  sheetSectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 1, marginBottom: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },

  // Progress Sheet
  progressWrap: { gap: 12, paddingVertical: 8 },
  progressFilename: { fontWeight: "600", textAlign: "center" },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    marginBottom: 12,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  progressFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressPctText: {},
  progressPctValue: { fontWeight: "700" },
  uploadCancelBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 11,
    marginTop: 4,
  },
  uploadCancelText: { fontWeight: "700" },
  sortDot: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // Inputs & Buttons
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    marginBottom: 16,
  },
  sheetPrimary: {
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 8,
  },
  sheetPrimaryText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
