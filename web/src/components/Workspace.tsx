import { useRef, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  get, post, del, upload as uploadFile,
} from "../api/client";
import type { FileItem, Root, TrashItem, User } from "../api/types";
import { useUI } from "../store";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import FileBrowser from "./FileBrowser";
import DetailsDrawer from "./DetailsDrawer";
import ContextMenu, { MenuItem } from "./ContextMenu";
import PreviewModal from "./PreviewModal";
import Toaster from "./Toaster";
import Modal from "./Modal";import { Download, Trash2, Pencil, Scissors, Copy, Eye, FolderOpen, RotateCcw, LogOut, HardDrive } from "lucide-react";

type View = "files" | "trash";

export default function Workspace({ user }: { user: User }) {
  const qc = useQueryClient();
  const selection = useUI((s) => s.selection);
  const toggleSelect = useUI((s) => s.toggleSelect);
  const clearSelection = useUI((s) => s.clearSelection);
  const openDrawer = useUI((s) => s.openDrawer);
  const drawerPath = useUI((s) => s.drawerPath);
  const pushToast = useUI((s) => s.pushToast);
  const viewMode = useUI((s) => s.viewMode);

  const [view, setView] = useState<View>("files");
  const [rootId, setRootId] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("name");
  const [order, setOrder] = useState("asc");
  const [preview, setPreview] = useState<FileItem | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; item: FileItem } | null>(null);
  const [menu, setMenu] = useState<{ kind: string; item?: FileItem } | null>(null);
  const [rootModal, setRootModal] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const roots = useQuery({ queryKey: ["roots"], queryFn: () => get<{ roots: Root[] }>("/roots") });
  const activeRoot = roots.data?.roots.find((r) => r.id === rootId) || null;
  const canWrite = !!activeRoot && activeRoot.permission === "write" && !activeRoot.read_only;

  // Default to first root once loaded.
  if (!rootId && roots.data?.roots?.length) {
    setRootId(roots.data.roots[0].id);
  }

  const files = useQuery({
    queryKey: ["files", rootId, path, sort, order],
    queryFn: () => get<{ items: FileItem[] }>("/files", { root: rootId!, path, sort, order }),
    enabled: view === "files" && !!rootId,
  });

  const trash = useQuery({
    queryKey: ["trash"],
    queryFn: () => get<{ items: TrashItem[] }>("/trash"),
    enabled: view === "trash",
  });

  const items = files.data?.items || [];
  const filtered = search
    ? items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()))
    : items;

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["files", rootId, path] });
    qc.invalidateQueries({ queryKey: ["trash"] });
    qc.invalidateQueries({ queryKey: ["roots"] });
  }, [qc, rootId, path]);

  const uploadFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || !fileList.length || !rootId) return;
      const form = new FormData();
      for (const f of Array.from(fileList)) form.append("files", f);
      try {
        await uploadFile(`/files/upload?root=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`, form);
        pushToast("success", `Uploaded ${fileList.length} file(s)`);
        refresh();
      } catch (e: any) {
        pushToast("error", e.message || "Upload failed");
      }
    },
    [rootId, path, refresh, pushToast]
  );

  const openItem = (item: FileItem) => {
    if (item.is_dir) {
      setPath(path ? `${path}/${item.name}` : item.name);
      clearSelection();
    } else {
      setPreview(item);
    }
  };

  const doDelete = async (p: string) => {
    try {
      await del("/files", { root: rootId!, path: p });
      pushToast("success", "Moved to trash");
      refresh();
    } catch (e: any) {
      pushToast("error", e.message);
    }
  };

  const bulkDelete = async () => {
    for (const p of Array.from(selection)) {
      try {
        await del("/files", { root: rootId!, path: p });
      } catch (e: any) {
        pushToast("error", e.message);
      }
    }
    clearSelection();
    pushToast("success", "Items moved to trash");
    refresh();
  };

  const downloadItem = (item: FileItem) => {
    window.open(`/api/v1/files/download?root=${encodeURIComponent(rootId!)}&path=${encodeURIComponent(item.path)}`, "_blank");
  };

  const buildMenu = (item: FileItem): MenuItem[] => {
    const items: MenuItem[] = [
      { label: item.is_dir ? "Open" : "Preview", icon: item.is_dir ? <FolderOpen className="h-4 w-4" /> : <Eye className="h-4 w-4" />, onClick: () => openItem(item) },
      { label: "Download", icon: <Download className="h-4 w-4" />, onClick: () => downloadItem(item) },
    ];
    if (canWrite) {
      items.push(
        { label: "Rename", icon: <Pencil className="h-4 w-4" />, onClick: () => setMenu({ kind: "rename", item }) },
        { label: "Move", icon: <Scissors className="h-4 w-4" />, onClick: () => setMenu({ kind: "move", item }) },
        { label: "Copy", icon: <Copy className="h-4 w-4" />, onClick: () => setMenu({ kind: "copy", item }) },
        { label: "Delete", icon: <Trash2 className="h-4 w-4" />, danger: true, onClick: () => doDelete(item.path) }
      );
    }
    return items;
  };

  const onContextMenu = (e: React.MouseEvent, item: FileItem) => {
    e.preventDefault();
    setCtx({ x: e.clientX, y: e.clientY, item });
  };

  const logout = async () => {
    await post("/auth/logout");
    qc.invalidateQueries();
  };

  return (
    <div className="h-screen flex overflow-hidden">
      <Sidebar
        roots={roots.data?.roots || []}
        activeRoot={rootId}
        view={view}
        onSelectRoot={(id) => { setRootId(id); setPath(""); setView("files"); clearSelection(); }}
        onSelectTrash={() => { setView("trash"); clearSelection(); }}
        onNewRoot={() => user.role === "admin" && setRootModal(true)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {view === "files" && activeRoot && (
          <TopBar
            rootName={activeRoot.name}
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
        {view === "trash" && (
          <div className="h-14 border-b flex items-center px-4 font-semibold">
            <Trash2 className="h-4 w-4 mr-2" /> Trash
          </div>
        )}

        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }}
        />

        <div
          className="flex-1 overflow-auto"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (view === "files") uploadFiles(e.dataTransfer.files); }}
        >
          {view === "files" ? (
            <FileBrowser
              items={filtered}
              loading={files.isLoading}
              viewMode={viewMode}
              selection={selection}
              canWrite={canWrite}
              onOpen={openItem}
              onToggleSelect={(it) => { toggleSelect(it.path); openDrawer(it.path); }}
              onContextMenu={onContextMenu}
            />
          ) : (
            <TrashView items={trash.data?.items || []} loading={trash.isLoading} onRestore={async (id) => { await post("/trash/restore", { id }); refresh(); }} onDelete={async (id) => { await del("/trash", { id }); refresh(); }} />
          )}
        </div>

        {selection.size > 0 && view === "files" && (
          <div className="border-t px-4 py-2 flex items-center gap-3 text-sm">
            <span className="text-content-muted">{selection.size} selected</span>
            <button onClick={bulkDelete} className="flex items-center gap-1 text-red-500 hover:underline"><Trash2 className="h-4 w-4" /> Delete</button>
            <button onClick={clearSelection} className="text-content-muted hover:underline">Clear</button>
          </div>
        )}

        <div className="border-t px-4 py-2 flex items-center justify-between text-sm text-content-muted">
          <span>{view === "files" ? `${filtered.length} items` : `${trash.data?.items.length || 0} trashed`}</span>
          <button onClick={logout} className="flex items-center gap-1 hover:text-content"><LogOut className="h-4 w-4" /> {user.username}</button>
        </div>
      </div>

      {view === "files" && activeRoot && (
        <DetailsDrawer
          rootName={activeRoot.name}
          rootId={rootId!}
          path={drawerPath || ""}
          canWrite={canWrite}
          onClose={() => openDrawer(null)}
          onDownload={() => { const it = items.find((i) => i.path === drawerPath); if (it) downloadItem(it); }}
          onPreview={() => { const it = items.find((i) => i.path === drawerPath); if (it) setPreview(it); }}
          onRename={() => { const it = items.find((i) => i.path === drawerPath); if (it) setMenu({ kind: "rename", item: it }); }}
          onDelete={() => { const it = items.find((i) => i.path === drawerPath); if (it) doDelete(it.path); }}
          onMove={() => { const it = items.find((i) => i.path === drawerPath); if (it) setMenu({ kind: "move", item: it }); }}
          onCopy={() => { const it = items.find((i) => i.path === drawerPath); if (it) setMenu({ kind: "copy", item: it }); }}
        />
      )}

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={buildMenu(ctx.item)} onClose={() => setCtx(null)} />}
      {preview && <PreviewModal item={preview} rootId={rootId!} onClose={() => setPreview(null)} />}
      {menu && <ActionModals menu={menu} rootId={rootId!} path={path} onClose={() => setMenu(null)} onDone={() => { refresh(); setMenu(null); }} />}
      {rootModal && <RootModal onClose={() => setRootModal(false)} onDone={() => { refresh(); setRootModal(false); }} />}
      <Toaster />
    </div>
  );
}

