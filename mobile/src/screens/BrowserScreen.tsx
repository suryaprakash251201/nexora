import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { File, Directory, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSession } from "../store/SessionContext";
import { colors, font, radius, spacing } from "../theme";
import { FileIcon, EmptyState } from "../components/FileIcon";
import { formatBytes, formatDate } from "../api/client";
import type { FileItem, FileListResponse } from "../api/types";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Browser">;

const PAGE = 100;

export default function BrowserScreen({ route, navigation }: Props) {
  const { rootId, rootName } = route.params;
  const { api } = useSession();

  const [path, setPath] = useState(route.params.path || "");
  const [items, setItems] = useState<FileItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Upload / new-folder modal state.
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameItem, setRenameItem] = useState<FileItem | null>(null);
  const [renameValue, setRenameValue] = useState("");

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

  const refresh = () => {
    setRefreshing(true);
    load(path, 0);
  };

  const loadMore = () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    load(path, offset, true);
  };

  const openItem = (item: FileItem) => {
    if (item.is_dir) {
      setPath(item.path);
    } else {
      navigation.navigate("Preview", { item, rootId });
    }
  };

  // ── Upload ──────────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!api) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
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
      Alert.alert("Upload complete", `${ok} file${ok === 1 ? "" : "s"} uploaded to ${path || rootName}.`);
      load(path, 0);
    } catch (e: any) {
      Alert.alert("Upload failed", e?.message || "Something went wrong.");
    } finally {
      setUploading(false);
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

  // ── Item actions ────────────────────────────────────────────────────
  const itemActions = (item: FileItem) => {
    const opts: Array<{ label: string; icon: string; destructive?: boolean; onPress: () => void }> = [];
    if (!item.is_dir) {
      opts.push({
        label: "Download & share",
        icon: "share-variant",
        onPress: () => downloadAndShare(item),
      });
    }
    opts.push({ label: "Rename", icon: "pencil-outline", onPress: () => promptRename(item) });    opts.push({ label: "Delete", icon: "delete-outline", destructive: true, onPress: () => confirmDelete(item) });
    Alert.alert(item.name, undefined, opts.map((o) => ({
      text: o.label,
      style: o.destructive ? "destructive" : "default",
      onPress: o.onPress,
    })));
  };

  const promptRename = (item: FileItem) => {
    setRenameItem(item);
    setRenameValue(item.name);
  };

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

  const confirmDelete = (item: FileItem) => {
    Alert.alert(
      "Delete",
      `Move "${item.name}" to trash?`,
      [
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
      ]
    );
  };

  const downloadAndShare = async (item: FileItem) => {
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
  };

  const breadcrumbs = path.split("/").filter(Boolean);

  return (
    <View style={styles.root}>
      {/* Breadcrumb */}
      <View style={styles.crumbs}>
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
        <View style={{ flex: 1 }} />
        {!loading && (
          <Text style={styles.count}>
            {total} item{total === 1 ? "" : "s"}
          </Text>
        )}
      </View>

      <FlatList
        data={items}
        keyExtractor={(it) => it.path}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.7}
            onPress={() => openItem(item)}
            onLongPress={() => itemActions(item)}
            delayLongPress={400}
          >
            <FileIcon item={item} />
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.rowSub}>
                {item.is_dir ? "Folder" : formatBytes(item.size)} · {formatDate(item.modified)}
              </Text>
            </View>
            {item.is_dir ? (
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.muted} />
            ) : (
              <TouchableOpacity onPress={() => itemActions(item)} hitSlop={10}>
                <MaterialCommunityIcons name="dots-horizontal" size={22} color={colors.muted} />
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          loading ? (
            <View style={styles.centerPad}>
              <ActivityIndicator size="large" color={colors.accent} />
            </View>
          ) : (
            <EmptyState
              icon={error ? "alert-circle-outline" : "folder-open-outline"}
              title={error || "This folder is empty"}
              hint={error ? "Pull down to retry." : "Use the + button to upload files or create a folder."}
            />
          )
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator style={{ marginVertical: 16 }} color={colors.accent} />
          ) : null
        }
      />

      {/* Bottom action bar */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionBtn} onPress={handleUpload} disabled={uploading}>
          <MaterialCommunityIcons name="upload" size={22} color={colors.content} />
          <Text style={styles.actionText}>Upload</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => setShowNewFolder(true)}>
          <MaterialCommunityIcons name="folder-plus" size={22} color={colors.content} />
          <Text style={styles.actionText}>New folder</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={refresh}>
          <MaterialCommunityIcons name="refresh" size={22} color={colors.content} />
          <Text style={styles.actionText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {/* Upload progress modal */}
      <Modal transparent visible={uploading} animationType="fade">
        <View style={styles.modalBack}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Uploading…</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${uploadProgress}%` }]} />
            </View>
            <Text style={styles.modalSub}>{uploadProgress}%</Text>
          </View>
        </View>
      </Modal>

      {/* New folder modal */}
      <Modal transparent visible={showNewFolder} animationType="fade" onRequestClose={() => setShowNewFolder(false)}>
        <View style={styles.modalBack}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New folder</Text>
            <TextInput
              style={styles.input}
              value={newFolderName}
              onChangeText={setNewFolderName}
              placeholder="Folder name"
              placeholderTextColor={colors.muted}
              autoFocus
              onSubmitEditing={handleCreateFolder}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnGhost]} onPress={() => setShowNewFolder(false)}>
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, !newFolderName.trim() && styles.btnDisabled]}
                disabled={!newFolderName.trim()}
                onPress={handleCreateFolder}
              >
                <Text style={styles.modalBtnText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {/* Rename modal */}
      <Modal transparent visible={renameItem !== null} animationType="fade" onRequestClose={() => setRenameItem(null)}>
        <View style={styles.modalBack}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rename</Text>
            <TextInput
              style={styles.input}
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder="New name"
              placeholderTextColor={colors.muted}
              autoFocus
              onSubmitEditing={handleRename}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnGhost]} onPress={() => setRenameItem(null)}>
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, !renameValue.trim() && styles.btnDisabled]}
                disabled={!renameValue.trim()}
                onPress={handleRename}
              >
                <Text style={styles.modalBtnText}>Rename</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  crumbs: {
    flexDirection: "row", alignItems: "center", flexWrap: "wrap",
    gap: 4, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
  },
  crumb: { color: colors.muted, fontSize: font.sm, maxWidth: 160 },
  crumbActive: { color: colors.content, fontWeight: "600" },
  crumbSep: { color: colors.muted, opacity: 0.5 },
  count: { color: colors.muted, fontSize: font.xs },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: 11,
  },
  rowBody: { flex: 1 },
  rowTitle: { color: colors.content, fontSize: font.md, fontWeight: "500" },
  rowSub: { color: colors.muted, fontSize: font.xs, marginTop: 2 },
  centerPad: { paddingVertical: 64 },
  actions: {
    position: "absolute", left: 16, right: 16, bottom: 24,
    flexDirection: "row", justifyContent: "space-around",
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: 10,
  },
  actionBtn: { alignItems: "center", gap: 4, paddingHorizontal: 12 },
  actionText: { color: colors.content, fontSize: font.xs, fontWeight: "600" },
  modalBack: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center", justifyContent: "center", padding: 32,
  },
  modalCard: {
    width: "100%", maxWidth: 360,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md,
  },
  modalTitle: { color: colors.content, fontSize: font.lg, fontWeight: "700" },
  modalSub: { color: colors.muted, fontSize: font.sm, textAlign: "center" },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.card, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: colors.accent, borderRadius: 3 },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14, paddingVertical: 12,
    color: colors.content, fontSize: font.md,
  },
  modalActions: { flexDirection: "row", gap: spacing.md, marginTop: 4 },
  modalBtn: {
    flex: 1, backgroundColor: colors.accent, borderRadius: radius.md,
    paddingVertical: 12, alignItems: "center",
  },
  modalBtnGhost: { backgroundColor: colors.card },
  modalBtnText: { color: "#fff", fontWeight: "700", fontSize: font.sm },
  modalBtnGhostText: { color: colors.content, fontWeight: "600", fontSize: font.sm },
  btnDisabled: { opacity: 0.5 },
});
