import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  HardDrive, Image, Video, Music, FileText, Archive, Code2, FolderSearch,
  ChevronDown, ChevronRight, Copy, ExternalLink
} from "lucide-react";
import { statsApi } from "../api/endpoints";
import { Root } from "../api/types";
import { formatBytes } from "../lib/format";
interface StorageAnalyticsProps {
  roots: Root[];
  onClose?: () => void;
  onNavigateToFile?: (rootId: string, path: string) => void;
}
// Categorical colors use the shared multi-accent palette tokens (index.css)
// so charts stay consistent with the design system in both themes.
const categoryConfig: Record<string, { label: string; icon: React.FC<any>; color: string; barColor: string }> = {
  images: { label: "Images", icon: Image, color: "var(--color-accent-pink)", barColor: "from-accent-pink to-accent-rose" },
  videos: { label: "Videos", icon: Video, color: "var(--color-accent-purple)", barColor: "from-accent-purple to-accent-secondary" },
  audio: { label: "Audio", icon: Music, color: "var(--color-accent-emerald)", barColor: "from-accent-emerald to-accent-teal" },
  documents: { label: "Documents", icon: FileText, color: "var(--color-accent-amber)", barColor: "from-accent-amber to-accent-orange" },
  archives: { label: "Archives", icon: Archive, color: "var(--color-accent-orange)", barColor: "from-accent-orange to-accent-rose" },
  code: { label: "Code", icon: Code2, color: "var(--color-accent-cyan)", barColor: "from-accent-cyan to-accent-blue" },
  other: { label: "Other", icon: HardDrive, color: "#9CA3AF", barColor: "from-gray-500 to-slate-500" },
};
export default function StorageAnalyticsPanel({ roots, onClose, onNavigateToFile }: StorageAnalyticsProps) {
  const [selectedRoot, setSelectedRoot] = useState<string>(roots[0]?.id || "");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(["images", "videos", "documents"]));
  const [showDuplicates, setShowDuplicates] = useState(false);
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["storage-stats", selectedRoot],
    queryFn: () => statsApi.get(selectedRoot),
    enabled: !!selectedRoot,
  });
  const { data: duplicates, isLoading: dupesLoading } = useQuery({
    queryKey: ["duplicates", selectedRoot],
    queryFn: () => statsApi.duplicates(selectedRoot),
    enabled: !!selectedRoot && showDuplicates,
  });
  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent via-accent-secondary to-accent-tertiary grid place-items-center">
            <HardDrive className="h-4 w-4 text-white" />
          </div>
          <h2 className="font-semibold">Storage Analytics</h2>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedRoot}
            onChange={(e) => setSelectedRoot(e.target.value)}
            className="rounded-lg glass-input px-3 py-1.5 text-sm outline-none"
          >
            {roots.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
      </div>
      {statsLoading ? (
        <div className="flex-1 grid place-items-center">
          <div className="text-center text-content-muted">
            <div className="animate-spin h-8 w-8 mx-auto mb-3 rounded-full border-2 border-accent/30 border-t-accent" />
            <p className="text-sm">Analyzing storage...</p>
          </div>
        </div>
      ) : stats ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Overview Cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="stats-card p-4 rounded-xl glass border border-white/5">
              <p className="text-[10px] uppercase tracking-wider text-content-muted mb-1">Files</p>
              <p className="text-2xl font-bold">{stats.total_files.toLocaleString()}</p>
            </div>
            <div className="stats-card p-4 rounded-xl glass border border-white/5">
              <p className="text-[10px] uppercase tracking-wider text-content-muted mb-1">Total Size</p>
              <p className="text-2xl font-bold">{formatBytes(stats.total_size)}</p>
            </div>
          </div>
          {/* Category Distribution */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-accent" />
              Category Distribution
            </h3>
            <div className="space-y-2">
              {Object.entries(stats.breakdown)
                .filter(([, stat]) => stat.count > 0)
                .sort(([, a], [, b]) => b.size - a.size)
                .map(([category, stat]) => {
                  const config = categoryConfig[category] || categoryConfig.other;
                  const pct = stats.total_size > 0 ? ((stat.size / stats.total_size) * 100).toFixed(1) : "0";
                  const Icon = config.icon;
                  const isExpanded = expandedCategories.has(category);
                  return (
                    <div key={category}>
                      <button
                        onClick={() => toggleCategory(category)}
                        className="w-full flex items-center gap-3 p-2.5 rounded-xl glass-hover transition-all"
                      >
                        <div
                          className="w-8 h-8 rounded-lg grid place-items-center shrink-0"
                          style={{ background: `${config.color}15`, color: config.color }}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium">{config.label}</span>
                            <span className="text-xs text-content-muted">{formatBytes(stat.size)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                              <motion.div
                                className={`h-full rounded-full bg-gradient-to-r ${config.barColor}`}
                                initial={{ width: 0 }}
                                animate={{ width: `${pct}%` }}
                                transition={{ duration: 0.6, ease: "easeOut" }}
                              />
                            </div>
                            <span className="text-[10px] text-content-muted w-12 text-right">{pct}%</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-content-muted">
                          <span className="tabular-nums">{stat.count}</span>
                          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        </div>
                      </button>
                      {isExpanded && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          className="ml-11 text-xs text-content-muted space-y-1 py-1"
                        >
                          <div className="flex items-center gap-2">
                            <span>Count:</span>
                            <span className="font-medium text-content-secondary">{stat.count.toLocaleString()}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span>Size:</span>
                            <span className="font-medium text-content-secondary">{formatBytes(stat.size)}</span>
                          </div>
                        </motion.div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
          {/* Largest Files */}
          {stats.largest && stats.largest.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <FolderSearch className="h-4 w-4 text-accent" />
                Largest Files
              </h3>
              <div className="space-y-1">
                {stats.largest.map((file, idx) => (
                  <div
                    key={file.path}
                    className="flex items-center gap-3 p-2.5 rounded-xl glass-hover transition-all"
                    onClick={() => onNavigateToFile?.(selectedRoot, file.path)}
                  >
                    <span className="w-6 h-6 rounded-lg bg-accent/10 grid place-items-center text-[10px] font-bold text-accent shrink-0">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <p className="text-xs text-content-muted">{formatBytes(file.size)}</p>
                    </div>
                    <ExternalLink className="h-3.5 w-3.5 text-content-muted" />
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Duplicates */}
          <div>
            <button
              onClick={() => setShowDuplicates(!showDuplicates)}
              className="w-full flex items-center justify-between p-3 rounded-xl glass-hover transition-all"
            >
              <div className="flex items-center gap-2">
                <Copy className="h-4 w-4 text-amber-400" />
                <span className="text-sm font-medium">Duplicate Files</span>
              </div>
              {showDuplicates ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            {showDuplicates && (
              <div className="mt-2 space-y-2 pl-4">
                {dupesLoading ? (
                  <div className="text-xs text-content-muted p-4 text-center">
                    <div className="animate-spin h-5 w-5 mx-auto mb-2 rounded-full border-2 border-accent/30 border-t-accent" />
                    Scanning for duplicates...
                  </div>
                ) : !duplicates?.duplicates || duplicates.duplicates.length === 0 ? (
                  <p className="text-xs text-content-muted py-4 text-center">No duplicates found</p>
                ) : (
                  (duplicates.duplicates as any[][]).map((group, gIdx) => (
                    <div key={gIdx} className="p-3 rounded-xl glass border border-white/5">
                      <p className="text-xs font-medium text-content-muted mb-2 flex items-center gap-1">
                        <Copy className="h-3 w-3 text-amber-400" />
                        {group.length} duplicates{group[0] ? ` · ${formatBytes(group[0].size)} each` : ""}
                      </p>
                      <div className="space-y-1">
                        {group.map((file: any) => (
                          <div
                            key={file.path}
                            className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-white/5 text-xs cursor-pointer"
                            onClick={() => onNavigateToFile?.(selectedRoot, file.path)}
                          >
                            <FolderSearch className="h-3 w-3 text-content-muted shrink-0" />
                            <span className="truncate">{file.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 grid place-items-center text-content-muted">
          <p className="text-sm">Select a storage root to view analytics</p>
        </div>
      )}
    </div>
  );
}