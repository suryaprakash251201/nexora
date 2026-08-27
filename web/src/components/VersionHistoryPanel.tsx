import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { History, RotateCcw, Trash2, Plus, Clock, FileDigit, X, Loader2, Download, Sparkles } from "lucide-react";
;
import { versionsApi } from "../api/endpoints";
import { FileVersion } from "../api/types";
import { formatBytes, formatDate } from "../lib/format";
import { Button } from "./ui/Button";
import { cn } from "@/lib/utils";
import { toast } from "../lib/toast";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { QueryError } from "./ui/QueryError";
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
  const { data, isLoading, error } = useQuery({
    queryKey: ["file-versions", rootId, path],
    queryFn: () => versionsApi.list(rootId, path),
  });
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
  const handleCreate = () => {
    createMutation.mutate();
  };
  const [pendingRestore, setPendingRestore] = useState<FileVersion | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FileVersion | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[80vh] glass-strong rounded-2xl shadow-2xl border border-glass-border overflow-hidden flex flex-col animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-accent/10 grid place-items-center">
              <History className="h-4 w-4 text-accent" />
            </div>
            <div>
              <h2 className="font-semibold text-sm">Version History</h2>
              <p className="text-xs text-content-muted truncate max-w-[300px]">{fileName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5">
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
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
              />
              <Button size="sm" onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
              <button onClick={() => { setCreating(false); setNote(""); }} className="p-1.5">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="px-4 py-2 border-b border-white/5 flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => setCreating(true)} icon={<Plus className="h-4 w-4" />}>
              New snapshot
            </Button>
          </div>
        )}
        {/* Versions list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-8 text-center text-content-muted">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
              <p className="text-sm">Loading versions...</p>
            </div>
          ) : error ? (
            <div className="p-4">
              <QueryError message="Could not load version history." onRetry={() => qc.refetchQueries({ queryKey: ["file-versions", rootId, path] })} />
            </div>
          ) : data?.versions?.length === 0 ? (
            <div className="p-8 text-center text-content-muted">
              <History className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No versions yet</p>
              <p className="text-xs mt-1 opacity-70">Create a snapshot to track file changes</p>
            </div>
          ) : (
            <ul className="p-2 space-y-1">
              {data?.versions?.map((version, idx) => (
                <motion.li
                  key={version.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-xl border transition-all",
                    version.id === "current"
                      ? "bg-accent/10 border-accent/20"
                      : "bg-surface/50 border-white/[0.03] hover:bg-glass-bg"
                  )}
                >
                  <div className="w-8 h-8 rounded-lg bg-accent/10 grid place-items-center shrink-0">
                    {version.id === "current" ? <Sparkles className="h-4 w-4 text-accent" /> : <FileDigit className="h-4 w-4 text-accent" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">
                        {version.id === "current" ? "Current" : `Version ${version.version}`}
                      </span>
                      {version.id === "current" && (
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-accent/20 text-accent font-medium">Latest</span>
                      )}
                      {version.auto && version.id !== "current" && (
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-white/[0.05] text-content-muted font-medium" title="Automatically captured before an overwrite">auto</span>
                      )}
                    </div>
                    <p className="text-xs text-content-muted flex items-center gap-2">
                      <span>{formatBytes(version.size)}</span>
                      <span>·</span>
                      <Clock className="h-3 w-3" />
                      <span>{formatDate(version.created_at)}</span>
                    </p>
                    {version.note && (
                      <p className="text-xs text-content-muted mt-0.5 italic truncate">{version.note}</p>
                    )}
                  </div>
                  {version.id !== "current" && (
                    <div className="flex items-center gap-1">
                      <a
                        href={versionsApi.downloadUrl(version.id)}
                        download
                        className="p-1.5 rounded-lg hover:bg-accent/10 hover:text-accent transition-colors"
                        title="Download this version"
                        aria-label={`Download version ${version.version}`}
                      >
                        <Download className="h-4 w-4" />
                      </a>
                      <button
                        onClick={() => setPendingRestore(version)}
                        className="p-1.5 rounded-lg hover:bg-accent/10 hover:text-accent transition-colors"
                        title="Restore this version"
                        aria-label={`Restore version ${version.version}`}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setPendingDelete(version)}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 hover:text-red-400 transition-colors"
                        title="Delete this version"
                        aria-label={`Delete version ${version.version}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </motion.li>
              ))}
            </ul>
          )}
        </div>
      <ConfirmDialog
        open={!!pendingRestore}
        title="Restore this version?"
        description={pendingRestore ? `Version ${pendingRestore.version} of "${fileName}" will overwrite the current file.` : ""}
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