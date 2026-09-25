/**
 * Extracted from Workspace.tsx — the create/rename/extract action modals.
 */
import { useState } from "react";
import { Modal } from "../Modal";
import { Button } from "../ui/Button";
import { useUI } from "../../store";
import { filesApi } from "../../api/endpoints";
import type { FileItem } from "../../api/types";

export function ActionModals({ menu, rootId, path, onClose, onDone, onArchiveExtract }: {
  menu: { kind: string; item?: FileItem; dest?: { rootId: string; path: string } };
  rootId: string;
  path: string;
  onClose: () => void;
  onDone: () => void;
  onArchiveExtract: (src: string, dest: string) => void;
}) {
  const [value, setValue] = useState(
    menu.kind === "rename" && menu.item ? menu.item.name : "",
  );
  const [content, setContent] = useState("");
  const pushToast = useUI((s) => s.pushToast);
  // Creation modals can be launched from a view with no active storage (the
  // home dashboard), where the user picked a destination in a picker first.
  const targetRootId = menu.dest?.rootId ?? rootId;
  const base = (name: string) => {
    const p = menu.dest?.path ?? path;
    return p ? `${p}/${name}` : name;
  };
  const run = async (fn: () => Promise<any>, ok: string) => {
    try { await fn(); pushToast("success", ok); onDone(); } catch (e: any) { pushToast("error", e.message); }
  };

  if (menu.kind === "newFolder") {
    return (
      <Modal title="New folder" onClose={onClose} footer={<Button variant="primary" size="sm" onClick={() => run(() => filesApi.createDirectory(targetRootId, base(value || "New Folder")), "Folder created")}>Create</Button>}>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="Folder name" className="glass-input w-full rounded-xl px-3 py-2" />
      </Modal>
    );
  }
  if (menu.kind === "newFile") {
    // Swap/append the filename's extension so template chips produce e.g.
    // "song.lrc" from a bare "song" or an existing "song.txt".
    const withExt = (ext: string) => {
      const v = value.trim();
      if (!v) return `untitled.${ext}`;
      return v.replace(/\.[^./\\]+$/, "") + "." + ext;
    };
    return (
      <Modal title="New text file" onClose={onClose} footer={<Button variant="primary" size="sm" onClick={() => run(() => filesApi.createFile(targetRootId, base(value || "untitled.txt"), content), "File created")}>Create</Button>}>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="name.txt" className="glass-input mb-2 w-full rounded-xl px-3 py-2" />
        <div className="mb-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => { setValue(withExt("txt")); setContent(""); }}
            className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-content-muted transition-colors hover:border-accent/50 hover:bg-accent/10 hover:text-accent"
          >
            Plain text
          </button>
          <button
            type="button"
            onClick={() => { setValue(withExt("lrc")); setContent("[ti:Track title]\n[ar:Artist]\n[00:00.00]\n"); }}
            className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-content-muted transition-colors hover:border-accent/50 hover:bg-accent/10 hover:text-accent"
            title="Synced lyrics template"
          >
            LRC lyrics
          </button>
        </div>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={6} placeholder="Contents…" className="glass-input w-full rounded-xl px-3 py-2 font-mono text-sm" />
      </Modal>
    );
  }
  if (menu.kind === "rename" && menu.item) {
    const trimmed = value.trim();
    return (
      <Modal title="Rename" onClose={onClose} footer={<Button variant="primary" size="sm" disabled={!trimmed} onClick={() => run(() => filesApi.rename(rootId, menu.item!.path, trimmed), "Renamed")}>Rename</Button>}>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} aria-label="New name" className="glass-input w-full rounded-xl px-3 py-2" />
      </Modal>
    );
  }
  if (menu.kind === "extract" && menu.item) {
    const defaultDest = path;
    return (
      <Modal title={`Extract "${menu.item.name}"`} onClose={onClose} footer={<Button variant="primary" size="sm" onClick={() => onArchiveExtract(menu.item!.path, value || defaultDest)}>Extract</Button>}>
        <p className="text-sm text-content-muted mb-2">Destination folder (relative path, empty = current):</p>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={defaultDest || "root"} className="glass-input w-full rounded-xl px-3 py-2" />
        <p className="mt-2 text-xs text-content-muted">Archives are extracted safely with zip-slip protection.</p>
      </Modal>
    );
  }
  return null;
}
