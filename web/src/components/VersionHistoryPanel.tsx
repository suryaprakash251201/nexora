import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { History, Plus, Loader2, X } from "lucide-react";
import { versionsApi } from "../api/endpoints";
import { FileVersion } from "../api/types";
import { Button } from "./ui/Button";
import { toast } from "../lib/toast";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { VersionTimeline } from "./VersionTimeline";

interface VersionHistoryProps {
  rootId: string;
  path: string;
  fileName: string;
  onClose: () => void;
}
export function VersionHistoryPanel({ rootId, path, fileName, onClose }: VersionHistoryProps) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<FileVersion | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FileVersion | null>(null);

  const createMutation = useMutation({
    mutationFn: () => versionsApi.create(rootId, path, note || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["file-versions", rootId, path] });
      toast.success("Snapshot created");
      setNote("");
      setCreating(false);
    },
    onError: (err: any) => toast.error(err.message || "Failed to create snapshot"),
  });
  const restoreMutation = useMutation({
    mutationFn: (id: string) => versionsApi.restore(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["file-versions", rootId, path] });
      toast.success("Version restored");
    },
    onError: (err: any) => toast.error(err.message || "Failed to restore version"),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => versionsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["file-versions", rootId, path] });
      toast.success("Version deleted");
    },
    onError: (err: any) => toast.error(err.message || "Failed to delete version"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[82vh] glass-strong rounded-2xl shadow-2xl border border-glass-border overflow-hidden flex flex-col animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/20 grid place-items-center">
              <History className="h-4 w-4 text-violet-400" />
            </div>
            <div>
              <h2 className="font-semibold text-sm">Version History</h2>
              <p className="text-xs text-content-muted truncate max-w-[300px]">{fileName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Create snapshot */}
        {creating ? (
          <div className="p-4 border-b border-white/5 bg-surface/30">
            <div className="flex items-center gap-2">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note for this snapshot..."
                className="flex-1 rounded-lg glass-input px-3 py-2 outline-none text-sm"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") createMutation.mutate(); }}
              />
              <Button size="sm" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
              <button onClick={() => { setCreating(false); setNote(""); }} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors" aria-label="Cancel">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="px-4 py-2.5 border-b border-white/5 flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => setCreating(true)} icon={<Plus className="h-4 w-4" />}>
              New snapshot
            </Button>
          </div>
        )}

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto p-4">
          <VersionTimeline
            rootId={rootId}
            path={path}
            onRestore={(v) => setPendingRestore(v)}
            onDelete={(v) => setPendingDelete(v)}
          />
        </div>

        <ConfirmDialog
          open={!!pendingRestore}
          title="Restore this version?"
          description={pendingRestore ? `Version ${pendingRestore.version} of "${fileName}" will overwrite the current file. The current version is snapshotted first so this is reversible.` : ""}
          confirmLabel="Restore"
          loading={restoreMutation.isPending}
          onConfirm={() => { if (pendingRestore) restoreMutation.mutate(pendingRestore.id); setPendingRestore(null); }}
          onCancel={() => setPendingRestore(null)}
        />
        <ConfirmDialog
          open={!!pendingDelete}
          title="Delete this version?"
          description={pendingDelete ? `Version ${pendingDelete.version} will be permanently deleted.` : ""}
          confirmLabel="Delete"
          danger
          loading={deleteMutation.isPending}
          onConfirm={() => { if (pendingDelete) deleteMutation.mutate(pendingDelete.id); setPendingDelete(null); }}
          onCancel={() => setPendingDelete(null)}
        />
      </div>
    </div>
  );
}
