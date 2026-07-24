import { useRef, useState, useCallback, useMemo, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, del } from "../api/client";
import type { FileItem, Root, TrashItem, User, FavoriteItem, RecentItem, SearchResult, HomeData } from "../api/types";
import { useUI } from "../store";
import { usePlayer } from "../store/player";
import { usePlaylists } from "../store/playlists";
import Sidebar, { SidebarView } from "./Sidebar";
import CommandBar from "./CommandBar";
import FileBrowser from "./FileBrowser";
import DetailsDrawer from "./DetailsDrawer";
import ContextMenu, { MenuItem } from "./ContextMenu";
import React, { Suspense } from "react";
import Toaster from "./Toaster";
import PlayerBar from "./PlayerBar";
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
import { TagPicker } from "./TagManager";
import { MobileNav } from "./layout/MobileNav";
import { PlaylistPickerPopover } from "./PlaylistAdder";
import TransfersPanel from "./TransfersPanel";
import { Modal } from "./Modal";
import RootModal from "./RootModal";
import FolderPickerModal from "./FolderPickerModal";
import ProfileMenu from "./ProfileMenu";
import CommandPalette from "./CommandPalette";
import KeyboardShortcutsModal from "./KeyboardShortcutsModal";
import SelectionBar from "./SelectionBar";
import { formatDate } from "../lib/format";
import { SkeletonList } from "./ui/Skeleton";
import { isEditable } from "../lib/preview";
import {
  Download, Trash2, Pencil, Copy, Eye, FolderOpen, RotateCcw,
  Star, Share2, Archive, FolderInput, FileEdit, ListMusic, HardDrive, Upload,
  Move, Info, Tag as TagIcon
} from "lucide-react";

