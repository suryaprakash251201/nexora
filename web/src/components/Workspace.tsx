import { useRef, useState, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, del, put } from "../api/client";
import type { FileItem, Root, TrashItem, User, FavoriteItem, RecentItem, SearchResult } from "../api/types";
import { useUI } from "../store";
import { usePlayer } from "../store/player";
import { usePlaylists } from "../store/playlists";
import Sidebar, { SidebarView } from "./Sidebar";
import TopBar from "./TopBar";
import FileBrowser from "./FileBrowser";
import DetailsDrawer from "./DetailsDrawer";
import ContextMenu, { MenuItem } from "./ContextMenu";
import PreviewModal from "./PreviewModal";
import Editor from "./Editor";
import ShareDialog from "./ShareDialog";
import SearchView from "./SearchView";
import SharesPanel from "./SharesPanel";
import AdminPanel from "./AdminPanel";
import Toaster from "./Toaster";
import PlayerBar from "./PlayerBar";
import TransfersPanel from "./TransfersPanel";
import { Modal } from "./Modal";
import { formatDate } from "../lib/format";
import { previewKind, isEditable } from "../lib/preview";
import { startUpload, startDownload } from "../lib/transfer";
import {
  Download, Trash2, Pencil, Scissors, Copy, Eye, FolderOpen, RotateCcw, LogOut,
  HardDrive, Star, Share2, Archive, FolderInput, FileEdit, Play, ListMusic,
} from "lucide-react";