function TrashView({ items, loading, onRestore, onDelete }: {
  items: TrashItem[];
  loading: boolean;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (loading) return <div className="p-8 text-content-muted">Loading…</div>;
  if (!items.length) return <div className="p-10 text-center text-content-muted">Trash is empty.</div>;
  return (
    <div className="p-2">
      {items.map((t) => (
        <div key={t.id} className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 rounded-lg items-center hover:bg-surface-muted">
          <div className="min-w-0">
            <p className="truncate font-medium">{t.name}</p>
            <p className="text-xs text-content-muted truncate">{t.root_name} · {t.original_path}</p>
          </div>
          <button onClick={() => onRestore(t.id)} className="flex items-center gap-1 px-2 py-1 text-sm rounded-lg hover:bg-surface border"><RotateCcw className="h-4 w-4" /> Restore</button>
          <button onClick={() => onDelete(t.id)} className="flex items-center gap-1 px-2 py-1 text-sm rounded-lg text-red-500 hover:bg-red-500/10"><Trash2 className="h-4 w-4" /> Delete</button>
        </div>
      ))}
    </div>
  );
}

function ActionModals({ menu, rootId, path, onClose, onDone }: {
  menu: { kind: string; item?: FileItem };
  rootId: string;
  path: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  const [content, setContent] = useState("");
  const pushToast = useUI((s) => s.pushToast);

  const base = (name: string) => (path ? `${path}/${name}` : name);

  const run = async (fn: () => Promise<any>, ok: string) => {
    try {
      await fn();
      pushToast("success", ok);
      onDone();
    } catch (e: any) {
      pushToast("error", e.message);
    }
  };

  if (menu.kind === "newFolder") {
    return (
      <Modal title="New folder" onClose={onClose} footer={<button onClick={() => run(() => post("/files/directory", { root: rootId, path: base(value || "New Folder") }), "Folder created")} className="px-3 py-1.5 rounded-lg bg-accent text-accent-fg text-sm">Create</button>}>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="Folder name" className="w-full rounded-lg bg-surface border px-3 py-2 outline-none focus:ring-2 focus:ring-accent/40" />
      </Modal>
    );
  }
  if (menu.kind === "newFile") {
    return (
      <Modal title="New text file" onClose={onClose} footer={<button onClick={() => run(() => post("/files/file", { root: rootId, path: base(value || "untitled.txt"), content }), "File created")} className="px-3 py-1.5 rounded-lg bg-accent text-accent-fg text-sm">Create</button>}>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="name.txt" className="w-full mb-2 rounded-lg bg-surface border px-3 py-2 outline-none focus:ring-2 focus:ring-accent/40" />
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={6} placeholder="Contents…" className="w-full rounded-lg bg-surface border px-3 py-2 outline-none focus:ring-2 focus:ring-accent/40 font-mono text-sm" />
      </Modal>
    );
  }
  if (menu.kind === "rename" && menu.item) {
    return (
      <Modal title="Rename" onClose={onClose} footer={<button onClick={() => run(() => post("/files/rename", { root: rootId, path: menu.item!.path, name: value }), "Renamed")} className="px-3 py-1.5 rounded-lg bg-accent text-accent-fg text-sm">Rename</button>}>
        <input autoFocus defaultValue={menu.item.name} onChange={(e) => setValue(e.target.value)} className="w-full rounded-lg bg-surface border px-3 py-2 outline-none focus:ring-2 focus:ring-accent/40" />
      </Modal>
    );
  }
  if ((menu.kind === "move" || menu.kind === "copy") && menu.item) {
    const isMove = menu.kind === "move";
    return (
      <Modal title={isMove ? "Move to" : "Copy to"} onClose={onClose} footer={<button onClick={() => run(() => post(`/files/${isMove ? "move" : "copy"}`, { root: rootId, source: menu.item!.path, destination: (value || "") + "/" + menu.item!.name }), isMove ? "Moved" : "Copied")} className="px-3 py-1.5 rounded-lg bg-accent text-accent-fg text-sm">{isMove ? "Move" : "Copy"}</button>}>
        <p className="text-sm text-content-muted mb-2">Destination folder (relative path, empty = root):</p>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. docs" className="w-full rounded-lg bg-surface border px-3 py-2 outline-none focus:ring-2 focus:ring-accent/40" />
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
    try {
      await post("/admin/roots", { name, path: p, read_only: readOnly, indexed: true });
      pushToast("success", "Storage root created");
      onDone();
    } catch (e: any) {
      pushToast("error", e.message);
    }
  };
  return (
    <Modal title="New storage root" onClose={onClose} footer={<button onClick={run} className="px-3 py-1.5 rounded-lg bg-accent text-accent-fg text-sm">Create</button>}>
      <label className="block text-sm mb-1">Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} className="w-full mb-3 rounded-lg bg-surface border px-3 py-2 outline-none" placeholder="Backups" />
      <label className="block text-sm mb-1">Host path</label>
      <input value={p} onChange={(e) => setP(e.target.value)} className="w-full mb-3 rounded-lg bg-surface border px-3 py-2 outline-none font-mono" placeholder="/mnt/backups" />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /> Read-only</label>
      <p className="mt-2 text-xs text-content-muted flex items-center gap-1"><HardDrive className="h-3 w-3" /> The directory must exist on the host / mounted volume.</p>
    </Modal>
  );
}