// Hooks
import { useTransfers } from "./hooks/useTransfers";
import { useFileOperations, extractZip } from "./hooks/useFileOperations";
import { useDragAndDrop } from "./hooks/useDragAndDrop";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useClipboard } from "./hooks/useClipboard";
import { useModals } from "./hooks/useModals";

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
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length > 1) rootId = parts[1];
    if (parts.length > 2) path = parts.slice(2).join("/");
  } else if (pathname === "/search") view = "search";
  else if (pathname === "/trash") view = "trash";
  else if (pathname === "/shares") view = "shares";
  else if (pathname === "/favorites") view = "favorites";
  else if (pathname === "/recents") view = "recents";
  else if (pathname === "/playlists") view = "playlists";
  else if (pathname.startsWith("/admin")) view = "admin";
  
  const setView = useCallback((v: SidebarView, rId?: string) => {
    React.startTransition(() => {
      if (v === "home") navigate("/");
      else if (v === "files" && rId) navigate(`/files/${rId}`);
      else if (v === "search") navigate("/search");
      else if (v === "trash") navigate("/trash");
      else if (v === "shares") navigate("/shares");
      else if (v === "favorites") navigate("/favorites");
      else if (v === "recents") navigate("/recents");
      else if (v === "playlists") navigate("/playlists");
      else if (v === "admin") navigate("/admin");
    });
  }, [navigate]);

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
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("name");
  const [order, setOrder] = useState("asc");
  const modals = useModals();
  const { preview, setPreview, imageItem, setImageItem, videoItem, setVideoItem, setPrevView, editItem, setEditItem, shareItem, setShareItem, ctx, setCtx, ctxPlaylist, setCtxPlaylist, menu, setMenu, rootModal, setRootModal, playlistModal, setPlaylistModal, playlistName, setPlaylistName, commandPaletteOpen, setCommandPaletteOpen, tagPicker, setTagPicker } = modals;
  const fileInput = useRef<HTMLInputElement>(null);

  const roots = useQuery({ queryKey: ["roots"], queryFn: () => get<{ roots: Root[] }>("/roots") });
  const activeRoot = roots.data?.roots.find((r) => r.id === rootId) || null;
  const canWrite = !!activeRoot && activeRoot.permission === "write" && !activeRoot.read_only;

  const files = useQuery({
    queryKey: ["files", rootId, path, sort, order],
    queryFn: () => get<{ items: FileItem[] }>("/files", { root: rootId!, path, sort, order }),
    enabled: view === "files" && !!rootId,
  });
  const trash = useQuery({ queryKey: ["trash"], queryFn: () => get<{ items: TrashItem[] }>("/trash"), enabled: view === "trash" });
  const favorites = useQuery({ queryKey: ["favorites"], queryFn: () => get<{ items: FavoriteItem[] }>("/favorites"), enabled: view === "favorites" });
  const recents = useQuery({ queryKey: ["recents"], queryFn: () => get<{ items: RecentItem[] }>("/recents"), enabled: view === "recents" });
  const home = useQuery({ queryKey: ["home"], queryFn: () => get<HomeData>("/home"), enabled: view === "home" });
  const favSet = useQuery({ queryKey: ["fav-set"], queryFn: () => get<{ items: FavoriteItem[] }>("/favorites") });

  const items = files.data?.items || [];
  
  const [filtered, setFiltered] = useState<FileItem[]>([]);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    workerRef.current = new Worker(new URL('../workers/filter.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current.onmessage = (e) => setFiltered(e.data);
    return () => workerRef.current?.terminate();
  }, []);

  useEffect(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({ items, filter, search });
    }
  }, [items, filter, search]);
  
  const imageList = useMemo(() => filtered.filter((i) => i.mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"].includes(i.extension.toLowerCase())), [filtered]);

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["files", rootId, path] });
    qc.invalidateQueries({ queryKey: ["trash"] });
    qc.invalidateQueries({ queryKey: ["roots"] });
    qc.invalidateQueries({ queryKey: ["favorites"] });
    qc.invalidateQueries({ queryKey: ["fav-set"] });
  }, [qc, rootId, path]);

  // Use custom hooks
  const { uploadFiles, downloadItem } = useTransfers(rootId, path, refresh);
  const { doDelete, bulkDelete, archivePaths, toggleFavorite } = useFileOperations({ rootId, refresh, qc, selection, clearSelection, favSet });
  const { folderPicker, setFolderPicker, moveSelectionTo, openPickerFor, applyFolderPicker } = useClipboard({ rootId, selection, clearSelection, refresh, canWrite });
  const { dragProps, dragActive, dropPicker, setDropPicker, pendingDrop } = useDragAndDrop({ rootId, canWrite, uploadFiles });
  
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const isModalOpen = modals.isModalOpen || !!folderPicker || !!dropPicker || shortcutsModalOpen;
  
  useKeyboardShortcuts({
    canWrite, view, setView, selection, items, bulkDelete, setMenu,
    fileInputRef: fileInput, isModalOpen,
    setCommandPaletteOpen, setShortcutsModalOpen
  });

  const openItem = (item: FileItem) => {
    if (item.is_dir) {
      setPath(path ? `${path}/${item.name}` : item.name);
      clearSelection();
    } else if (item.extension === "zip" && canWrite) {
      setMenu({ kind: "extract", item });
    } else if (item.mime.startsWith("audio/")) {
      const audio = items.filter((i) => i.mime.startsWith("audio/"));
      const idx = audio.findIndex((i) => i.path === item.path);
      usePlayer.getState().play(audio, idx >= 0 ? idx : 0);
    } else if (item.mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"].includes(item.extension.toLowerCase())) {
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

  const savePlaylist = () => {
    const audio = (selectedItems.length ? selectedItems : items).filter((i) => i.mime.startsWith("audio/"));
    if (!audio.length) { pushToast("error", "No audio files selected"); setPlaylistModal(false); return; }
    usePlaylists.getState().create(playlistName.trim() || `Playlist ${usePlaylists.getState().playlists.length + 1}`, audio);
    setPlaylistName("");
    setPlaylistModal(false);
    pushToast("success", "Playlist created");
  };

  // Selection actions for CommandBar
  const handleSelectionAction = useCallback((action: "move" | "copy" | "delete" | "download" | "share" | "archive" | "favorite" | "tag") => {
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
      case "tag":
        if (rootId) setTagPicker({ rootId, paths });
        break;
    }
  }, [selection, items, openPickerFor, bulkDelete, downloadItem, setShareItem, archivePaths, toggleFavorite, rootId, setTagPicker]);

  const handleExitSelection = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  const buildMenu = (item: FileItem, x: number, y: number): MenuItem[] => {
    const menuItems: MenuItem[] = [
      { label: item.is_dir ? "Open" : "Preview", icon: item.is_dir ? <FolderOpen className="h-4 w-4" /> : <Eye className="h-4 w-4" />, onClick: () => openItem(item) },
      { label: "Download", icon: <Download className="h-4 w-4" />, onClick: () => downloadItem(item) },
      { label: "Share", icon: <Share2 className="h-4 w-4" />, onClick: () => setShareItem(item) },
      { label: "Add to favorites", icon: <Star className="h-4 w-4" />, onClick: () => toggleFavorite(item) },
    ];
    if (!item.is_dir && item.mime.startsWith("audio/")) {
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
    menuItems.push({ label: "Properties", icon: <Info className="h-4 w-4" />, onClick: () => openDrawer(item.path) });
    return menuItems;
  };

  const onContextMenu = (e: React.MouseEvent, item: FileItem) => {
    e.preventDefault();
    setCtx({ x: e.clientX, y: e.clientY, item });
  };

  const logout = async () => {
    try { await post("/auth/logout"); } catch { /* ignore */ }
    qc.setQueryData(["session"], { user: null });
    qc.removeQueries({ queryKey: ["session"] });
  };

  const navigateTo = async (rid: string, p: string, isDir: boolean, name: string) => {
    setRootId(rid);
    const parent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    setPath(isDir ? p : parent);
    setView("files");
    clearSelection();
    if (!isDir) {
      try {
        const info = await get<FileItem>("/files/stat", { root: rid, path: p });
        if (info.mime?.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"].includes((info.extension || "").toLowerCase())) {
          setImageItem(info);
        } else if (info.mime?.startsWith("video/")) {
          setVideoItem(info);
          setPrevView("files");
          setView("video");
        } else {
          setTimeout(() => setPreview(info), 50);
        }
      } catch {
        const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
        setTimeout(() => setPreview({ name, path: p, size: 0, is_dir: false, modified: "", mime: "", root_id: rid, extension: ext } as FileItem), 50);
      }
    }
  };

  const showCommandBar = view === "files" && activeRoot;

  return (
    <div className="h-screen flex overflow-hidden" {...dragProps}>
      <Sidebar
        roots={roots.data?.roots || []}
        activeRoot={rootId}
        view={view}
        isAdmin={isAdmin}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        onSelectRoot={(id) => { setRootId(id); setPath(""); setView("files"); clearSelection(); }}
        onSelectView={(v) => { setView(v); clearSelection(); }}
        onNewRoot={() => isAdmin && setRootModal(true)}
        onLogout={logout}
      />

      <div className="flex-1 flex flex-col min-w-0">
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
            selectionCount={selection.size}
            onNewFolder={() => setMenu({ kind: "newFolder" })}
            onNewFile={() => setMenu({ kind: "newFile" })}
            onUpload={() => fileInput.current?.click()}
            onRefresh={refresh}
            onSelectionAction={handleSelectionAction}
            onExitSelection={handleExitSelection}
            user={user}
            isAdmin={isAdmin}
            onLogout={logout}
            onAdmin={() => setView("admin")}
          />
        )}
        {view !== "files" && view !== "home" && !videoItem && (
          <div className="h-14 glass-bar flex items-center justify-between px-4">
            <span className="font-semibold capitalize">{view}</span>
            <ProfileMenu user={user} isAdmin={isAdmin} onLogout={logout} onAdmin={() => setView("admin")} />
          </div>
        )}

        <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }} />

        <AnimatePresence mode="wait">
          <motion.div
            key={view + (videoItem ? videoItem.path : "")}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
            className="flex-1 overflow-auto flex flex-col"
          >
            <Suspense fallback={<div className="flex-1 grid place-items-center text-content-muted">Loading...</div>}>
            {view === "files" && (
              <FileBrowser
                items={filtered}
                loading={files.isLoading}
                viewMode={viewMode}
                selection={selection}
                selectMode={selectMode}
                canWrite={canWrite}
                onOpen={openItem}
                 onSelect={handleSelect}

                onContextMenu={onContextMenu}
                onDropItem={(folder) => moveSelectionTo()}
              />
            )}
            {view === "trash" && <TrashView items={trash.data?.items || []} loading={trash.isLoading} onRestore={async (id) => { await post("/trash/restore", { id }); refresh(); }} onDelete={async (id) => { await del("/trash", { id }); refresh(); }} selection={selection} selectMode={selectMode} onSelect={(id) => toggleSelect(id)} />}
            {view === "favorites" && <SimpleList loading={favorites.isLoading} empty="No favorites yet. Star files to find them here." selection={selection} selectMode={selectMode} onSelect={(id) => toggleSelect(id)} rows={(favorites.data?.items || []).map((f) => ({ id: f.root_id + f.path, title: f.name, sub: `${f.root_name} / ${f.path}`, onClick: () => navigateTo(f.root_id, f.path, false, f.name) }))} />}
            {view === "recents" && <SimpleList loading={recents.isLoading} empty="No recent files yet." selection={selection} selectMode={selectMode} onSelect={(id) => toggleSelect(id)} rows={(recents.data?.items || []).map((f) => ({ id: f.root_id + f.path, title: f.name, sub: `${f.root_name} / ${f.path}`, meta: formatDate(f.accessed_at), onClick: () => navigateTo(f.root_id, f.path, false, f.name) }))} />}
            {view === "home" && (
              <>
                <div className="h-14 glass-bar flex items-center justify-between px-4">
                  <span className="font-semibold">Home</span>
                  <ProfileMenu user={user} isAdmin={isAdmin} onLogout={logout} onAdmin={() => setView("admin")} />
                </div>
                <HomePanel
                  data={home.data}
                  isLoading={home.isLoading}
                  isAdmin={isAdmin}
                  onSearch={(q) => { setSearch(q); setView("search"); }}
                  onOpenRecent={(item) => navigateTo(item.root_id, item.path, false, item.name)}
                  onUpload={() => fileInput.current?.click()}
                  onNewFolder={() => setMenu({ kind: "newFolder" })}
                  onNewFile={() => setMenu({ kind: "newFile" })}
                  onNewRoot={() => isAdmin && setRootModal(true)}
                  onOpenPlaylist={() => setView("playlists")}
                />
              </>
            )}
            {view === "shares" && <SharesPanel />}
            {view === "playlists" && <PlaylistsPanel user={user} />}
            {view === "admin" && isAdmin && <AdminPanel />}
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
          </motion.div>
        </AnimatePresence>

        {!videoItem && (
          <SelectionBar
            count={selection.size}
            onDownload={() => handleSelectionAction("download")}
            onMove={() => handleSelectionAction("move")}
            onCopy={() => handleSelectionAction("copy")}
            onDelete={() => handleSelectionAction("delete")}
            onShare={() => handleSelectionAction("share")}
            onArchive={() => handleSelectionAction("archive")}
            onFavorite={() => handleSelectionAction("favorite")}
            onClear={clearSelection}
          />
        )}

        <PlayerBar />
      </div>

      <MobileNav 
        view={view} 
        onSelectView={(v) => { setView(v); clearSelection(); }} 
      />
      <TransfersPanel />

      {view === "files" && activeRoot && drawerPath && (
        <DetailsDrawer
          rootName={activeRoot.name}
          rootId={rootId!}
          path={drawerPath}
          canWrite={canWrite}
          isFavorite={!!favSet.data?.items.some((f) => f.root_id === rootId && f.path === drawerPath)}
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
        {videoItem && <VideoView item={videoItem} rootId={rootId!} onClose={() => setVideoItem(null)} />}
        {imageItem && <ImageView item={imageItem} images={imageList} rootId={rootId!} onClose={() => setImageItem(null)} />}
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
        <div className="fixed inset-0 z-[70] grid place-items-center scrim backdrop-blur-sm pointer-events-none">
          <div className="glass-strong rounded-2xl px-8 py-10 text-center">
            <Upload className="h-12 w-12 mx-auto mb-3 text-accent" />
            <p className="text-lg font-semibold">Drop to upload</p>
            <p className="text-sm text-content-muted">{rootId && canWrite ? `Into ${activeRoot?.name} / ${path || "root"}` : "Choose a storage location"}</p>
          </div>
        </div>
      )}

      {playlistModal && (
        <Modal title="Save playlist" onClose={() => setPlaylistModal(false)} footer={<button onClick={savePlaylist} className="px-3 py-1.5 rounded-lg accent-glass text-sm font-medium">Create</button>}>
          <label className="block text-sm mb-1 opacity-80">Playlist name</label>
          <input
            value={playlistName}
            onChange={(e) => setPlaylistName(e.target.value)}
            autoFocus
            placeholder="My playlist"
            className="w-full rounded-lg glass-input px-3 py-2 outline-none"
          />
          <p className="mt-2 text-xs opacity-60">
            {(selectedItems.length ? selectedItems : items).filter((i) => i.mime.startsWith("audio/")).length} audio track(s) will be added.
          </p>
        </Modal>
      )}
      <Suspense fallback={null}>
        <AnimatePresence>
          {preview && <PreviewModal item={preview} rootId={rootId!} onClose={() => setPreview(null)} />}
          {editItem && <Editor item={editItem} rootId={rootId!} onClose={() => { setEditItem(null); refresh(); }} />}
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
      />
      <KeyboardShortcutsModal
        isOpen={shortcutsModalOpen}
        onClose={() => setShortcutsModalOpen(false)}
      />
    </div>
  );
}