export default function Workspace({ user }: { user: User }) {
  const qc = useQueryClient();
  const selection = useUI((s) => s.selection);
  const toggleSelect = useUI((s) => s.toggleSelect);
  const clearSelection = useUI((s) => s.clearSelection);
  const openDrawer = useUI((s) => s.openDrawer);
  const drawerPath = useUI((s) => s.drawerPath);
  const pushToast = useUI((s) => s.pushToast);
  const viewMode = useUI((s) => s.viewMode);

  const isAdmin = user.role === "admin";
  const [view, setView] = useState<SidebarView>("files");
  const [rootId, setRootId] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("name");
  const [order, setOrder] = useState("asc");
  const [preview, setPreview] = useState<FileItem | null>(null);
  const [editItem, setEditItem] = useState<FileItem | null>(null);
  const [shareItem, setShareItem] = useState<FileItem | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; item: FileItem } | null>(null);
  const [menu, setMenu] = useState<{ kind: string; item?: FileItem } | null>(null);
  const [rootModal, setRootModal] = useState(false);
  const [playlistModal, setPlaylistModal] = useState(false);
  const [playlistName, setPlaylistName] = useState("");
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
  const favSet = useQuery({ queryKey: ["fav-set"], queryFn: () => get<{ items: FavoriteItem[] }>("/favorites") });

  const items = files.data?.items || [];
  const filtered = search ? items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase())) : items;
  const audioQueue = items.filter((i) => i.mime.startsWith("audio/"));

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["files", rootId, path] });
    qc.invalidateQueries({ queryKey: ["trash"] });
    qc.invalidateQueries({ queryKey: ["roots"] });
    qc.invalidateQueries({ queryKey: ["favorites"] });
    qc.invalidateQueries({ queryKey: ["fav-set"] });
  }, [qc, rootId, path]);

  const uploadFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList || !fileList.length || !rootId) return;
    startUpload(rootId, path, fileList, () => refresh());
  }, [rootId, path, refresh]);

  const openItem = (item: FileItem) => {
    if (item.is_dir) {
      setPath(path ? `${path}/${item.name}` : item.name);
      clearSelection();
    } else if (item.extension === "zip" && canWrite) {
      setMenu({ kind: "extract", item });
    } else {
      setPreview(item);
    }
  };

  const doDelete = async (p: string) => {
    try { await del("/files", { root: rootId!, path: p }); pushToast("success", "Moved to trash"); refresh(); }
    catch (e: any) { pushToast("error", e.message); }
  };

  const bulkDelete = async () => {
    for (const p of Array.from(selection)) {
      try { await del("/files", { root: rootId!, path: p }); } catch (e: any) { pushToast("error", e.message); }
    }
    clearSelection();
    pushToast("success", "Items moved to trash");
    refresh();
  };

  const downloadItem = (item: FileItem) => {
    if (!item.is_dir) startDownload(item.root_id, item.path, item.name);
  };

  // Play the selected audio files (or the whole folder's audio) as a queue.
  const selectedItems = items.filter((i) => selection.has(i.path));
  const playSelected = () => {
    const audio = (selectedItems.length ? selectedItems : items).filter((i) => i.mime.startsWith("audio/"));
    if (audio.length) usePlayer.getState().play(audio, 0);
  };
  const savePlaylist = () => {
    const audio = (selectedItems.length ? selectedItems : items).filter((i) => i.mime.startsWith("audio/"));
    if (!audio.length) { pushToast("error", "No audio files selected"); setPlaylistModal(false); return; }
    usePlaylists.getState().create(playlistName.trim() || `Playlist ${usePlaylists.getState().playlists.length + 1}`, audio);
    setPlaylistName("");
    setPlaylistModal(false);
    pushToast("success", "Playlist created");
  };

  // Archive selected items (or one) into a ZIP via a background job, then download.
  const archivePaths = async (paths: string[], name: string) => {
    if (!rootId || !paths.length) return;
    try {
      const res = await post<{ job: { id: string } }>("/archive", { root: rootId, paths, name });
      pushToast("info", "Preparing archive…");
      pollArchive(res.job.id);
    } catch (e: any) { pushToast("error", e.message); }
  };

  const pollArchive = (jobId: string) => {
    const es = new EventSource(`/api/v1/jobs/${jobId}/events`);
    const finish = (ok: boolean, msg?: string) => {
      es.close();
      if (ok) { pushToast("success", "Archive ready"); window.open(`/api/v1/jobs/${jobId}/download`, "_blank"); }
      else pushToast("error", msg || "Archive failed");
    };
    es.addEventListener("progress", (ev: MessageEvent) => {
      try {
        const job = JSON.parse(ev.data);
        if (job.status === "done") finish(true);
        else if (job.status === "failed") finish(false, job.error);
      } catch { /* ignore */ }
    });
    es.onerror = () => { es.close(); };
  };

  const toggleFavorite = async (item: FileItem) => {
    const isFav = favSet.data?.items.some((f) => f.root_id === rootId && f.path === item.path);
    try {
      if (isFav) { await del("/favorites", { root: rootId!, path: item.path }); pushToast("success", "Removed from favorites"); }
      else { await post("/favorites", { root: rootId, path: item.path }); pushToast("success", "Added to favorites"); }
      qc.invalidateQueries({ queryKey: ["favorites"] });
      qc.invalidateQueries({ queryKey: ["fav-set"] });
    } catch (e: any) { pushToast("error", e.message); }
  };

  const buildMenu = (item: FileItem): MenuItem[] => {
    const menuItems: MenuItem[] = [
      { label: item.is_dir ? "Open" : "Preview", icon: item.is_dir ? <FolderOpen className="h-4 w-4" /> : <Eye className="h-4 w-4" />, onClick: () => openItem(item) },
      { label: "Download", icon: <Download className="h-4 w-4" />, onClick: () => downloadItem(item) },
      { label: "Share", icon: <Share2 className="h-4 w-4" />, onClick: () => setShareItem(item) },
      { label: "Add to favorites", icon: <Star className="h-4 w-4" />, onClick: () => toggleFavorite(item) },
    ];
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
        { label: "Move", icon: <Scissors className="h-4 w-4" />, onClick: () => setMenu({ kind: "move", item }) },
        { label: "Copy", icon: <Copy className="h-4 w-4" />, onClick: () => setMenu({ kind: "copy", item }) },
        { label: "Delete", icon: <Trash2 className="h-4 w-4" />, danger: true, onClick: () => doDelete(item.path) },
      );
    }
    return menuItems;
  };

  const onContextMenu = (e: React.MouseEvent, item: FileItem) => {
    e.preventDefault();
    setCtx({ x: e.clientX, y: e.clientY, item });
  };

  const logout = async () => {
    try { await post("/auth/logout"); } catch { /* ignore */ }
    qc.removeQueries({ queryKey: ["session"] });
  };

  // Navigate to a search/favorite/recent result.
  const navigateTo = (rid: string, p: string, isDir: boolean, name: string) => {
    setRootId(rid);
    const parent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    setPath(isDir ? p : parent);
    setView("files");
    clearSelection();
    if (!isDir) {
      const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
      setTimeout(() => setPreview({ name, path: p, size: 0, is_dir: false, modified: "", mime: "", root_id: rid, extension: ext } as FileItem), 50);
    }
  };

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      if (typing) return;
      if (preview || editItem || shareItem || menu || rootModal) return;
      if (e.key === "/") { e.preventDefault(); setView("search"); }
      else if (e.key.toLowerCase() === "n" && canWrite && view === "files") { e.preventDefault(); setMenu({ kind: "newFolder" }); }
      else if (e.key.toLowerCase() === "u" && canWrite && view === "files") { e.preventDefault(); fileInput.current?.click(); }
      else if (e.key === "Delete" && selection.size > 0 && canWrite) { e.preventDefault(); bulkDelete(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const showTopBar = view === "files" && activeRoot;

  return (
    <div className="h-screen flex overflow-hidden">
      <Sidebar
        roots={roots.data?.roots || []}
        activeRoot={rootId}
        view={view}
        isAdmin={isAdmin}
        onSelectRoot={(id) => { setRootId(id); setPath(""); setView("files"); clearSelection(); }}
        onSelectView={(v) => { setView(v); clearSelection(); }}
        onNewRoot={() => isAdmin && setRootModal(true)}
        onLogout={logout}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {showTopBar && (
          <TopBar
            rootName={activeRoot!.name}
            path={path}
            onNavigate={(p) => { setPath(p); clearSelection(); }}
            search={search}
            setSearch={setSearch}
            sort={sort}
            setSort={setSort}
            order={order}
            setOrder={setOrder}
            canWrite={canWrite}
            onNewFolder={() => setMenu({ kind: "newFolder" })}
            onNewFile={() => setMenu({ kind: "newFile" })}
            onUpload={() => fileInput.current?.click()}
            onRefresh={refresh}
          />
        )}
        {view !== "files" && (
          <div className="h-14 glass-bar flex items-center px-4 font-semibold capitalize">{view}</div>
        )}

        <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }} />

        <div
          className="flex-1 overflow-auto flex flex-col"
          onDragOver={(e) => view === "files" && e.preventDefault()}
          onDrop={(e) => { if (view === "files") { e.preventDefault(); uploadFiles(e.dataTransfer.files); } }}
        >
          {view === "files" && (
            <FileBrowser
              items={filtered}
              loading={files.isLoading}
              viewMode={viewMode}
              selection={selection}
              canWrite={canWrite}
              onOpen={openItem}
              onSelect={(it) => { toggleSelect(it.path); openDrawer(it.path); }}
              onContextMenu={onContextMenu}
            />
          )}
          {view === "trash" && (
            <TrashView items={trash.data?.items || []} loading={trash.isLoading} onRestore={async (id) => { await post("/trash/restore", { id }); refresh(); }} onDelete={async (id) => { await del("/trash", { id }); refresh(); }} />
          )}
          {view === "favorites" && (
            <SimpleList
              loading={favorites.isLoading}
              empty="No favorites yet. Star files to find them here."
              rows={(favorites.data?.items || []).map((f) => ({ id: f.root_id + f.path, title: f.name, sub: `${f.root_name} / ${f.path}`, onClick: () => navigateTo(f.root_id, f.path, false, f.name) }))}
            />
          )}
          {view === "recents" && (
            <SimpleList
              loading={recents.isLoading}
              empty="No recent files yet."
              rows={(recents.data?.items || []).map((f) => ({ id: f.root_id + f.path, title: f.name, sub: `${f.root_name} / ${f.path}`, meta: formatDate(f.accessed_at), onClick: () => navigateTo(f.root_id, f.path, false, f.name) }))}
            />
          )}
          {view === "shares" && <SharesPanel />}
          {view === "admin" && isAdmin && <AdminPanel />}
          {view === "search" && (
            <SearchView
              initialQuery={search}
              roots={roots.data?.roots || []}
              onOpen={(r: SearchResult) => navigateTo(r.root_id, r.path, r.is_dir, r.name)}
            />
          )}
        </div>

        {selection.size > 0 && view === "files" && (
          <div className="glass-bottom px-4 py-2 flex items-center gap-3 text-sm">
            <span className="text-content-muted">{selection.size} selected</span>
            <button onClick={playSelected} className="flex items-center gap-1 hover:underline"><Play className="h-4 w-4" /> Play</button>
            <button onClick={() => setPlaylistModal(true)} className="flex items-center gap-1 hover:underline"><ListMusic className="h-4 w-4" /> Save playlist</button>
            <button onClick={() => archivePaths(Array.from(selection), "selection")} className="flex items-center gap-1 hover:underline"><Archive className="h-4 w-4" /> Archive</button>
            {canWrite && <button onClick={bulkDelete} className="flex items-center gap-1 text-red-500 hover:underline"><Trash2 className="h-4 w-4" /> Delete</button>}
            <button onClick={clearSelection} className="text-content-muted hover:underline">Clear</button>
          </div>
        )}

        <div className="glass-bottom px-4 py-2 flex items-center justify-between text-sm text-content-muted">
          <span>{view === "files" ? `${filtered.length} items` : ""}</span>
          <button onClick={logout} className="flex items-center gap-1 hover:text-content"><LogOut className="h-4 w-4" /> {user.username}</button>
        </div>

        <PlayerBar />
      </div>

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
          onMove={() => { const it = items.find((i) => i.path === drawerPath); if (it) setMenu({ kind: "move", item: it }); }}
          onCopy={() => { const it = items.find((i) => i.path === drawerPath); if (it) setMenu({ kind: "copy", item: it }); }}
          onShare={() => { const it = items.find((i) => i.path === drawerPath); if (it) setShareItem(it); }}
          onFavorite={() => { const it = items.find((i) => i.path === drawerPath); if (it) toggleFavorite(it); }}
          onEdit={() => { const it = items.find((i) => i.path === drawerPath); if (it) setEditItem(it); }}
        />
      )}

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={buildMenu(ctx.item)} onClose={() => setCtx(null)} />}
      {preview && (
        <PreviewModal
          item={preview}
          rootId={rootId!}
          playlist={previewKind(preview) === "audio" ? audioQueue : undefined}
          canWrite={canWrite}
          onClose={() => setPreview(null)}
          onEdit={(it) => { setPreview(null); setEditItem(it); }}
          onShare={(it) => { setShareItem(it); }}
        />
      )}
      {editItem && <Editor item={editItem} rootId={rootId!} onClose={() => { setEditItem(null); refresh(); }} />}
      {shareItem && <ShareDialog item={shareItem} rootId={rootId!} onClose={() => setShareItem(null)} />}
      {menu && <ActionModals menu={menu} rootId={rootId!} path={path} onClose={() => setMenu(null)} onDone={() => { refresh(); setMenu(null); }} onArchiveExtract={(src, dest) => { extractZip(rootId!, src, dest, pushToast, refresh); setMenu(null); }} />}
      {rootModal && <RootModal onClose={() => setRootModal(false)} onDone={() => { refresh(); setRootModal(false); }} />}

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
      <Toaster />
    </div>
  );
}

