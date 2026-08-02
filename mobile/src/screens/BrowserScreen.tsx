import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { useSession } from "../store/SessionContext";
import { colors, font, radius, shadow, spacing } from "../theme";
import { FileRow, EmptyState, ROW_HEIGHT } from "../components/FileRow";
import { BottomSheet } from "../components/BottomSheet";
import { ListSkeleton } from "../components/Skeletons";
import type { FileItem, FileListResponse } from "../api/types";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Browser">;

const PAGE = 100;

const haptic = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

export default function BrowserScreen({ route, navigation }: Props) {
  const { rootId, rootName } = route.params;
  const { api } = useSession();
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

  // Sheets / dialogs.
  const [actionItem, setActionItem] = useState<FileItem | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameItem, setRenameItem] = useState<FileItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

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

  const openItem = useCallback(
    (item: FileItem) => {
      if (item.is_dir) {
        setPath(item.path);
      } else {
        navigation.navigate("Preview", { item, rootId });
      }
    },
    [navigation, rootId]
  );

  const showActions = useCallback((item: FileItem) => {
    haptic();
    setActionItem(item);
  }, []);

  // ── Upload ──────────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!api) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
      if (result.canceled) return;
      haptic();
      setUploading(true);
      setUploadProgress(0);
      let ok = 0;
      for (const doc of result.assets) {
        const form = new FormData();
        form.append("files", {
          uri: doc.uri,
          name: doc.name,
          type: doc.mimeType || "application/octet-stream",
        } as any);
        await api.upload(rootId, path, form, (pct) => setUploadProgress(pct));
        ok += 1;
      }
      setUploading(false);
      Alert.alert("Upload complete", `${ok} file${ok === 1 ? "" : "s"} uploaded to ${path || rootName}.`);
      load(path, 0);
    } catch (e: any) {
      setUploading(false);
      Alert.alert("Upload failed", e?.message || "Something went wrong.");
    } finally {
      setUploadProgress(0);
    }
  };

  // ── Create folder ───────────────────────────────────────────────────
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

  // ── Rename / delete / share ─────────────────────────────────────────
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
        await File.downloadFileAsync(api.rawFileUrl(item.root_id, item.path), target);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(target.uri);
        } else {
          Alert.alert("Downloaded", `Saved to ${target.uri}`);
        }
      } catch (e: any) {
        Alert.alert("Download failed", e?.message || "Something went wrong.");
      }
    },
    [api]
  );

  const breadcrumbs = path.split("/").filter(Boolean);

  const renderItem = useCallback(
    ({ item }: { item: FileItem }) => (
      <FileRow
        item={item}
        onPress={openItem}
        onLongPress={showActions}
        trailing={
          item.is_dir ? undefined : (
            <TouchableOpacity onPress={() => showActions(item)} hitSlop={10} style={styles.moreHit}>
              <MaterialCommunityIcons name="dots-horizontal" size={22} color={colors.muted} />
            </TouchableOpacity>
          )
        }
      />
    ),
    [openItem, showActions]
  );

  return (
    <View style={styles.root}>
      {/* Breadcrumb */}
      <View style={styles.crumbs}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.crumbsInner}>
          <TouchableOpacity onPress={() => setPath("")}>
            <Text style={[styles.crumb, path === "" && styles.crumbActive]}>{rootName}</Text>
          </TouchableOpacity>
          {breadcrumbs.map((seg, i) => {
            const segPath = breadcrumbs.slice(0, i + 1).join("/");
            const isLast = i === breadcrumbs.length - 1;
            return (
              <React.Fragment key={segPath}>
                <Text style={styles.crumbSep}>/</Text>
                <TouchableOpacity onPress={() => !isLast && setPath(segPath)} disabled={isLast}>
                  <Text style={[styles.crumb, isLast && styles.crumbActive]} numberOfLines={1}>
                    {seg}
                  </Text>
                </TouchableOpacity>
              </React.Fragment>
            );
          })}
        </ScrollView>
        {!loading && total > 0 ? <Text style={styles.count}>{total}</Text> : null}
      </View>

      <FlatList
        data={items}
        keyExtractor={(it) => it.path}
        renderItem={renderItem}
        getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
        initialNumToRender={16}
        maxToRenderPerBatch={12}
        windowSize={7}
        updateCellsBatchingPeriod={40}
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
        ListEmptyComponent={
          loading ? (
            <ListSkeleton rows={9} />
          ) : (
            <EmptyState
              icon={error ? "alert-circle-outline" : "folder-open-outline"}
              title={error || "This folder is empty"}
              hint={error ? "Pull down to retry." : "Use the upload button to add files."}
            />
          )
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginVertical: 16 }} color={colors.accent} /> : null}
      />

      {/* Floating action bar */}
      <View style={[styles.actions, { bottom: insets.bottom + 18 }]}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => setShowNewFolder(true)}>
          <MaterialCommunityIcons name="folder-plus-outline" size={20} color={colors.content} />
          <Text style={styles.actionText}>Folder</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, styles.actionBtnRefresh]} onPress={refresh}>
          <MaterialCommunityIcons name="refresh" size={20} color={colors.content} />
          <Text style={styles.actionText}>Refresh</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.uploadBtn} onPress={handleUpload} disabled={uploading}>
          {uploading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <MaterialCommunityIcons name="upload" size={20} color="#fff" />
          )}
          <Text style={styles.uploadText}>Upload</Text>
        </TouchableOpacity>
      </View>

      {/* Upload progress sheet */}
      <BottomSheet visible={uploading} onClose={() => {}} title="Uploading…">
        <View style={styles.progressWrap}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${uploadProgress}%` }]} />
          </View>
          <Text style={styles.progressPct}>{uploadProgress}%</Text>
        </View>
      </BottomSheet>

      {/* Item actions sheet */}
      <BottomSheet
        visible={actionItem !== null}
        onClose={() => setActionItem(null)}
        title={actionItem?.name}
        actions={[
          ...(actionItem && !actionItem.is_dir
            ? [{ label: "Download & share", icon: "share-variant", onPress: () => actionItem && downloadAndShare(actionItem) }]
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

      {/* New folder sheet */}
      <BottomSheet visible={showNewFolder} onClose={() => setShowNewFolder(false)} title="New folder">
        <TextInput
          style={styles.input}
          value={newFolderName}
          onChangeText={setNewFolderName}
          placeholder="Folder name"
          placeholderTextColor={colors.muted}
          autoFocus
          onSubmitEditing={handleCreateFolder}
          selectionColor={colors.accent}
        />
        <TouchableOpacity
          style={[styles.sheetPrimary, !newFolderName.trim() && styles.btnDisabled]}
          disabled={!newFolderName.trim()}
          onPress={handleCreateFolder}
        >
          <Text style={styles.sheetPrimaryText}>Create</Text>
        </TouchableOpacity>
      </BottomSheet>

      {/* Rename sheet */}
      <BottomSheet visible={renameItem !== null} onClose={() => setRenameItem(null)} title="Rename">
        <TextInput
          style={styles.input}
          value={renameValue}
          onChangeText={setRenameValue}
          placeholder="New name"
          placeholderTextColor={colors.muted}
          autoFocus
          onSubmitEditing={handleRename}
          selectionColor={colors.accent}
        />
        <TouchableOpacity
          style={[styles.sheetPrimary, !renameValue.trim() && styles.btnDisabled]}
          disabled={!renameValue.trim()}
          onPress={handleRename}
        >
          <Text style={styles.sheetPrimaryText}>Rename</Text>
        </TouchableOpacity>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  crumbs: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: 6,
  },
  crumbsInner: { alignItems: "center", gap: 4, paddingRight: 8 },
  crumb: { color: colors.muted, fontSize: font.sm, maxWidth: 180 },
  crumbActive: { color: colors.content, fontWeight: "700" },
  crumbSep: { color: colors.muted, opacity: 0.5 },
  count: {
    color: colors.muted,
    fontSize: font.xs,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  moreHit: { padding: 6 },
  actions: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: 8,
    ...shadow,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: radius.lg,
    paddingVertical: 12,
    backgroundColor: colors.card,
  },
  actionBtnRefresh: { backgroundColor: colors.surfaceMuted },
  actionText: { color: colors.content, fontSize: font.sm, fontWeight: "600" },
  uploadBtn: {
    flex: 1.2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: 12,
  },
  uploadText: { color: "#fff", fontSize: font.sm, fontWeight: "700" },
  progressWrap: { gap: 8, paddingVertical: spacing.sm },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.card, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: colors.accent, borderRadius: 3 },
  progressPct: { color: colors.muted, fontSize: font.xs, textAlign: "center" },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: colors.content,
    fontSize: font.md,
    marginBottom: spacing.md,
  },
  sheetPrimary: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  sheetPrimaryText: { color: "#fff", fontWeight: "700", fontSize: font.md },
  btnDisabled: { opacity: 0.5 },
});
