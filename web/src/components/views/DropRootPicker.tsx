/**
 * Extracted from Workspace.tsx — destination picker shown after an upload
 * when no storage root is decided yet.
 */
import { useState } from "react";
import { HardDrive } from "lucide-react";
import { Modal } from "../Modal";
import { Button } from "../ui/Button";
import type { Root } from "../../api/types";

export function DropRootPicker({ roots, pending, onClose, onConfirm }: {
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
        <Button variant="primary" size="sm" disabled={!effective} onClick={() => onConfirm(effective, destPath.trim())}>
          Upload {fileCount > 0 ? `${fileCount} file${fileCount > 1 ? "s" : ""}` : ""}
        </Button>
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
