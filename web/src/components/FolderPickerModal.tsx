import { useMemo, useState } from "react";
import { Folder, ArrowUp, FolderInput, Check } from "lucide-react";
import { Button } from "./ui/Button";
;
import { filesApi } from "../api/endpoints";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "./Modal";
import type { FileItem } from "../api/types";
// FolderPickerModal lets the user browse a storage root's folder tree and pick
// a destination directory. Used for bulk Move/Copy operations.
export default function FolderPickerModal({
  rootId,
  currentPath,
  mode,
  onClose,
  onConfirm,
}: {
  rootId: string;
  currentPath: string;
  mode: "move" | "copy";
  onClose: () => void;
  onConfirm: (destPath: string) => void;
}) {
  const [nav, setNav] = useState(currentPath);
  const folders = useQuery({
    queryKey: ["folders", rootId, nav],
    queryFn: () =>
      filesApi.list({ root: rootId, path: nav, sort: "name", order: "asc" }) as any,
    enabled: !!rootId,
  });
  const subfolders = useMemo(
    () => (folders.data?.items || []).filter((i: FileItem) => i.is_dir),
    [folders.data],
  );
  const parent = nav.includes("/") ? nav.slice(0, nav.lastIndexOf("/")) : "";
  return (
    <Modal
      title={`${mode === "move" ? "Move" : "Copy"} to folder`}
      onClose={onClose}
      footer={
        <Button variant="primary" size="sm" onClick={() => onConfirm(nav)}>
          {mode === "move" ? "Move here" : "Copy here"}
        </Button>
      }
    >
      <p className="text-xs text-content-muted mb-2">Destination: <span className="font-mono">{nav || "root"}</span></p>
      <div className="max-h-72 overflow-auto rounded-lg border glass-divider">
        {parent !== nav && (
          <button
            onClick={() => setNav(parent)}
            className="w-full flex items-center gap-2 px-3 py-2 text-left glass-hover border-b glass-divider"
          >
            <ArrowUp className="h-4 w-4 text-content-muted" />
            <span className="text-sm">.. (up)</span>
          </button>
        )}
        {folders.isLoading && <p className="p-3 text-sm text-content-muted">Loading…</p>}
        {!folders.isLoading && subfolders.length === 0 && (
          <p className="p-3 text-sm text-content-muted">No subfolders. Items will go into “{nav || "root"}”.</p>
        )}
        {subfolders.map((f: FileItem) => (
          <button
            key={f.path}
            onClick={() => setNav(f.path)}
            className="w-full flex items-center gap-2 px-3 py-2 text-left glass-hover border-b glass-divider last:border-0"
          >
            <Folder className="h-4 w-4 text-accent" />
            <span className="text-sm truncate flex-1">{f.name}</span>
            <FolderInput className="h-4 w-4 text-content-muted" />
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-content-muted flex items-center gap-1">
        <Check className="h-3 w-3" /> Click a folder to navigate into it, then confirm.
      </p>
    </Modal>
  );
}