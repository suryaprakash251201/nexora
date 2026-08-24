import { useRef, useState, useCallback, useMemo, useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { rootsApi, filesApi, trashApi, recentsApi, homeApi, authApi, favoritesApi, playlistsApi } from "../api/endpoints";
import type { FileItem, User, SearchResult } from "../api/types";
import { useUI } from "../store";
import { clearMediaToken } from "../lib/nativeAudio";
import { usePlayer } from "../store/player";
import { useCreatePlaylist } from "../hooks/usePlaylists";
import { useFavorites } from "../hooks/useFavorites";
import Sidebar, { SidebarView } from "./Sidebar";
import CommandBar from "./CommandBar";
import FileBrowser from "./FileBrowser";
import DetailsDrawer from "./DetailsDrawer";
import ContextMenu, { MenuItem } from "./ContextMenu";
import React, { Suspense } from "react";
import Toaster from "./Toaster";
import PlayerBar from "./PlayerBar";
import { ViewSkeleton } from "./views/ViewSkeleton";
import { FavouritesView, RecentsView, TrashView } from "./views/LibraryViews";
import { DropRootPicker } from "./views/DropRootPicker";
import { ActionModals } from "./views/ActionModals";
import HomePanel from "./HomePanel";
const PreviewModal = React.lazy(() => import("./PreviewModal"));
const Editor = React.lazy(() => import("./Editor"));
const ShareDialog = React.lazy(() => import("./ShareDialog"));
const AdminPanel = React.lazy(() => import("./AdminPanel"));
const SearchView = React.lazy(() => import("./SearchView"));
const SharesPanel = React.lazy(() => import("./SharesPanel"));
const PlaylistsPanel = React.lazy(() => import("./PlaylistsPanel"));
const VideoView = React.lazy(() => import("./VideoView"));
const ImageView = React.lazy(() => import("./ImageView"));
const StorageAnalyticsPanel = React.lazy(() => import("./StorageAnalyticsPanel").then(m => ({ default: m.default })));
const PhotosView = React.lazy(() => import("./PhotosView/index"));
import { TagPicker } from "./TagManager";
import { MobileNav } from "./layout/MobileNav";
import { PlaylistPickerPopover } from "./PlaylistAdder";
import TransfersPanel from "./TransfersPanel";
import { Modal } from "./Modal";
import RootModal from "./RootModal";
import FolderPickerModal from "./FolderPickerModal";
import ProfileMenu from "./ProfileMenu";
import CommandPalette from "./CommandPalette";
import SelectionBar from "./SelectionBar";
import KeyboardShortcutsModal from "./KeyboardShortcutsModal";
import { Button } from "./ui/Button";
import { isEditable, isAudio } from "../lib/preview";
import {
  Download, Trash2, Pencil, Copy, Eye, FolderOpen, Star, Share2, Archive, FolderInput, FileEdit, ListMusic, Upload, Move, Info, Tag as TagIcon, CheckSquare,
  Home, Search, Clock, Images, BarChart3, Shield
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { WorkspaceHeader } from "./layout/WorkspaceHeader";

// ── Workspace header meta — label + icon per view (matches the sidebar) ──
const VIEW_HEADER_META: Partial<Record<SidebarView, { label: string; icon: LucideIcon }>> = {
  home: { label: "Home", icon: Home },
  search: { label: "Search", icon: Search },
  recents: { label: "Recent", icon: Clock },
  favorites: { label: "Favorites", icon: Star },
  shares: { label: "Shared", icon: Share2 },
  playlists: { label: "Playlists", icon: ListMusic },
  trash: { label: "Trash", icon: Trash2 },
  photos: { label: "Photos", icon: Images },
  analytics: { label: "Analytics", icon: BarChart3 },
  admin: { label: "Admin", icon: Shield },
};

// Hooks
import { useTransfers } from "./hooks/useTransfers";
import { useFileOperations, extractZip } from "./hooks/useFileOperations";
import { useDragAndDrop } from "./hooks/useDragAndDrop";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useClipboard } from "./hooks/useClipboard";
import { useModals } from "./hooks/useModals";
import DesktopDragDrop from "./DesktopDragDrop";
import { isTauri, isLocalServer, revealInFileManager } from "../lib/desktop";
import { IMAGE_EXTS } from "@nexora/core";

export default function Workspace({ user }: { user: User }) {
  const qc = useQueryClient();
  const selection = useUI((s) => s.selection);
  const toggleSelect = useUI((s) => s.toggleSelect);
  const selectMode = useUI((s) => s.selectMode);
  const clearSelection = useUI((s) => s.clearSelection);
  const toggleSelectMode = useUI((s) => s.toggleSelectMode);
  const openDrawer = useUI((s) => s.openDrawer);
  const drawerPath = useUI((s) => s.drawerPath);
  const pushToast = useUI((s) => s.pushToast);
  const viewMode = useUI((s) => s.viewMode);
  const setViewMode = useUI((s) => s.setViewMode);
  const density = useUI((s) => s.density);

  const isAdmin = user.role === "admin";
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  let view: SidebarView = "home";
  let rootId: string | null = null;
  let path = "";

  const pathname = location.pathname;
  if (pathname.startsWith("/files/")) {
    view = "files";
    const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (parts.length > 1) rootId = parts[1];
    if (parts.length > 2) path = parts.slice(2).join("/");
  } else if (pathname === "/search") view = "search";
  else if (pathname === "/trash") view = "trash";
  else if (pathname === "/shares") view = "shares";
  else if (pathname === "/favorites") view = "favorites";
  else if (pathname === "/recents") view = "recents";
  else if (pathname === "/playlists") view = "playlists";
  else if (pathname === "/analytics") view = "analytics";
  else if (pathname === "/photos") view = "photos";
  else if (pathname.startsWith("/admin")) view = "admin";
  
  const roots = useQuery({
    queryKey: ["roots"],
    queryFn: () => rootsApi.list(),
    staleTime: 30_000,
  });
  const pendingFilesView = useRef(false);

  useEffect(() => {
    if (pendingFilesView.current && roots.data?.roots?.[0]) {
      pendingFilesView.current = false;
      navigate(`/files/${roots.data.roots[0].id}`);
    }
  }, [roots.data]);

  // ── Search ↔ URL sync ─────────────────────────────────────────────
  const qParam = useMemo(() => new URLSearchParams(location.search).get("q") ?? "", [location.search]);

  const setView = useCallback((v: SidebarView, rId?: string) => {
    const targetRootId = rId ?? rootId ?? roots.data?.roots[0]?.id;
    React.startTransition(() => {
      if (v === "home") navigate("/");
      else if (v === "files") {
        if (targetRootId) {
          navigate(`/files/${targetRootId}`);
        } else {
          pendingFilesView.current = true;
        }
      }
      else if (v === "analytics") navigate("/analytics");
      else if (v === "search") navigate("/search");
      else if (v === "trash") navigate("/trash");
      else if (v === "shares") navigate("/shares");
      else if (v === "favorites") navigate("/favorites");
      else if (v === "recents") navigate("/recents");
      else if (v === "playlists") navigate("/playlists");
      else if (v === "photos") navigate("/photos");
      else if (v === "admin") navigate("/admin");
    });
  }, [navigate, rootId, roots.data?.roots]);

  const setRootId = useCallback((id: string | null) => {
    React.startTransition(() => {
      if (id) navigate(`/files/${id}`);
    });
  }, [navigate]);

  const setPath = useCallback((p: string) => {
    if (rootId) {
      React.startTransition(() => {
        if (p) navigate(`/files/${rootId}/${p}`);
        else navigate(`/files/${rootId}`);
      });
    }
  }, [rootId, navigate]);
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("q") ?? "");

  // The active search term lives in ?q= so searches survive reloads, work
  // with browser back/forward, and can be shared as links.
  useEffect(() => {
    if (view !== "search") return;
    if ((search || "") !== qParam) {
      navigate(`/search${search ? `?q=${encodeURIComponent(search)}` : ""}`, { replace: true });
    }
  }, [search, view, qParam, navigate]);
  // Back/forward: pull the previous term back into state.
  useEffect(() => {
    setSearch((cur) => (cur !== qParam ? qParam : cur));
  }, [qParam]);

  // ── Workspace header scroll awareness ──────────────────────────────
  // Capture-phase listener catches every scroller in the workspace
  // (main content pane AND views with internal scroll like Home).
  // State flips only when the threshold is crossed → no render spam.
  const [contentScrolled, setContentScrolled] = useState(false);
  useEffect(() => {
    const onScrollCapture = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const down = t.scrollTop > 8;
      setContentScrolled((prev) => (prev === down ? prev : down));
    };
    window.addEventListener("scroll", onScrollCapture, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", onScrollCapture, { capture: true });
  }, []);
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("name");
  const [order, setOrder] = useState("asc");

  // ---- Per-folder view memory (like Finder/Explorer) ------------------------
  // Remembers sort/order/filter/density/viewMode per root+path and restores
  // them on navigation. Global setters stay the source of truth; localStorage
  // is just a side-channel keyed by folder.
  const folderKey = `${rootId ?? ""}|${path}`;
  const loadedFolderKey = useRef<string | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`nexora-fv:${folderKey}`);
      if (raw) {
        const v = JSON.parse(raw);
        if (typeof v.sort === "string") setSort(v.sort);
        if (typeof v.order === "string") setOrder(v.order);
        if (typeof v.filter === "string") setFilter(v.filter);
        if (v.density) useUI.getState().setDensity(v.density);
        if (v.viewMode) useUI.getState().setViewMode(v.viewMode);
      }
    } catch { /* ignore malformed entries */ }
    loadedFolderKey.current = folderKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderKey]);

  useEffect(() => {
    // Don't persist until we've (re)loaded for this folder — avoids writing
    // the previous folder's state onto the new key during transitions.
    if (loadedFolderKey.current !== folderKey) return;
    try {
      localStorage.setItem(
        `nexora-fv:${folderKey}`,
        JSON.stringify({ sort, order, filter, density, viewMode })
      );
    } catch { /* storage full/blocked — non-fatal */ }
  }, [folderKey, sort, order, filter, density, viewMode]);

  const [fileOffset, setFileOffset] = useState(0);
  const [accumulatedItems, setAccumulatedItems] = useState<FileItem[]>([]);
  const [hasMoreFiles, setHasMoreFiles] = useState(false);

  useEffect(() => {
    setFileOffset(0);
    setHasMoreFiles(false);
    // Note: no explicit refetch here — the query key already includes
    // (rootId, path, sort, order), so the browser automatically fetches the
    // new folder. keepPreviousData keeps the previous listing visible until
    // the new one lands (no skeleton flash), and a 30s staleTime makes
    // back-navigation serve from cache instantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootId, path, sort, order]);
  const modals = useModals();
  const { preview, setPreview, imageItem, setImageItem, videoItem, setVideoItem, setPrevView, editItem, setEditItem, shareItem, setShareItem, ctx, setCtx, ctxPlaylist, setCtxPlaylist, menu, setMenu, rootModal, setRootModal, playlistModal, setPlaylistModal, playlistName, setPlaylistName, commandPaletteOpen, setCommandPaletteOpen, tagPicker, setTagPicker } = modals;
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const activeRoot = roots.data?.roots.find((r) => r.id === rootId) || null;
  const canWrite = !!activeRoot && activeRoot.permission === "write" && !activeRoot.read_only;

  const files = useQuery({
    queryKey: ["files", rootId, path, sort, order, fileOffset],
    queryFn: () => filesApi.list({ root: rootId!, path, sort, order, offset: String(fileOffset) }),
    enabled: view === "files" && !!rootId,
    placeholderData: keepPreviousData,
    // Keep visited folders in cache so back-navigation is instant; refresh()
    // and mutations invalidate explicitly when the listing actually changes.
    staleTime: 30_000,
  });

  useEffect(() => {
    if (files.data) {
      const data = files.data;
      setHasMoreFiles(!!data.has_more);
      if (fileOffset === 0) {
        setAccumulatedItems(data.items || []);
      } else {
        setAccumulatedItems(prev => [...prev, ...(data.items || [])]);
      }
    }
  }, [files.data, fileOffset]);

  const items = accumulatedItems;
  const trash = useQuery({ queryKey: ["trash"], queryFn: () => trashApi.list(), enabled: view === "trash" });
  // Unified favorites query — single source of truth for /favorites.
  // Previously there were two queries both hitting /favorites (favorites + fav-set).
  // Now both list display and star checks share the same ["favorites"] cache; React Query dedupes.
  const favoritesQuery = useFavorites();
  // Keep legacy variable names for minimal diff: favorites for the list view, favSet for star checks.
  // Both point to the same underlying query so there is only one network request.
  const favorites = favoritesQuery;
  const favSet = favoritesQuery;
  const recents = useQuery({ queryKey: ["recents"], queryFn: () => recentsApi.list(), enabled: view === "recents" });
  const home = useQuery({ queryKey: ["home"], queryFn: () => homeApi.get(), enabled: view === "home", staleTime: 30_000 });
  
  const filtered = useMemo(() => {
    let f = items;
    if (filter !== "all") {
      if (filter === "folders") f = f.filter((i) => i.is_dir);
      else if (filter === "documents") f = f.filter((i) => !i.is_dir && (i.mime.startsWith("text/") || ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "pages", "numbers", "key", "md", "txt", "rtf"].includes((i.extension || "").toLowerCase())));
      else if (filter === "images") f = f.filter((i) => i.mime.startsWith("image/"));
      else if (filter === "videos") f = f.filter((i) => i.mime.startsWith("video/"));
      else if (filter === "audio") f = f.filter((i) => i.mime.startsWith("audio/"));
      else if (filter === "archives") f = f.filter((i) => ["zip", "tar", "gz", "7z", "rar", "iso"].includes((i.extension || "").toLowerCase()));
    }
    
    if (search) {
      const s = search.toLowerCase();
      f = f.filter((i) => (i.name || "").toLowerCase().includes(s));
    }
    return f;
  }, [items, filter, search]);
  
  const imageList = useMemo(() => filtered.filter((i) => (i.mime || "").startsWith("image/") || IMAGE_EXTS.has((i.extension || "").toLowerCase())), [filtered]);

  const createPlaylistMutation = useCreatePlaylist();

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["files", rootId, path, sort, order, fileOffset] });
    qc.invalidateQueries({ queryKey: ["trash"] });
    qc.invalidateQueries({ queryKey: ["roots"] });
    qc.invalidateQueries({ queryKey: ["favorites"] });
  }, [qc, rootId, path, sort, order, fileOffset]);

  // Warm the target view's data while the pointer hovers a nav item, so a
  // click swaps views with data already in the cache (no spinner / skeleton).
  const prefetchView = useCallback((v: SidebarView) => {
    // Prefetch the lazy chunk so first click paints instantly (data is
    // prefetched below; this covers the JS bundle).
    const chunkLoaders: Partial<Record<SidebarView, () => Promise<unknown>>> = {
      admin: () => import("./AdminPanel"),
      search: () => import("./SearchView"),
      shares: () => import("./SharesPanel"),
      playlists: () => import("./PlaylistsPanel"),
      analytics: () => import("./StorageAnalyticsPanel"),
      photos: () => import("./PhotosView/index"),
    };
    void chunkLoaders[v]?.().catch(() => {});

    if (v === "home") {
      qc.prefetchQuery({ queryKey: ["home"], queryFn: () => homeApi.get(), staleTime: 30_000 });
      qc.prefetchQuery({ queryKey: ["home-usage"], queryFn: () => homeApi.usage(), staleTime: 60_000 });
    } else if (v === "trash") {
      qc.prefetchQuery({ queryKey: ["trash"], queryFn: () => trashApi.list() });
    } else if (v === "favorites") {
      qc.prefetchQuery({ queryKey: ["favorites"], queryFn: () => favoritesApi.list() });
    } else if (v === "recents") {
      qc.prefetchQuery({ queryKey: ["recents"], queryFn: () => recentsApi.list() });
    } else if (v === "playlists") {
      qc.prefetchQuery({ queryKey: ["playlists"], queryFn: () => playlistsApi.list() as any, staleTime: 30_000 });
    }
  }, [qc]);

  // Use custom hooks
  const { uploadFiles, downloadItem } = useTransfers(rootId, path, refresh);
  const { doDelete, bulkDelete, archivePaths, toggleFavorite } = useFileOperations({ rootId, refresh, qc, selection, clearSelection, favSet });
  const { folderPicker, setFolderPicker, openPickerFor, applyFolderPicker, transferPaths, clipboard, copySelection, cutSelection, pasteClipboard, clearClipboard } = useClipboard({ rootId, path, selection, clearSelection, refresh, canWrite });
  const { dragProps, dragActive, dropPicker, setDropPicker, pendingDrop } = useDragAndDrop({ rootId, canWrite, uploadFiles });
  
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const isModalOpen = modals.isModalOpen || !!folderPicker || !!dropPicker || shortcutsModalOpen;
  
  useKeyboardShortcuts({
    canWrite, view, setView, selection, items, bulkDelete, setMenu,
    fileInputRef: fileInput, isModalOpen,
    setCommandPaletteOpen, setShortcutsModalOpen,
    onCopy: copySelection,
    onCut: cutSelection,
    onPaste: () => void pasteClipboard(),
  });

  // Clipboard paste upload: Ctrl/Cmd+V pastes files or screenshots from the
  // OS clipboard into the current folder (files view only).
  useEffect(() => {
    if (!canWrite || view !== "files") return;
    const onPaste = (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      void uploadFiles(files);
      pushToast("success", `Uploading ${files.length} pasted item${files.length === 1 ? "" : "s"}`);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [canWrite, view, uploadFiles, pushToast]);

  const openItem = (item: FileItem) => {
    if (item.is_dir) {
      setPath(path ? `${path}/${item.name}` : item.name);
      clearSelection();
    } else if (item.extension === "zip" && canWrite) {
      setMenu({ kind: "extract", item });
    } else if (isAudio(item)) {
      const audio = items.filter((i) => isAudio(i));
      const idx = audio.findIndex((i) => i.path === item.path);
      usePlayer.getState().play(audio, idx >= 0 ? idx : 0);
    } else if (item.mime.startsWith("image/") || IMAGE_EXTS.has((item.extension || "").toLowerCase())) {
      setImageItem(item);
    } else if (item.mime.startsWith("video/")) {
      setPrevView("files");
      setVideoItem(item);
      setView("video");
    } else {
      setPreview(item);
    }
  };

  const selectedItems = items.filter((i) => selection.has(i.path));
  const lastClickedRef = useRef<string | null>(null);
  const selectRange = useUI((s) => s.selectRange);

  const handleSelect = useCallback((item: FileItem, e: React.MouseEvent | React.ChangeEvent) => {
    if ("shiftKey" in e && e.shiftKey && lastClickedRef.current) {
      const paths = filtered.map((i) => i.path);
      const lastIdx = paths.indexOf(lastClickedRef.current);
      const curIdx = paths.indexOf(item.path);
      if (lastIdx !== -1 && curIdx !== -1) {
        const start = Math.min(lastIdx, curIdx);
        const end = Math.max(lastIdx, curIdx);
        selectRange(filtered.slice(start, end + 1).map((i) => i.path));
        return;
      }
    }
    toggleSelect(item.path);
    lastClickedRef.current = item.path;
  }, [filtered, toggleSelect, selectRange]);

  const allSelected = filtered.length > 0 && filtered.every((i) => selection.has(i.path));

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      clearSelection();
    } else {
      useUI.getState().setSelection(filtered.map((i) => i.path));
    }
  }, [allSelected, filtered, clearSelection]);

  const savePlaylist = async () => {
    const audio = (selectedItems.length ? selectedItems : items).filter((i) => isAudio(i));
    if (!audio.length) { pushToast("error", "No audio files selected"); setPlaylistModal(false); return; }
    try {
      await createPlaylistMutation.mutateAsync({ name: playlistName.trim() || "New playlist", items: audio });
      pushToast("success", "Playlist created");
    } catch (e: any) {
      pushToast("error", e.message || "Failed to create playlist");
    }
    setPlaylistName("");
    setPlaylistModal(false);
  };

  // Selection actions for CommandBar
  const handleSelectionAction = useCallback((action: "move" | "copy" | "delete" | "download" | "share" | "archive" | "favorite" | "tag" | "rename") => {
    if (!selection.size) return;
    const paths = Array.from(selection);
    
    switch (action) {
      case "move":
        openPickerFor("move", paths);
        break;
      case "copy":
        openPickerFor("copy", paths);
        break;
      case "delete":
        bulkDelete();
        break;
      case "download":
        paths.forEach(p => { const it = items.find(i => i.path === p); if (it) downloadItem(it); });
        break;
      case "share":
        // For single item share, open share dialog
        if (paths.length === 1) {
           const it = items.find(i => i.path === paths[0]);
           if (it) setShareItem(it);
        }
        break;
      case "archive":
        archivePaths(paths, "selection");
        break;
      case "favorite":
        paths.forEach(p => { const it = items.find(i => i.path === p); if (it) toggleFavorite(it); });
        break;
      case "rename": {
        const it = items.find(i => i.path === paths[0]);
        if (it && canWrite) setMenu({ kind: "rename", item: it });
        break;
      }
      case "tag":
        if (rootId) setTagPicker({ rootId, paths });
        break;
    }
  }, [selection, items, openPickerFor, bulkDelete, downloadItem, setShareItem, archivePaths, toggleFavorite, rootId, setTagPicker, canWrite, setMenu]);

  const buildMenu = (item: FileItem, x: number, y: number): MenuItem[] => {
    const menuItems: MenuItem[] = [
      { label: item.is_dir ? "Open" : "Preview", icon: item.is_dir ? <FolderOpen className="h-4 w-4" /> : <Eye className="h-4 w-4" />, onClick: () => openItem(item) },
      { label: "Download", icon: <Download className="h-4 w-4" />, onClick: () => downloadItem(item) },
      { label: "Share", icon: <Share2 className="h-4 w-4" />, onClick: () => setShareItem(item) },
      { label: "Add to favorites", icon: <Star className="h-4 w-4" />, onClick: () => toggleFavorite(item) },
    ];
    if (!item.is_dir && isAudio(item)) {
      const targets = selectedItems.length ? selectedItems : [item];
      menuItems.push({
        label: selectedItems.length ? `Add ${selectedItems.length} to playlist` : "Add to playlist",
        icon: <ListMusic className="h-4 w-4" />,
        onClick: () => setCtxPlaylist({ x, y, items: targets }),
      });
    }
    if (!item.is_dir) {
      menuItems.push({ label: "Archive (ZIP)", icon: <Archive className="h-4 w-4" />, onClick: () => archivePaths([item.path], item.name) });
    } else {
      menuItems.push({ label: "Download as ZIP", icon: <Archive className="h-4 w-4" />, onClick: () => archivePaths([item.path], item.name) });
    }
    if (canWrite) {
      if (!item.is_dir && isEditable(item)) {
        menuItems.push({ label: "Edit", icon: <FileEdit className="h-4 w-4" />, onClick: () => setEditItem(item) });
      }
      if (!item.is_dir && item.extension === "zip") {
        menuItems.push({ label: "Extract here", icon: <FolderInput className="h-4 w-4" />, onClick: () => setMenu({ kind: "extract", item }) });
      }
      menuItems.push(
        { label: "Rename", icon: <Pencil className="h-4 w-4" />, onClick: () => setMenu({ kind: "rename", item }) },
        { label: "Tags...", icon: <TagIcon className="h-4 w-4" />, onClick: () => setTagPicker({ rootId: activeRoot!.id, paths: [item.path] }) },
        { label: "Move", icon: <Move className="h-4 w-4" />, onClick: () => openPickerFor("move", [item.path]) },
        { label: "Copy", icon: <Copy className="h-4 w-4" />, onClick: () => openPickerFor("copy", [item.path]) },
        { label: "Delete", icon: <Trash2 className="h-4 w-4" />, danger: true, onClick: () => doDelete(item.path) },
      );
    }
    menuItems.push(
      { label: "Select", icon: <CheckSquare className="h-4 w-4" />, onClick: () => { toggleSelect(item.path); useUI.getState().setSelectMode(true); } },
      { label: "Properties", icon: <Info className="h-4 w-4" />, onClick: () => openDrawer(item.path) },
    );
    // Desktop-only: open the file's folder in the OS file manager.
    if (isTauri() && isLocalServer() && activeRoot?.type === "local" && activeRoot.path) {
      const parentDir = item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/")) : "";
      const abs = parentDir ? `${activeRoot.path}/${parentDir}` : activeRoot.path;
      menuItems.push({
        label: item.is_dir ? "Reveal in folder" : "Reveal in file manager",
        icon: <FolderOpen className="h-4 w-4" />,
        onClick: () => revealInFileManager(abs),
      });
    }
    return menuItems;
  };

  const onContextMenu = (e: React.MouseEvent, item: FileItem) => {
    e.preventDefault();
    setCtx({ x: e.clientX, y: e.clientY, item });
  };

  const logout = async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
    localStorage.removeItem("nexora-token");
    // Also drop the desktop media bearer so no long-lived credential survives logout.
    clearMediaToken();
    window.location.reload();
  };

  const navigateTo = async (rid: string, p: string, isDir: boolean, name: string) => {
    const parent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    const targetPath = isDir ? p : parent;
    React.startTransition(() => {
      navigate(targetPath ? `/files/${rid}/${targetPath}` : `/files/${rid}`);
    });
    clearSelection();
    if (!isDir) {
      try {
        const info = await filesApi.stat(rid, p);
        // If stat reveals it's a directory, navigate into it
        if (info.is_dir) {
          React.startTransition(() => {
            navigate(p ? `/files/${rid}/${p}` : `/files/${rid}`);
          });
          return;
        }
        if (info.mime?.startsWith("image/") || IMAGE_EXTS.has((info.extension || "").toLowerCase())) {
          setImageItem(info);
        } else if (info.mime?.startsWith("video/")) {
          setVideoItem(info);
          setPrevView("files");
          setView("video");
        } else {
          // Set immediately — React batches this with the transition, and a
          // magic 50ms delay just raced fast successive clicks.
          setPreview(info);
        }
      } catch {
        const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
        setPreview({ name, path: p, size: 0, is_dir: false, modified: "", mime: "", root_id: rid, extension: ext } as FileItem);
      }
    }
  };

  const showCommandBar = view === "files" && activeRoot;

  // Desktop-only: absolute server-side path to reveal in the OS file manager.
  const revealPath =
    isTauri() && isLocalServer() && activeRoot?.type === "local" && activeRoot.path && drawerPath
      ? drawerPath.includes("/")
        ? `${activeRoot.path}/${drawerPath.slice(0, drawerPath.lastIndexOf("/"))}`
        : activeRoot.path
      : null;

  return (
    <div className="h-screen flex overflow-hidden" {...dragProps}>
      {isTauri() && (
        <DesktopDragDrop rootId={rootId} path={path} canWrite={canWrite} onUpload={(files) => uploadFiles(files)} />
      )}
      <Sidebar
        roots={roots.data?.roots || []}
        activeRoot={rootId}
        view={view}
        isAdmin={isAdmin}
        collapsed={sidebarCollapsed}
        canWrite={canWrite}
        onDropToActiveRoot={(paths) => {
          if (!canWrite || !rootId) return;
          void transferPaths(paths, "", 'move');
        }}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        onSelectRoot={(id) => { setRootId(id); clearSelection(); }}
        onSelectView={(v) => { setView(v); clearSelection(); }}
        onHoverView={prefetchView}
        onNewRoot={() => isAdmin && setRootModal(true)}
        onLogout={logout}
      />

      <div className="flex-1 flex flex-col min-w-0 pb-24 md:pb-0">
        {showCommandBar && (
          <CommandBar
            rootName={activeRoot!.name}
            path={path}
            onNavigate={(p) => { setPath(p); clearSelection(); }}
            search={search}
            setSearch={setSearch}
            filter={filter}
            setFilter={setFilter}
            sort={sort}
            setSort={setSort}
            order={order}
            setOrder={setOrder}
            canWrite={canWrite}
            onNewFolder={() => setMenu({ kind: "newFolder" })}
            onNewFile={() => setMenu({ kind: "newFile" })}
            onUpload={() => fileInput.current?.click()}
            onUploadFolder={() => folderInput.current?.click()}
            onRefresh={refresh}
            isFetching={files.isFetching}
            user={user}
            isAdmin={isAdmin}
            onLogout={logout}
            onAdmin={() => setView("admin")}
            onDropToFolder={(p, paths) => {
              if (!canWrite) return;
              const src = paths && paths.length > 0 ? paths : Array.from(selection);
              if (src.length === 0) return;
              void transferPaths(src, p, 'move');
            }}
            onUploadFiles={(files, p) => {
              if (!canWrite) return;
              void uploadFiles(files, rootId ?? undefined, p);
            }}
            clipboard={clipboard}
            onCancelClipboard={clearClipboard}
          />
        )}
        {view !== "files" && !videoItem && (
          <WorkspaceHeader
            title={VIEW_HEADER_META[view]?.label ?? view.charAt(0).toUpperCase() + view.slice(1)}
            icon={VIEW_HEADER_META[view]?.icon}
            scrolled={contentScrolled}
            actions={
              <ProfileMenu user={user} isAdmin={isAdmin} onLogout={logout} onAdmin={() => setView("admin")} />
            }
          />
        )}

        <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }} />
        <input ref={folderInput} type="file" {...{ webkitdirectory: "", directory: "" }} multiple className="hidden" onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }} />

        {(selectMode || selection.size > 0) && (
          <SelectionBar
            allSelected={allSelected}
            selectedCount={selection.size}
            totalCount={filtered.length}
            onToggleSelectAll={toggleSelectAll}
            onAction={handleSelectionAction}
            onClear={() => { clearSelection(); useUI.getState().setSelectMode(false); }}
          />
        )}

        <motion.main
          key={view}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
          className="flex-1 overflow-auto flex flex-col hide-scrollbar"
        >
            <Suspense fallback={<ViewSkeleton />}>
            {view === "files" && (
              <FileBrowser
                items={filtered}
                loading={files.isLoading}
                isFetching={files.isFetching && fileOffset === 0}
                viewMode={viewMode}
                selection={selection}
                selectMode={selectMode}
                canWrite={canWrite}
                onOpen={openItem}
                onSelect={handleSelect}
                onContextMenu={onContextMenu}
                onDropItem={(folder, paths) => {
                  // Drop directly onto the folder that was dropped on —
                  // no second "pick a destination" round-trip. `paths` is the
                  // drag payload (selection-aware from FileBrowser).
                  void transferPaths(paths ?? Array.from(selection), folder.path, 'move');
                }}
                onUploadToPath={(files, p) => {
                  if (!canWrite) return;
                  void uploadFiles(files, rootId ?? undefined, p);
                }}
                onUpload={() => fileInput.current?.click()}
                onUploadFolder={() => folderInput.current?.click()}
                hasMore={hasMoreFiles}
                onLoadMore={() => setFileOffset(prev => prev + (files.data?.limit || 500))}
                isLoadingMore={files.isFetching && fileOffset > 0}
                error={files.error as Error | null}
                onRetry={() => { setFileOffset(0); files.refetch(); }}
                density={density}
                folderPath={path}
              />
            )}
            {view === "trash" && <TrashView items={trash.data?.items || []} loading={trash.isLoading} onRestore={async (id) => { await trashApi.restore(id); refresh(); }} onDelete={async (id) => { await trashApi.delete(id); refresh(); }} selection={selection} selectMode={selectMode} onSelect={(id) => toggleSelect(id)} />}
            {view === "favorites" && <FavouritesView
              loading={favorites.isLoading}
              items={(favorites.data?.items || []).map((f) => ({
                id: f.root_id + f.path,
                name: f.name,
                root_name: f.root_name,
                path: f.path,
                root_id: f.root_id,
                date: f.created_at,
                extension: f.name.includes(".") ? f.name.slice(f.name.lastIndexOf(".") + 1).toLowerCase() : "",
              }))}
              onOpen={(item) => navigateTo(item.root_id, item.path, false, item.name)}
            />}
            {view === "recents" && <RecentsView
              loading={recents.isLoading}
              items={(recents.data?.items || []).map((f) => ({
                id: f.root_id + f.path,
                name: f.name,
                root_name: f.root_name,
                path: f.path,
                root_id: f.root_id,
                date: f.accessed_at,
                extension: f.name.includes(".") ? f.name.slice(f.name.lastIndexOf(".") + 1).toLowerCase() : "",
              }))}
              onOpen={(item) => navigateTo(item.root_id, item.path, false, item.name)}
            />}
            {view === "home" && (
              <HomePanel
                  user={user}
                  data={home.data}
                  isLoading={home.isLoading}
                  isAdmin={isAdmin}
                  onSearch={(q) => { setSearch(q); setView("search"); }}
                  onOpenRecent={(item) => navigateTo(item.root_id, item.path, false, item.name)}
                  onUpload={() => fileInput.current?.click()}
                  onUploadFolder={() => folderInput.current?.click()}
                  onNewFolder={() => setMenu({ kind: "newFolder" })}
                  onNewFile={() => setMenu({ kind: "newFile" })}
                  onNewRoot={() => isAdmin && setRootModal(true)}
                  onOpenPlaylist={() => setView("playlists")}
                />
            )}
            {view === "shares" && <SharesPanel />}
            {view === "playlists" && <PlaylistsPanel user={user} />}
            {view === "admin" && (
              isAdmin ? <AdminPanel /> : (
                <div className="flex flex-1 items-center justify-center p-8 text-center">
                  <div>
                    <h2 className="text-lg font-semibold">Administrator access required</h2>
                    <p className="mt-2 text-sm text-content-muted">Your account does not have access to this area.</p>
                  </div>
                </div>
              )
            )}
            {view === "analytics" && (
              <Suspense fallback={<ViewSkeleton />}>
                <StorageAnalyticsPanel
                  roots={roots.data?.roots || []}
                  onNavigateToFile={(rid, p) => navigateTo(rid, p, false, "")}
                />
              </Suspense>
            )}
            {view === "photos" && (
              <Suspense fallback={<ViewSkeleton />}>
                <PhotosView
                  roots={roots.data?.roots || []}
                  onOpen={(rid, p) => navigateTo(rid, p, false, "")}
                  onPreview={(rid, p) => {
                    filesApi.stat(rid, p).then((info) => {
                      if (info.mime?.startsWith("image/") || IMAGE_EXTS.has((info.extension || "").toLowerCase())) {
                        setImageItem(info);
                      } else {
                        setPreview(info);
                      }
                    }).catch(() => {});
                  }}
                />
              </Suspense>
            )}
            {view === "search" && (
              <SearchView
                initialQuery={search}
                roots={roots.data?.roots || []}
                onOpen={(r: SearchResult) => navigateTo(r.root_id, r.path, r.is_dir, r.name)}
                selection={selection}
                selectMode={selectMode}
                onSelect={(id) => toggleSelect(id)}
              />
            )}
            </Suspense>
          </motion.main>

        <PlayerBar />
      </div>

      <MobileNav 
        view={view}
        roots={roots.data?.roots || []}
        activeRoot={rootId}
        canWrite={canWrite}
        isAdmin={isAdmin}
        onSelectView={(v) => { setView(v); clearSelection(); }}
        onSelectRoot={(id) => { setRootId(id); clearSelection(); }}
        onSearch={() => setCommandPaletteOpen(true)}
        onUpload={() => fileInput.current?.click()}
        onUploadFolder={() => folderInput.current?.click()}
        onNewFolder={() => setMenu({ kind: "newFolder" })}
        onLogout={logout}
      />
      <TransfersPanel />

      {view === "files" && activeRoot && drawerPath && (
        <DetailsDrawer
          rootName={activeRoot.name}
          rootId={rootId!}
          path={drawerPath}
          canWrite={canWrite}
          userId={user?.id}
          isAdmin={isAdmin}
          revealPath={revealPath}
          isFavorite={favoritesQuery.isFavorite ? favoritesQuery.isFavorite(rootId!, drawerPath) : !!favSet.data?.items.some((f) => f.root_id === rootId && f.path === drawerPath)}
          onClose={() => openDrawer(null)}
          onDownload={() => { const it = items.find((i) => i.path === drawerPath); if (it) downloadItem(it); }}
          onPreview={() => { const it = items.find((i) => i.path === drawerPath); if (it) setPreview(it); }}
          onRename={() => { const it = items.find((i) => i.path === drawerPath); if (it) setMenu({ kind: "rename", item: it }); }}
          onDelete={() => { const it = items.find((i) => i.path === drawerPath); if (it) doDelete(it.path); }}
          onMove={() => { const it = items.find((i) => i.path === drawerPath); if (it) openPickerFor("move", [it.path]); }}
          onCopy={() => { const it = items.find((i) => i.path === drawerPath); if (it) openPickerFor("copy", [it.path]); }}
          onShare={() => { const it = items.find((i) => i.path === drawerPath); if (it) setShareItem(it); }}
          onFavorite={() => { const it = items.find((i) => i.path === drawerPath); if (it) toggleFavorite(it); }}
          onEdit={() => { const it = items.find((i) => i.path === drawerPath); if (it) setEditItem(it); }}
        />
      )}

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={buildMenu(ctx.item, ctx.x, ctx.y)} onClose={() => setCtx(null)} />}
      {ctxPlaylist && <PlaylistPickerPopover x={ctxPlaylist.x} y={ctxPlaylist.y} items={ctxPlaylist.items} onClose={() => setCtxPlaylist(null)} />}
      <Suspense fallback={null}>
        {videoItem && <VideoView item={videoItem} rootId={videoItem.root_id || rootId!} onClose={() => setVideoItem(null)} />}
        {imageItem && <ImageView item={imageItem} images={imageList} rootId={imageItem.root_id || rootId!} onClose={() => setImageItem(null)} />}
      </Suspense>
      {menu && <ActionModals menu={menu} rootId={rootId!} path={path} onClose={() => setMenu(null)} onDone={() => { refresh(); setMenu(null); }} onArchiveExtract={(src, dest) => { extractZip(rootId!, src, dest, pushToast, refresh); setMenu(null); }} />}
      
      {folderPicker && rootId && (
        <FolderPickerModal
          rootId={rootId}
          currentPath={path}
          mode={folderPicker.mode}
          onClose={() => setFolderPicker(null)}
          onConfirm={applyFolderPicker}
        />
      )}

      {dropPicker && (
        <DropRootPicker
          roots={roots.data?.roots || []}
          pending={pendingDrop}
          onClose={() => { setDropPicker(false); pendingDrop.current = null; }}
          onConfirm={(rid, destPath) => {
            const files = pendingDrop.current;
            pendingDrop.current = null;
            setDropPicker(false);
            if (files) uploadFiles(files, rid, destPath);
          }}
        />
      )}

      {dragActive && (
          <div className="fixed inset-0 z-[var(--z-veil)] grid place-items-center bg-black/70 dark:bg-black/70 backdrop-blur-sm pointer-events-none">
            <div className="glass-strong rounded-2xl px-8 py-10 text-center">
              <Upload className="h-12 w-12 mx-auto mb-3 text-accent" />
              <p className="text-lg font-semibold">Drop to upload</p>
              <p className="text-sm text-content-muted">{rootId && canWrite ? `Into ${activeRoot?.name} / ${path || "root"}` : "Choose a storage location"}</p>
            </div>
          </div>
      )}

      {playlistModal && (
        <Modal title="Save playlist" onClose={() => setPlaylistModal(false)} footer={<Button variant="primary" size="sm" onClick={savePlaylist}>Create</Button>}>
          <label className="block text-sm mb-1 opacity-80">Playlist name</label>
          <input
            value={playlistName}
            onChange={(e) => setPlaylistName(e.target.value)}
            autoFocus
            placeholder="My playlist"
            className="glass-input w-full rounded-xl px-3 py-2 outline-none"
          />
          <p className="mt-2 text-xs opacity-60">
            {(selectedItems.length ? selectedItems : items).filter((i) => typeof i.mime === "string" && i.mime.startsWith("audio/")).length} audio track(s) will be added.
          </p>
        </Modal>
      )}
      <Suspense fallback={null}>
        <AnimatePresence>
          {preview && <PreviewModal item={preview} rootId={rootId!} canWrite={canWrite} onClose={() => setPreview(null)} onEdit={(it) => setEditItem(it)} onShare={(it) => setShareItem(it)} />}
          {editItem && <Editor item={editItem} rootId={rootId!} onSaved={refresh} onClose={() => { setEditItem(null); refresh(); }} />}
          {shareItem && <ShareDialog item={shareItem} rootId={rootId!} onClose={() => setShareItem(null)} />}
          {rootModal && <RootModal root={rootModal === true ? null : rootModal} onClose={() => setRootModal(false)} onDone={() => { setRootModal(false); refresh(); }} />}
          {tagPicker && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setTagPicker(null)}>
              <TagPicker
                rootId={tagPicker.rootId}
                paths={tagPicker.paths}
                existingTags={tagPicker.paths.length === 1 ? items.find(i => i.path === tagPicker.paths[0])?.tags : undefined}
                onClose={() => setTagPicker(null)}
              />
            </div>
          )}
        </AnimatePresence>
      </Suspense>
      <Toaster />
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        user={user}
        isAdmin={isAdmin}
        view={view}
        setView={setView}
        rootId={rootId}
        path={path}
        canWrite={canWrite}
        selection={selection}
        items={items}
        activeRoot={activeRoot}
        onNewFolder={() => setMenu({ kind: "newFolder" })}
        onNewFile={() => setMenu({ kind: "newFile" })}
        onUpload={() => fileInput.current?.click()}
        onUploadFolder={() => folderInput.current?.click()}
        onRefresh={refresh}
        onLogout={logout}
        onAdmin={() => setView("admin")}
        clearSelection={clearSelection}
        toggleSelectMode={toggleSelectMode}
        selectMode={selectMode}
        viewMode={viewMode}
        setViewMode={setViewMode}
        sort={sort}
        setSort={setSort}
        order={order}
        setOrder={setOrder}
        onOpenPath={(rid, p, isDir) => navigateTo(rid, p, isDir, "")}
        onDownload={() => handleSelectionAction("download")}
        onShare={() => handleSelectionAction("share")}
        onFavorite={() => handleSelectionAction("favorite")}
        onRename={() => handleSelectionAction("rename")}
        onMove={() => handleSelectionAction("move")}
        onCopy={() => handleSelectionAction("copy")}
        onArchive={() => handleSelectionAction("archive")}
        onDelete={() => bulkDelete()}
      />
      <KeyboardShortcutsModal
        isOpen={shortcutsModalOpen}
        onClose={() => setShortcutsModalOpen(false)}
      />
    </div>
  );
}