function SimpleList({ loading, empty, rows, selection, selectMode, onSelect }: {
  loading: boolean;
  empty: string;
  rows: { id: string; title: string; sub: string; meta?: string; onClick: () => void }[];
  selection?: Set<string>;
  selectMode?: boolean;
  onSelect?: (id: string) => void;
}) {
  if (loading) return <div className="p-2"><SkeletonList count={5} /></div>;
  if (!rows.length) return <div className="p-10 text-center text-content-muted">{empty}</div>;
  return (
    <div className="p-2">
      {rows.map((r) => {
        const selected = selection?.has(r.id) ?? false;
        return (
          <div key={r.id} className={`relative flex items-center gap-2 rounded-lg transition-colors ${selected ? "bg-accent/10 ring-1 ring-accent/30" : "hover:bg-surface/50"}`}>
            {(selectMode || selection?.size) && onSelect && (
              <label className="pl-3 py-2 flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onSelect(r.id)}
                  className={`w-4 h-4 rounded border-2 border-border/80 bg-surface/80 text-accent focus:ring-accent cursor-pointer transition-all ${selected ? "opacity-100" : "opacity-60 hover:opacity-100"}`}
                />
              </label>
            )}
            <button onClick={r.onClick} className={`flex-1 grid grid-cols-[1fr_auto] gap-2 py-2 pr-3 text-left ${selectMode || selection?.size ? "" : "pl-3"}`}>
              <div className="min-w-0">
                <p className="truncate font-medium">{r.title}</p>
                <p className="text-xs text-content-muted truncate">{r.sub}</p>
              </div>
              {r.meta && <span className="text-xs text-content-muted whitespace-nowrap">{r.meta}</span>}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function DropRootPicker({ roots, pending, onClose, onConfirm }: {
  roots: Root[];
  pending: React.MutableRefObject<FileList | null>;
  onClose: () => void;
  onConfirm: (rootId: string, destPath: string) => void;
}) {
  const [picked, setPicked] = useState<string>("");
  const [destPath, setDestPath] = useState("");
  const writable = roots.filter((r) => r.permission === "write" && !r.read_only);
  const fileCount = pending.current?.length ?? 0;
  const effective = picked || writable[0]?.id || "";
  return (
    <Modal
      title="Upload to…"
      onClose={onClose}
      footer={
        <button
          disabled={!effective}
          onClick={() => onConfirm(effective, destPath.trim())}
          className="px-3 py-1.5 rounded-lg accent-glass text-sm font-medium disabled:opacity-50"
        >
          Upload {fileCount > 0 ? `${fileCount} file${fileCount > 1 ? "s" : ""}` : ""}
        </button>
      }
    >
      <p className="text-sm text-content-muted mb-3">
        {fileCount} file{fileCount !== 1 ? "s" : ""} selected. Choose a storage root and optional subfolder.
      </p>
      <div className="space-y-2 max-h-60 overflow-auto">
        {writable.length === 0 && <p className="text-sm text-content-muted">No writable storage roots available.</p>}
        {writable.map((r) => (
          <button
            key={r.id}
            onClick={() => setPicked(r.id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left border transition ${
              effective === r.id ? "border-accent bg-accent/10" : "border-transparent glass-hover"
            }`}
          >
            <HardDrive className="h-5 w-5 text-accent shrink-0" />
            <div className="min-w-0">
              <p className="font-medium truncate">{r.name}</p>
              <p className="text-xs text-content-muted truncate">{r.path || "root"}</p>
            </div>
          </button>
        ))}
      </div>
      <input
        value={destPath}
        onChange={(e) => setDestPath(e.target.value)}
        placeholder="Subfolder (optional, e.g. photos/2024)"
        className="w-full mt-3 rounded-lg glass-input px-3 py-2 outline-none"
      />
    </Modal>
  );
}

function TrashView({ items, loading, onRestore, onDelete, selection, selectMode, onSelect }: {
  items: TrashItem[]; loading: boolean; onRestore: (id: string) => void; onDelete: (id: string) => void;
  selection?: Set<string>; selectMode?: boolean; onSelect?: (id: string) => void;
}) {
  if (loading) return <div className="p-2"><SkeletonList count={5} /></div>;
  if (!items.length) return <div className="p-10 text-center text-content-muted">Trash is empty.</div>;
  const selectedCount = selection?.size ?? 0;
  return (
    <div>
      {selectedCount > 0 && (
        <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-2 glass-bar border-b border-border/50">
          <span className="text-sm font-medium">{selectedCount} selected</span>
          <div className="flex gap-2 ml-auto">
            <button onClick={() => { items.filter((t) => selection?.has(t.id)).forEach((t) => onRestore(t.id)); }} className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg glass-hover border"><RotateCcw className="h-4 w-4" /> Restore</button>
            <button onClick={() => { items.filter((t) => selection?.has(t.id)).forEach((t) => onDelete(t.id)); }} className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg text-red-500 hover:bg-red-500/10"><Trash2 className="h-4 w-4" /> Delete</button>
          </div>
        </div>
      )}
      <div className="p-2">
        {items.map((t) => {
          const selected = selection?.has(t.id) ?? false;
          return (
            <div key={t.id} className={`flex items-center gap-2 rounded-lg transition-colors ${selected ? "bg-accent/10 ring-1 ring-accent/30" : "hover:bg-surface/50"}`}>
              {onSelect && (
                <label className="pl-3 py-2 flex items-center cursor-pointer">
                  <input type="checkbox" checked={selected} onChange={() => onSelect(t.id)}
                    className="w-4 h-4 rounded border-2 border-border/80 bg-surface/80 text-accent focus:ring-accent cursor-pointer transition-all" />
                </label>
              )}
              <div className="flex-1 grid grid-cols-[1fr_auto_auto] gap-2 py-2 pr-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{t.name}</p>
                  <p className="text-xs text-content-muted truncate">{t.root_name} · {t.original_path}</p>
                </div>
                <button onClick={() => onRestore(t.id)} className="flex items-center gap-1 px-2 py-1 text-sm rounded-lg glass-hover border"><RotateCcw className="h-4 w-4" /> Restore</button>
                <button onClick={() => onDelete(t.id)} className="flex items-center gap-1 px-2 py-1 text-sm rounded-lg text-red-500 hover:bg-red-500/10"><Trash2 className="h-4 w-4" /> Delete</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActionModals({ menu, rootId, path, onClose, onDone, onArchiveExtract }: {
  menu: { kind: string; item?: FileItem };
  rootId: string;
  path: string;
  onClose: () => void;
  onDone: () => void;
  onArchiveExtract: (src: string, dest: string) => void;
}) {
  const [value, setValue] = useState("");
  const [content, setContent] = useState("");
  const pushToast = useUI((s) => s.pushToast);
  const base = (name: string) => (path ? `${path}/${name}` : name);
  const run = async (fn: () => Promise<any>, ok: string) => {
    try { await fn(); pushToast("success", ok); onDone(); } catch (e: any) { pushToast("error", e.message); }
  };

  if (menu.kind === "newFolder") {
    return (
      <Modal title="New folder" onClose={onClose} footer={<button onClick={() => run(() => post("/files/directory", { root: rootId, path: base(value || "New Folder") }), "Folder created")} className="px-3 py-1.5 rounded-lg accent-glass text-sm">Create</button>}>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="Folder name" className="w-full rounded-lg bg-surface border px-3 py-2 outline-none focus:ring-2 focus:ring-accent/40" />
      </Modal>
    );
  }
  if (menu.kind === "newFile") {
    return (
      <Modal title="New text file" onClose={onClose} footer={<button onClick={() => run(() => post("/files/file", { root: rootId, path: base(value || "untitled.txt"), content }), "File created")} className="px-3 py-1.5 rounded-lg accent-glass text-sm">Create</button>}>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="name.txt" className="w-full mb-2 rounded-lg bg-surface border px-3 py-2 outline-none focus:ring-2 focus:ring-accent/40" />
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={6} placeholder="Contents…" className="w-full rounded-lg bg-surface border px-3 py-2 outline-none focus:ring-2 focus:ring-accent/40 font-mono text-sm" />
      </Modal>
    );
  }
  if (menu.kind === "rename" && menu.item) {
    return (
      <Modal title="Rename" onClose={onClose} footer={<button onClick={() => run(() => post("/files/rename", { root: rootId, path: menu.item!.path, name: value }), "Renamed")} className="px-3 py-1.5 rounded-lg accent-glass text-sm">Rename</button>}>
        <input autoFocus defaultValue={menu.item.name} onChange={(e) => setValue(e.target.value)} className="w-full rounded-lg bg-surface border px-3 py-2 outline-none focus:ring-2 focus:ring-accent/40" />
      </Modal>
    );
  }
  if (menu.kind === "extract" && menu.item) {
    const defaultDest = path;
    return (
      <Modal title={`Extract "${menu.item.name}"`} onClose={onClose} footer={<button onClick={() => onArchiveExtract(menu.item!.path, value || defaultDest)} className="px-3 py-1.5 rounded-lg accent-glass text-sm">Extract</button>}>
        <p className="text-sm text-content-muted mb-2">Destination folder (relative path, empty = current):</p>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={defaultDest || "root"} className="w-full rounded-lg bg-surface border px-3 py-2 outline-none focus:ring-2 focus:ring-accent/40" />
        <p className="mt-2 text-xs text-content-muted">Archives are extracted safely with zip-slip protection.</p>
      </Modal>
    );
  }
  return null;
}