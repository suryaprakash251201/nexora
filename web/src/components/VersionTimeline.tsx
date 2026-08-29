import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  Sparkles, FileDigit, Clock, Download, RotateCcw, Trash2, History, StickyNote,
} from "lucide-react";
import { versionsApi } from "../api/endpoints";
import { FileVersion } from "../api/types";
import { formatBytes, formatDate, formatRelative } from "../lib/format";
import { cn } from "@/lib/utils";
import { QueryError } from "./ui/QueryError";

interface VersionTimelineProps {
  rootId: string;
  path: string;
  /** Called when the user asks to restore a version (parent owns the confirm dialog). */
  onRestore?: (v: FileVersion) => void;
  /** Called when the user asks to delete a version (parent owns the confirm dialog). */
  onDelete?: (v: FileVersion) => void;
  /** When false the timeline is read-only (download links still work). */
  actions?: boolean;
}

/**
 * Shared vertical timeline used by both the Version History modal and the
 * Properties → Versions tab. The "current" pseudo-version (id "current") is
 * pinned to the top and rendered as the live file; stored snapshots follow in
 * reverse-chronological order.
 */
export function VersionTimeline({ rootId, path, onRestore, onDelete, actions = true }: VersionTimelineProps) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["file-versions", rootId, path],
    queryFn: () => versionsApi.list(rootId, path),
  });

  if (isLoading) {
    return (
      <div className="space-y-3 py-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="skeleton h-9 w-9 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-4 w-32 rounded-md" />
              <div className="skeleton h-3 w-48 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return <QueryError message="Could not load version history." onRetry={() => qc.refetchQueries({ queryKey: ["file-versions", rootId, path] })} />;
  }

  const versions = data?.versions || [];

  if (versions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <div className="h-14 w-14 rounded-2xl bg-violet-500/10 border border-violet-500/15 grid place-items-center mb-3">
          <History className="h-7 w-7 text-violet-400" />
        </div>
        <p className="text-sm font-semibold">No versions yet</p>
        <p className="text-xs text-content-muted mt-1 max-w-[240px]">Snapshots are created automatically before overwrites, or make one manually from the full history.</p>
      </div>
    );
  }

  return (
    <ol className="relative">
      {/* spine */}
      <span className="absolute left-[17px] top-3 bottom-3 w-px bg-gradient-to-b from-violet-500/40 via-border/40 to-transparent" aria-hidden />
      {versions.map((v, idx) => {
        const isCurrent = v.id === "current";
        return (
          <motion.li
            key={v.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(idx * 0.04, 0.3) }}
            className="relative flex gap-3.5 pb-3 last:pb-0"
          >
            {/* node */}
            <div className={cn("relative z-10 h-9 w-9 rounded-full grid place-items-center shrink-0 border", isCurrent ? "bg-violet-500/15 border-violet-500/30" : "bg-surface border-border/50")}>
              {isCurrent ? <Sparkles className="h-4 w-4 text-violet-400" /> : <FileDigit className="h-4 w-4 text-content-muted" />}
            </div>

            <div className={cn("flex-1 min-w-0 rounded-xl border p-3 transition-colors", isCurrent ? "bg-violet-500/[0.07] border-violet-500/20" : "bg-surface/60 border-border/40 hover:border-border/60")}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm">{isCurrent ? "Current version" : `Version ${v.version}`}</span>
                {isCurrent && <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-violet-500/20 text-violet-300 font-semibold border border-violet-500/30">Live</span>}
                {v.auto && !isCurrent && (
                  <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-white/[0.06] text-content-muted font-medium border border-border/40" title="Automatically captured before an overwrite">auto</span>
                )}
              </div>

              <p className="text-xs text-content-muted flex items-center gap-2 mt-1">
                <span className="inline-flex items-center gap-1"><Download className="h-3 w-3 opacity-70" />{formatBytes(v.size)}</span>
                <span className="h-1 w-1 rounded-full bg-border" />
                <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3 opacity-70" />{formatDate(v.created_at)}</span>
                <span className="h-1 w-1 rounded-full bg-border" />
                <span title={formatDate(v.created_at)}>{formatRelative(v.created_at)}</span>
              </p>

              {v.note && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-content-secondary bg-surface-muted/60 border border-border/30 rounded-lg px-2.5 py-1.5">
                  <StickyNote className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400" />
                  <span className="break-words">{v.note}</span>
                </p>
              )}

              {actions && !isCurrent && (
                <div className="mt-2.5 flex items-center gap-1.5">
                  <a
                    href={versionsApi.downloadUrl(v.id)}
                    download
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs font-medium bg-surface border border-border/50 text-content-secondary hover:text-accent hover:border-accent/30 transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" /> Download
                  </a>
                  {onRestore && (
                    <button
                      onClick={() => onRestore(v)}
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs font-medium bg-surface border border-border/50 text-content-secondary hover:text-accent hover:border-accent/30 transition-colors"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Restore
                    </button>
                  )}
                  {onDelete && (
                    <button
                      onClick={() => onDelete(v)}
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs font-medium bg-surface border border-border/50 text-content-secondary hover:text-red-400 hover:border-red-500/30 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}