async function extractZip(rootId: string, src: string, dest: string, pushToast: (k: any, m: string) => void, refresh: () => void) {
  try {
    await post("/extract", { root: rootId, path: src, destination: dest });
    pushToast("info", "Extracting archive…");
    setTimeout(refresh, 1500);
  } catch (e: any) { pushToast("error", e.message); }
}

function SimpleList({ loading, empty, rows }: { loading: boolean; empty: string; rows: { id: string; title: string; sub: string; meta?: string; onClick: () => void }[] }) {
  if (loading) return <div className="p-8 text-content-muted">Loading…</div>;
  if (!rows.length) return <div className="p-10 text-center text-content-muted">{empty}</div>;
  return (
    <div className="p-2">
      {rows.map((r) => (
        <button key={r.id} onClick={r.onClick} className="w-full grid grid-cols-[1fr_auto] gap-2 px-3 py-2 rounded-lg items-center glass-hover text-left">
          <div className="min-w-0">
            <p className="truncate font-medium">{r.title}</p>
            <p className="text-xs text-content-muted truncate">{r.sub}</p>
          </div>
          {r.meta && <span className="text-xs text-content-muted whitespace-nowrap">{r.meta}</span>}
        </button>
      ))}
    </div>
  );
}

function TrashView({ items, loading, onRestore, onDelete }: {
  items: TrashItem[]; loading: boolean; onRestore: (id: string) => void; onDelete: (id: string) => void;
}) {
  if (loading) return <div className="p-8 text-content-muted">Loading…</div>;
  if (!items.length) return <div className="p-10 text-center text-content-muted">Trash is empty.</div>;
  return (
    <div className="p-2">
      {items.map((t) => (
           <div key={t.id} className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 rounded-lg items-center glass-hover">
           <div className="min-w-0">
             <p className="truncate font-medium">{t.name}</p>
             <p className="text-xs text-content-muted truncate">{t.root_name} · {t.original_path}</p>
           </div>
           <button onClick={() => onRestore(t.id)} className="flex items-center gap-1 px-2 py-1 text-sm rounded-lg glass-hover border"><RotateCcw className="h-4 w-4" /> Restore</button>
          <button onClick={() => onDelete(t.id)} className="flex items-center gap-1 px-2 py-1 text-sm rounded-lg text-red-500 hover:bg-red-500/10"><Trash2 className="h-4 w-4" /> Delete</button>
        </div>
      ))}
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
  if ((menu.kind === "move" || menu.kind === "copy") && menu.item) {
    const isMove = menu.kind === "move";
    return (
      <Modal title={isMove ? "Move to" : "Copy to"} onClose={onClose} footer={<button onClick={() => run(() => post(`/files/${isMove ? "move" : "copy"}`, { root: rootId, source: menu.item!.path, destination: (value ? value + "/" : "") + menu.item!.name }), isMove ? "Moved" : "Copied")} className="px-3 py-1.5 rounded-lg accent-glass text-sm">{isMove ? "Move" : "Copy"}</button>}>
        <p className="text-sm text-content-muted mb-2">Destination folder (relative path, empty = root):</p>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. docs" className="w-full rounded-lg bg-surface border px-3 py-2 outline-none focus:ring-2 focus:ring-accent/40" />
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

function RootModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [p, setP] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const pushToast = useUI((s) => s.pushToast);
  const run = async () => {
    try { await post("/admin/roots", { name, path: p, read_only: readOnly, indexed: true }); pushToast("success", "Storage root created"); onDone(); }
    catch (e: any) { pushToast("error", e.message); }
  };
  return (
    <Modal title="New storage root" onClose={onClose} footer={<button onClick={run} className="px-3 py-1.5 rounded-lg accent-glass text-sm">Create</button>}>
      <label className="block text-sm mb-1">Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} className="w-full mb-3 rounded-lg bg-surface border px-3 py-2 outline-none" placeholder="Backups" />
      <label className="block text-sm mb-1">Host path</label>
      <input value={p} onChange={(e) => setP(e.target.value)} className="w-full mb-3 rounded-lg bg-surface border px-3 py-2 outline-none font-mono" placeholder="/mnt/backups" />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /> Read-only</label>
      <p className="mt-2 text-xs text-content-muted flex items-center gap-1"><HardDrive className="h-3 w-3" /> The directory must exist on the host / mounted volume.</p>
    </Modal>
  );
}
