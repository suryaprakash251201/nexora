import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Users, ScrollText, RefreshCw, Plus, Shield, Settings, HardDrive, Sun, LayoutGrid, List, Pencil, Trash2, ShieldCheck, Clock, KeyRound, AlertCircle, DatabaseBackup, Activity, FolderOpen, BarChart3, Server, Play, Archive, Search, History, Globe, Lock, SlidersHorizontal, Wrench, RotateCcw, Save } from "lucide-react";
import { accentThemes, setAccentTheme } from "../lib/useAccentTheme";
import { adminApi, versionApi, rootsApi } from "../api/endpoints";
import { Modal } from "./Modal";
import RootModal from "./RootModal";
import { useUI } from "../store";
import { formatDate, formatBytes } from "../lib/format";
import { rootIcon } from "../lib/rootIcons";
import type { User, Root, AuditItem, BackupEntry } from "../api/types";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { SkeletonList } from "./ui/Skeleton";
import { EmptyState } from "./ui/EmptyState";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { QueryError } from "./ui/QueryError";

type Tab = "overview" | "users" | "roots" | "audit" | "backups" | "settings";

// ─── Main panel: sidebar-led console layout ────────────────────────────────
export default function AdminPanel() {
  const [tab, setTab] = useState<Tab>("overview");

  const nav: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <BarChart3 className="h-4 w-4" /> },
    { id: "users", label: "Users", icon: <Users className="h-4 w-4" /> },
    { id: "roots", label: "Storage Roots", icon: <HardDrive className="h-4 w-4" /> },
    { id: "audit", label: "Audit Log", icon: <ScrollText className="h-4 w-4" /> },
    { id: "backups", label: "Backups", icon: <DatabaseBackup className="h-4 w-4" /> },
    { id: "settings", label: "Settings", icon: <Settings className="h-4 w-4" /> },
  ];

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background">
      {/* Sticky top header: title + tab bar */}
      <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-4 pb-0">
          {/* Title row */}
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent shrink-0">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-content text-lg leading-tight truncate">Administration</p>
              <p className="text-xs text-content-muted truncate hidden sm:block">Server management console</p>
            </div>
          </div>
          {/* Tab bar */}
          <nav className="flex items-end gap-0.5 overflow-x-auto no-scrollbar -mb-px pb-0">
            {nav.map((n) => (
              <button
                key={n.id}
                onClick={() => setTab(n.id)}
                className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors duration-200 shrink-0
                  ${tab === n.id
                    ? "text-accent"
                    : "text-content-muted hover:text-content"}`}
                aria-current={tab === n.id ? "page" : undefined}
              >
                {n.icon}
                <span className="whitespace-nowrap">{n.label}</span>
                {tab === n.id && (
                  <motion.div
                    layoutId="admin-tab-underline"
                    className="absolute -bottom-px left-3 right-3 h-0.5 bg-gradient-to-r from-accent to-accent-purple rounded-full shadow-[0_0_8px_var(--color-accent-glow)]"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }}
                  />
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-6xl mx-auto p-4 sm:p-6 pb-24">
          {tab === "overview" && <OverviewTab goTo={setTab} />}
          {tab === "users" && <UsersTab />}
          {tab === "roots" && <RootsTab />}
          {tab === "audit" && <AuditTab />}
          {tab === "backups" && <BackupsTab />}
          {tab === "settings" && <SettingsTab />}
        </div>
      </div>
    </div>
  );
}

// ─── Overview ───────────────────────────────────────────────────────────────
function OverviewTab({ goTo }: { goTo: (t: Tab) => void }) {
  const pushToast = useUI((s) => s.pushToast);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["admin-overview"], queryFn: () => adminApi.overview() });
  const { data: audit } = useQuery({ queryKey: ["audit-preview"], queryFn: () => adminApi.listAudit(5) });
  const { data: ver } = useQuery({ queryKey: ["version"], queryFn: () => versionApi.get() });

  const reindex = async () => {
    try { await adminApi.reindex(); pushToast("success", "Search reindex started in background"); }
    catch (e: any) { pushToast("error", e.message); }
  };

  const usage = data?.usage;
  const usedPct = usage && usage.total > 0 ? Math.min(100, Math.round((usage.used / usage.total) * 100)) : 0;

  const stats = [
    { label: "Users", value: data?.users ?? 0, icon: <Users className="h-5 w-5" />, tint: "bg-accent/10 text-accent", to: "users" as Tab },
    { label: "Storage Roots", value: data?.roots ?? 0, icon: <HardDrive className="h-5 w-5" />, tint: "bg-accent-teal/10 text-accent-teal", to: "roots" as Tab },
    { label: "Files Indexed", value: data?.files ?? 0, icon: <FolderOpen className="h-5 w-5" />, tint: "bg-accent-purple/10 text-accent-purple", to: "audit" as Tab },
    { label: "Total Stored", value: formatBytes(data?.bytes ?? 0), icon: <Archive className="h-5 w-5" />, tint: "bg-accent-cyan/10 text-accent-cyan", to: "roots" as Tab },
  ];

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <button
            key={s.label}
            onClick={() => goTo(s.to)}
            className="glass-strong rounded-2xl border border-border/50 p-5 text-left hover:border-accent/30 hover:shadow-md transition-all group"
          >
            <div className={`h-10 w-10 rounded-xl ${s.tint} flex items-center justify-center mb-3 group-hover:scale-110 transition-transform`}>
              {s.icon}
            </div>
            <p className="text-2xl font-bold text-content leading-none">{s.value}</p>
            <p className="text-xs font-semibold text-content-muted uppercase tracking-wider mt-2">{s.label}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Storage usage */}
        <div className="lg:col-span-2 space-y-6">
          <section className="glass-strong rounded-2xl border border-border/50 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-accent/10 text-accent"><HardDrive className="h-5 w-5" /></div>
                <div>
                  <h3 className="font-bold text-lg">Storage Usage</h3>
                  <p className="text-sm text-content-muted">
                    {usage ? `${formatBytes(usage.used)} of ${formatBytes(usage.total)} used · ${formatBytes(usage.available)} free` : "Usage data unavailable"}
                  </p>
                </div>
              </div>
              <button onClick={() => refetch()} className="p-2 rounded-lg glass-hover text-content-muted hover:text-accent" title="Refresh usage" aria-label="Refresh usage">
                <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              </button>
            </div>

            {isError ? (
              <QueryError message="Could not load storage usage." onRetry={() => refetch()} />
            ) : isLoading ? (
              <SkeletonList />
            ) : (
              <div className="space-y-5">
                <div>
                  <div className="flex justify-between items-baseline mb-2">
                    <span className="text-sm font-semibold text-content">All roots combined</span>
                    <span className="text-xs font-mono text-content-muted">{usedPct}%</span>
                  </div>
                  <div className="h-3 rounded-full bg-surface overflow-hidden border border-border/30">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(usedPct, 2)}%` }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                      className="h-full bg-gradient-to-r from-accent to-accent-purple"
                    />
                  </div>
                </div>
                {(data?.rootUsage || []).map((r) => {
                  const pct = r.total > 0 ? Math.min(100, Math.round((r.used / r.total) * 100)) : 0;
                  const Icon = rootIcon("");
                  return (
                    <div key={r.id}>
                      <div className="flex justify-between items-baseline mb-1.5">
                        <span className="text-sm font-medium text-content flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5 text-content-muted" />
                          {r.name}
                        </span>
                        <span className="text-xs font-mono text-content-muted">
                          {formatBytes(r.used)} / {formatBytes(r.total)}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-surface overflow-hidden border border-border/20">
                        <div
                          className="h-full bg-accent/60 transition-all duration-700"
                          style={{ width: `${Math.max(pct, 1)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Quick actions + recent audit */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <section className="glass-strong rounded-2xl border border-border/50 p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-5">
                <div className="p-1.5 rounded-lg bg-accent/10 text-accent"><Activity className="h-4 w-4" /></div>
                <h3 className="font-bold text-lg">Quick Actions</h3>
              </div>
              <div className="space-y-3">
                <Button variant="secondary" className="w-full justify-start" onClick={reindex} icon={<RefreshCw className="h-4 w-4" />}>
                  Reindex search
                </Button>
                <Button variant="secondary" className="w-full justify-start" onClick={() => goTo("roots")} icon={<HardDrive className="h-4 w-4" />}>
                  Manage storage roots
                </Button>
                <Button variant="secondary" className="w-full justify-start" onClick={() => goTo("users")} icon={<Plus className="h-4 w-4" />}>
                  Add a user
                </Button>
                <Button variant="secondary" className="w-full justify-start" onClick={() => goTo("backups")} icon={<DatabaseBackup className="h-4 w-4" />}>
                  Back up database
                </Button>
              </div>
            </section>

            <section className="glass-strong rounded-2xl border border-border/50 p-6 shadow-sm">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-accent/10 text-accent"><Clock className="h-4 w-4" /></div>
                  <h3 className="font-bold text-lg">Recent Activity</h3>
                </div>
                <button onClick={() => goTo("audit")} className="text-xs font-semibold text-accent hover:underline">View all →</button>
              </div>
              {(audit?.items || []).length === 0 ? (
                <p className="text-sm text-content-muted">No audit entries yet.</p>
              ) : (
                <ul className="space-y-2.5">
                  {(audit?.items || []).map((a) => (
                    <li key={a.id} className="flex items-center gap-3 text-sm">
                      <AuditBadge action={a.action} />
                      <span className="truncate font-medium text-content flex-1 min-w-0">{a.target || a.detail || "—"}</span>
                      <span className="text-[10px] text-content-muted shrink-0">{formatDate(a.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>

        {/* Right rail: system information */}
        <div className="space-y-6">
          <section className="glass-strong rounded-2xl p-6 border border-border/50 shadow-sm relative overflow-hidden">
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, currentColor 1px, transparent 0)', backgroundSize: '16px 16px' }} />
            <div className="flex items-center gap-2 mb-5 relative z-10">
              <div className="p-1.5 rounded-lg bg-accent/10 text-accent"><Server className="h-4 w-4" /></div>
              <h3 className="font-bold text-lg">System</h3>
            </div>
            <dl className="space-y-4 relative z-10">
              <div className="flex justify-between items-center py-2 border-b border-border/50">
                <dt className="text-sm text-content-muted">Product</dt>
                <dd className="font-semibold text-content">{ver?.product || "Nexora"}</dd>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-border/50">
                <dt className="text-sm text-content-muted">Version</dt>
                <dd className="font-mono text-xs font-semibold px-2 py-1 rounded bg-surface border border-border/50">{ver?.version || "dev"}</dd>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-border/50">
                <dt className="text-sm text-content-muted">Runtime</dt>
                <dd className="font-mono text-xs font-semibold px-2 py-1 rounded bg-surface border border-border/50">{ver?.go || "—"}</dd>
              </div>
              <div className="flex justify-between items-center py-2">
                <dt className="text-sm text-content-muted">Transcoding</dt>
                <dd className="text-xs font-semibold px-2 py-1 rounded bg-surface border border-border/50">{ver?.transcode ? "Available" : "Off"}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── Storage Roots (dedicated section) ──────────────────────────────────────
function RootsTab() {
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["roots-admin"], queryFn: () => rootsApi.list() });
  const [editRoot, setEditRoot] = useState<Root | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [pendingRootDelete, setPendingRootDelete] = useState<Root | null>(null);
  const [rootDeleting, setRootDeleting] = useState(false);

  const removeRoot = async () => {
    if (!pendingRootDelete) return;
    setRootDeleting(true);
    try { await adminApi.deleteRoot(pendingRootDelete.id); pushToast("success", "Storage root deleted"); qc.invalidateQueries({ queryKey: ["roots-admin"] }); qc.invalidateQueries({ queryKey: ["roots"] }); setPendingRootDelete(null); }
    catch (e: any) { pushToast("error", e.message); }
    finally { setRootDeleting(false); }
  };

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 glass-strong p-4 rounded-2xl border border-border/50">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-accent/10 flex items-center justify-center text-accent"><HardDrive className="h-6 w-6" /></div>
          <div>
            <h2 className="text-lg font-bold">Storage Roots</h2>
            <p className="text-sm text-content-muted">Directories and remote buckets the server exposes to users</p>
          </div>
        </div>
        <Button variant="primary" onClick={() => setShowCreate(true)} icon={<Plus className="h-4 w-4" />}>Add Root</Button>
      </div>

      <section className="glass-strong rounded-2xl border border-border/50 shadow-sm">
        <div className="p-6">
          {isError ? (
            <QueryError message="Could not load storage roots." onRetry={() => refetch()} />
          ) : isLoading ? (
            <SkeletonList />
          ) : (!data?.roots || data.roots.length === 0) ? (
            <EmptyState title="No storage roots" description="Add a directory from your server to start serving files." />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(data?.roots || []).map((r) => {
                const Icon = rootIcon(r.icon);
                return (
                  <div key={r.id} className="flex flex-col glass rounded-xl border border-border/50 p-4 hover:border-accent/30 hover:shadow-md transition-all group">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-10 w-10 rounded-lg bg-surface flex items-center justify-center border border-border/50 shrink-0 group-hover:bg-accent/10 group-hover:text-accent transition-colors">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-bold text-content truncate pr-2">{r.name}</h4>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className={`w-2 h-2 rounded-full ${r.enabled === false ? "bg-content-muted" : r.read_only ? "bg-warning" : "bg-success"}`} />
                            <span className={`text-[10px] uppercase font-bold tracking-wider ${r.enabled === false ? "text-content-muted" : r.read_only ? "text-warning" : "text-success"}`}>
                              {r.enabled === false ? "Disabled" : r.read_only ? "Read-only" : "Read & write"}
                            </span>
                            <span className="text-[10px] uppercase font-bold tracking-wider text-content-muted/70 ml-1">· {r.type || "local"}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="bg-surface/50 rounded-lg p-2.5 mb-4 border border-border/30">
                      <p className="text-xs font-mono text-content-muted truncate" title={r.path}>{r.path}</p>
                    </div>
                    <div className="mt-auto flex gap-2">
                      <Button variant="secondary" size="sm" className="flex-1" onClick={() => setEditRoot(r)} icon={<Pencil className="h-3.5 w-3.5" />}>Edit</Button>
                      <Button variant="danger" size="sm" onClick={() => setPendingRootDelete(r)} className="px-3" aria-label={`Delete storage root ${r.name}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {showCreate && <RootModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ["roots-admin"] }); qc.invalidateQueries({ queryKey: ["roots"] }); }} />}
      {editRoot && <RootModal root={editRoot} onClose={() => setEditRoot(null)} onDone={() => { setEditRoot(null); qc.invalidateQueries({ queryKey: ["roots-admin"] }); qc.invalidateQueries({ queryKey: ["roots"] }); }} />}
      <ConfirmDialog
        open={!!pendingRootDelete}
        title="Delete storage root?"
        description={pendingRootDelete ? `"${pendingRootDelete.name}" will be permanently removed. Files on disk are not deleted, but users will lose access.` : ""}
        confirmLabel="Delete root"
        danger
        loading={rootDeleting}
        onConfirm={removeRoot}
        onCancel={() => setPendingRootDelete(null)}
      />
    </div>
  );
}

// ─── Backups ────────────────────────────────────────────────────────────────
function BackupsTab() {
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["admin-backups"], queryFn: () => adminApi.listBackups() });
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<BackupEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const createBackup = async () => {
    setCreating(true);
    try {
      await adminApi.createBackup();
      pushToast("success", "Backup started — it will appear here when finished");
      setTimeout(() => qc.invalidateQueries({ queryKey: ["admin-backups"] }), 3000);
    } catch (e: any) {
      pushToast("error", e.message || "Could not start backup");
    } finally {
      setCreating(false);
    }
  };

  const removeBackup = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await adminApi.deleteBackup(pendingDelete.name);
      pushToast("success", "Backup deleted");
      qc.invalidateQueries({ queryKey: ["admin-backups"] });
      setPendingDelete(null);
    } catch (e: any) {
      pushToast("error", e.message);
    } finally {
      setDeleting(false);
    }
  };

  const items = data?.items || [];

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 glass-strong p-4 rounded-2xl border border-border/50">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-accent/10 flex items-center justify-center text-accent"><DatabaseBackup className="h-6 w-6" /></div>
          <div>
            <h2 className="text-lg font-bold">Database Backups</h2>
            <p className="text-sm text-content-muted">
              {data?.enabled
                ? `Daily snapshots at ${data.hour}:00 (keep ${data.keep}) — ${data.dir}`
                : "Scheduled backups are disabled"}
            </p>
          </div>
        </div>
        <Button variant="primary" onClick={createBackup} loading={creating} disabled={!data?.enabled} icon={<Play className="h-4 w-4" />}>
          Back up now
        </Button>
      </div>

      {!data?.enabled && (
        <div className="glass-strong rounded-2xl border border-warning/20 p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-content mb-1">Scheduled backups are not configured</p>
              <p className="text-sm text-content-muted leading-relaxed">
                Set <code className="font-mono text-xs bg-surface px-1.5 py-0.5 rounded border border-border/50">NEXORA_BACKUP_DIR</code> in your environment (e.g. <code className="font-mono text-xs bg-surface px-1.5 py-0.5 rounded border border-border/50">/app/data/backups</code>) to enable daily <code className="font-mono text-xs bg-surface px-1.5 py-0.5 rounded border border-border/50">VACUUM INTO</code> snapshots.
                Use <code className="font-mono text-xs bg-surface px-1.5 py-0.5 rounded border border-border/50">NEXORA_BACKUP_KEEP</code> (default 7) and <code className="font-mono text-xs bg-surface px-1.5 py-0.5 rounded border border-border/50">NEXORA_BACKUP_HOUR</code> (default 3) to tune retention and schedule.
              </p>
            </div>
          </div>
        </div>
      )}

      <section className="glass-strong rounded-2xl border border-border/50 shadow-sm">
        <div className="p-6">
          {isError ? (
            <QueryError message="Could not load backups." onRetry={() => refetch()} />
          ) : isLoading ? (
            <SkeletonList />
          ) : items.length === 0 ? (
            <EmptyState
              title={data?.enabled ? "No backups yet" : "Backups disabled"}
              description={data?.enabled ? "The first snapshot will appear here after the next scheduled run or when you click “Back up now”." : "Enable NEXORA_BACKUP_DIR to start taking snapshots."}
              icon={<DatabaseBackup className="h-8 w-8" />}
            />
          ) : (
            <div className="divide-y divide-border/50 border border-border/50 rounded-xl overflow-hidden">
              {items.map((b) => (
                <div key={b.name} className="flex items-center gap-4 px-4 py-3 hover:bg-surface/30 transition-colors">
                  <div className="h-9 w-9 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0">
                    <DatabaseBackup className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm font-medium text-content truncate">{b.name}</p>
                    <p className="text-xs text-content-muted mt-0.5">{formatDate(b.modtime)} · {formatBytes(b.size)}</p>
                  </div>
                  <button
                    onClick={() => setPendingDelete(b)}
                    className="p-2 rounded-lg glass-hover text-danger hover:bg-danger/10 transition-colors"
                    title="Delete backup"
                    aria-label={`Delete backup ${b.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete this backup?"
        description={pendingDelete ? `"${pendingDelete.name}" (${formatBytes(pendingDelete.size)}) will be permanently removed from disk.` : ""}
        confirmLabel="Delete backup"
        danger
        loading={deleting}
        onConfirm={removeBackup}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function AuditBadge({ action }: { action: string }) {
  const lower = action.toLowerCase();
  const color =
    lower.includes("user") || lower.includes("login") || lower.includes("logout")
      ? "text-accent bg-accent/10 border-accent/20"
      : lower.includes("file") || lower.includes("upload") || lower.includes("download")
      ? "text-accent-cyan bg-accent-cyan/10 border-accent-cyan/20"
      : lower.includes("delete") || lower.includes("remove") || lower.includes("backup_delete")
      ? "text-danger bg-danger/10 border-danger/20"
      : lower.includes("create") || lower.includes("add")
      ? "text-success bg-success/10 border-success/20"
      : lower.includes("system") || lower.includes("config") || lower.includes("backup")
      ? "text-accent-purple bg-accent-purple/10 border-accent-purple/20"
      : "text-text-secondary bg-glass-bg border-glass-border";
  return (
    <span className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold border inline-flex items-center gap-1.5 ${color}`}>
      {action}
    </span>
  );
}

function UsersTab() {
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["admin-users"], queryFn: () => adminApi.listUsers() });
  const [showCreate, setShowCreate] = useState(false);
  const [permUser, setPermUser] = useState<User | null>(null);
  const [pendingDelete, setPendingDelete] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [resetPwUser, setResetPwUser] = useState<User | null>(null);
  const [resetPwValue, setResetPwValue] = useState("");
  const [resetPwConfirm, setResetPwConfirm] = useState("");
  const [resetPwBusy, setResetPwBusy] = useState(false);
  const [resetPwError, setResetPwError] = useState<string | null>(null);

  const reindex = async () => {
    try { await adminApi.reindex(); pushToast("success", "Reindex started in background"); }
    catch (e: any) { pushToast("error", e.message); }
  };

  const updateUser = async (id: string, body: any) => {
    try { await adminApi.updateUser(id, body); pushToast("success", "User updated"); qc.invalidateQueries({ queryKey: ["admin-users"] }); }
    catch (e: any) { pushToast("error", e.message); }
  };

  const removeUser = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try { await adminApi.deleteUser(pendingDelete.id); pushToast("success", "User deleted"); qc.invalidateQueries({ queryKey: ["admin-users"] }); setPendingDelete(null); }
    catch (e: any) { pushToast("error", e.message); }
    finally { setDeleting(false); }
  };

  const resetPassword = async () => {
    if (!resetPwUser) return;
    setResetPwError(null);
    if (resetPwValue !== resetPwConfirm) { setResetPwError("Passwords do not match"); return; }
    if (resetPwValue.length < 8) { setResetPwError("Password must be at least 8 characters"); return; }
    setResetPwBusy(true);
    try {
      await adminApi.updateUser(resetPwUser.id, { password: resetPwValue });
      pushToast("success", `Password reset for ${resetPwUser.username}`);
      setResetPwUser(null);
      setResetPwValue("");
      setResetPwConfirm("");
    } catch (e: any) {
      setResetPwError(e.message || "Failed to reset password");
    } finally {
      setResetPwBusy(false);
    }
  };

  const users = data?.users || [];

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 glass-strong p-4 rounded-2xl border border-border/50">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-accent/10 flex items-center justify-center text-accent">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold">User Directory</h2>
            <p className="text-sm text-content-muted">{users.length} total users registered</p>
          </div>
        </div>
        <div className="flex gap-3 w-full sm:w-auto">
          <Button variant="secondary" onClick={reindex} icon={<RefreshCw className="h-4 w-4" />}>
            Reindex Search
          </Button>
          <Button variant="primary" onClick={() => setShowCreate(true)} icon={<Plus className="h-4 w-4" />}>
            New User
          </Button>
        </div>
      </div>

      <div className="glass-strong rounded-2xl border border-border/50 overflow-hidden shadow-sm">
        {isError ? (
          <div className="p-6"><QueryError message="Could not load users." onRetry={() => refetch()} /></div>
        ) : isLoading ? (
          <div className="p-6"><SkeletonList /></div>
        ) : users.length === 0 ? (
          <div className="p-10"><EmptyState title="No users found" description="Create a user to get started." /></div>
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-sm text-left">
              <thead className="bg-surface/50 border-b border-border/50 text-xs uppercase font-semibold text-content-muted">
                <tr>
                  <th className="px-6 py-4">User</th>
                  <th className="px-6 py-4">Role</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-surface/30 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-accent/10 flex items-center justify-center text-accent font-bold uppercase text-xs">
                          {(u.display_name || u.username).substring(0, 2)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-content truncate">{u.display_name || u.username}</p>
                          <p className="text-xs text-content-muted truncate mt-0.5 font-mono">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-1.5">
                        {["admin", "user", "viewer"].map((role) => (
                          <button
                            key={role}
                            onClick={() => updateUser(u.id, { role })}
                            className={`text-xs font-medium px-2.5 py-1 rounded-lg border transition-all duration-200 ${
                              u.role === role
                                ? role === "admin"
                                  ? "bg-accent-purple/10 text-accent-purple border-accent-purple/30 shadow-sm"
                                  : role === "user"
                                  ? "bg-accent/10 text-accent border-accent/30 shadow-sm"
                                  : "bg-accent-teal/10 text-accent-teal border-accent-teal/30 shadow-sm"
                                : "bg-transparent text-text-tertiary border-transparent hover:text-foreground hover:bg-glass-bg"
                            }`}
                          >
                            {role.charAt(0).toUpperCase() + role.slice(1)}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => updateUser(u.id, { status: u.status === "active" ? "disabled" : "active" })}
                        className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition-all duration-200 ${
                          u.status === "active"
                            ? "bg-success/10 text-success border-success/20 hover:bg-success/20"
                            : "bg-text-quaternary/10 text-text-quaternary border-text-quaternary/20 hover:bg-text-quaternary/20"
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${u.status === "active" ? "bg-success animate-pulse" : "bg-text-quaternary"}`} />
                        {u.status === "active" ? "Active" : "Disabled"}
                      </button>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-all duration-200">
                        <button
                          onClick={() => { setResetPwUser(u); setResetPwValue(""); setResetPwConfirm(""); setResetPwError(null); }}
                          className="p-2 rounded-lg glass-hover text-accent hover:bg-accent/10 hover:shadow-sm transition-all"
                          title="Reset Password"
                          aria-label={`Reset password for ${u.username}`}
                        >
                          <KeyRound className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setPermUser(u)}
                          className="p-2 rounded-lg glass-hover text-accent hover:bg-accent/10 hover:shadow-sm transition-all"
                          title="Manage Root Access"
                          aria-label={`Manage root access for ${u.username}`}
                        >
                          <Shield className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setPendingDelete(u)}
                          className="p-2 rounded-lg glass-hover text-danger hover:bg-danger/10 hover:shadow-sm transition-all"
                          title="Delete User"
                          aria-label={`Delete user ${u.username}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ["admin-users"] }); }} />}
      {permUser && <PermModal user={permUser} onClose={() => setPermUser(null)} />}
      {resetPwUser && (
        <Modal title={`Reset Password: ${resetPwUser.username}`} onClose={() => { setResetPwUser(null); setResetPwError(null); }}
          footer={
            <Button variant="primary" size="sm" loading={resetPwBusy} disabled={!resetPwValue || !resetPwConfirm} onClick={resetPassword}>
              Set Password
            </Button>
          }>
          <div className="space-y-4">
            <p className="text-sm text-content-muted">Set a new password for <strong>{resetPwUser.username}</strong>. The user will be logged out of all sessions.</p>
            <div>
              <label className="text-xs font-bold text-content-muted uppercase tracking-wider ml-1">New Password</label>
              <input type="password" value={resetPwValue} onChange={(e) => { setResetPwValue(e.target.value); setResetPwError(null); }} className="w-full rounded-lg glass-input px-3 py-2.5 outline-none text-sm mt-1" placeholder="Min 8 characters" />
            </div>
            <div>
              <label className="text-xs font-bold text-content-muted uppercase tracking-wider ml-1">Confirm Password</label>
              <input type="password" value={resetPwConfirm} onChange={(e) => { setResetPwConfirm(e.target.value); setResetPwError(null); }} className="w-full rounded-lg glass-input px-3 py-2.5 outline-none text-sm mt-1" placeholder="Repeat password" />
            </div>
            {resetPwError && <p className="text-sm text-danger flex items-center gap-1.5"><AlertCircle className="h-4 w-4" /> {resetPwError}</p>}
          </div>
        </Modal>
      )}
      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete user?"
        description={pendingDelete ? `"${pendingDelete.username}" will be permanently removed. This cannot be undone.` : ""}
        confirmLabel="Delete user"
        danger
        loading={deleting}
        onConfirm={removeUser}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function CreateUserModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const pushToast = useUI((s) => s.pushToast);
  const [form, setForm] = useState({ username: "", email: "", password: "", display_name: "", role: "user" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    setIsSubmitting(true);
    try {
      await adminApi.createUser(form);
      pushToast("success", "User successfully created");
      onDone();
    }
    catch (e: any) {
      pushToast("error", e.message);
    } finally {
      setIsSubmitting(false);
    }
  };
  const upd = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal
      title="Create New User"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-3 w-full">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={isSubmitting}>Create User</Button>
        </div>
      }
    >
      <div className="space-y-5 py-2">
        <div className="space-y-1">
          <label className="text-xs font-bold text-content-muted uppercase tracking-wider">Username</label>
          <Input value={form.username} onChange={(e) => upd("username", e.target.value)} placeholder="johndoe" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-bold text-content-muted uppercase tracking-wider">Display Name</label>
          <Input value={form.display_name} onChange={(e) => upd("display_name", e.target.value)} placeholder="John Doe" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-bold text-content-muted uppercase tracking-wider">Email Address</label>
          <Input value={form.email} onChange={(e) => upd("email", e.target.value)} placeholder="john@example.com" type="email" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-bold text-content-muted uppercase tracking-wider">Password</label>
          <Input type="password" value={form.password} onChange={(e) => upd("password", e.target.value)} placeholder="Min 8 characters" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-bold text-content-muted uppercase tracking-wider">Role</label>
          <select value={form.role} onChange={(e) => upd("role", e.target.value)} className="w-full rounded-xl glass-input px-4 py-3 outline-none font-medium cursor-pointer">
            <option value="user">User (Standard Access)</option>
            <option value="viewer">Viewer (Read Only)</option>
            <option value="admin">Admin (Full Access)</option>
          </select>
        </div>
      </div>
    </Modal>
  );
}

function PermModal({ user, onClose }: { user: User; onClose: () => void }) {
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["user-roots", user.id], queryFn: () => adminApi.getUserRoots(user.id) });

  const set = async (rootId: string, permission: string | null) => {
    try {
      if (permission === null) await adminApi.revokeRoot(user.id, rootId);
      else await adminApi.grantRoot(user.id, rootId, permission);
      qc.invalidateQueries({ queryKey: ["user-roots", user.id] });
      pushToast("success", "Permissions updated");
    } catch (e: any) { pushToast("error", e.message); }
  };

  return (
    <Modal
      title="Storage Root Permissions"
      description={`Manage access for ${user.display_name || user.username}`}
      onClose={onClose}
    >
      <div className="space-y-4 py-2">
        {isError ? (
          <QueryError message="Could not load permissions." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="py-4"><SkeletonList /></div>
        ) : (data?.roots || []).length === 0 ? (
          <EmptyState title="No roots configured" description="Create storage roots first." />
        ) : (
          <div className="divide-y divide-border/50 border border-border/50 rounded-xl overflow-hidden">
            {(data?.roots || []).map((r) => {
              const Icon = rootIcon(r.icon);
              return (
                <div key={r.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-surface/30 hover:bg-surface/60 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 rounded-lg bg-surface flex items-center justify-center border border-border/50 shadow-sm shrink-0">
                      <Icon className="h-5 w-5 text-content-muted" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-content truncate flex items-center gap-2">
                        {r.name}
                        {r.read_only && <span className="text-[10px] font-bold uppercase tracking-wider bg-warning/10 text-warning px-1.5 py-0.5 rounded">RO</span>}
                      </p>
                      <p className="text-xs text-content-muted font-mono truncate">{r.path}</p>
                    </div>
                  </div>
                  <select
                    value={r.granted ? r.permission : "none"}
                    onChange={(e) => set(r.id, e.target.value === "none" ? null : e.target.value)}
                    className={`text-sm rounded-lg border px-3 py-2 outline-none font-medium shrink-0 cursor-pointer
                      ${r.granted ? 'bg-accent/10 border-accent/20 text-accent' : 'bg-surface border-border text-content-muted'}`}
                  >
                    <option value="none">No Access</option>
                    <option value="read">Read Only</option>
                    {!r.read_only && <option value="write">Read & Write</option>}
                  </select>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

function AuditTab() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["audit"], queryFn: () => adminApi.listAudit(200) });
  const items = data?.items || [];

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex items-center gap-4 glass-strong p-4 rounded-2xl border border-border/50">
        <div className="h-12 w-12 rounded-full bg-accent/10 flex items-center justify-center text-accent">
          <Clock className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-lg font-bold">System Audit Log</h2>
          <p className="text-sm text-content-muted">Track all administrative and security events</p>
        </div>
      </div>

      <div className="glass-strong rounded-2xl border border-border/50 overflow-hidden shadow-sm">
        {isError ? (
          <div className="p-6"><QueryError message="Could not load audit log." onRetry={() => refetch()} /></div>
        ) : isLoading ? (
          <div className="p-6"><SkeletonList /></div>
        ) : items.length === 0 ? (
          <div className="p-10"><EmptyState title="No audit entries" description="System events will appear here." /></div>
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-sm text-left">
              <thead className="bg-surface/50 border-b border-border/50 text-xs uppercase font-semibold text-content-muted">
                <tr>
                  <th className="px-6 py-4">Action</th>
                  <th className="px-6 py-4">Details</th>
                  <th className="px-6 py-4">Actor</th>
                  <th className="px-6 py-4 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {items.map((a: AuditItem) => (
                  <tr key={a.id} className="hover:bg-surface/30 transition-colors">
                    <td className="px-6 py-4">
                      <AuditBadge action={a.action} />
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-medium text-content">{a.target}</p>
                      {a.detail && <p className="text-xs text-content-muted mt-1">{a.detail}</p>}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-medium">{a.user_id || "Anonymous"}</span>
                        <span className="text-xs text-content-muted font-mono mt-0.5">{a.ip}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="text-xs font-medium text-content-muted whitespace-nowrap">{formatDate(a.created_at)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsTab() {
  const viewMode = useUI((s) => s.viewMode);
  const setViewMode = useUI((s) => s.setViewMode);
  const pushToast = useUI((s) => s.pushToast);
  const qc = useQueryClient();
  const [accent, setAccentLocal] = useState(() => localStorage.getItem("accent-theme") || "midnight");
  const applyTheme = (t: string) => {
    setAccentTheme(t);
    setAccentLocal(t);
  };
  const { data: ver } = useQuery({ queryKey: ["version"], queryFn: () => versionApi.get() });
  const { data: settingsData, isLoading: settingsLoading, isError: settingsError, refetch: refetchSettings } = useQuery({ queryKey: ["admin-settings"], queryFn: () => adminApi.getSettings() });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingCat, setSavingCat] = useState<string | null>(null);
  const [resettingKey, setResettingKey] = useState<string | null>(null);

  const grouped = (() => {
    const m: Record<string, import("../api/types").SystemSetting[]> = {};
    for (const s of settingsData?.settings || []) {
      if (!m[s.category]) m[s.category] = [];
      m[s.category].push(s);
    }
    return m;
  })();

  const categoryMeta: Record<string, { label: string; icon: React.ReactNode; desc: string }> = {
    general: { label: "General", icon: <Globe className="h-4 w-4" />, desc: "Base URL and registration" },
    security: { label: "Security", icon: <Lock className="h-4 w-4" />, desc: "Sessions, rate limits and access controls" },
    storage: { label: "Storage & Uploads", icon: <HardDrive className="h-4 w-4" />, desc: "Upload limits, thumbnails and MIME rules" },
    maintenance: { label: "Maintenance", icon: <Wrench className="h-4 w-4" />, desc: "Trash, uploads and backups" },
    search: { label: "Search & Extraction", icon: <Search className="h-4 w-4" />, desc: "Full-text extraction and OCR" },
    versioning: { label: "Versioning", icon: <History className="h-4 w-4" />, desc: "Snapshot retention and caps" },
  };
  const categoryOrder = ["general", "security", "storage", "maintenance", "search", "versioning"];

  const isDirty = (key: string) => key in edits;
  const currentValue = (key: string, fallback: string) => (key in edits ? edits[key] : fallback);

  const saveCategory = async (cat: string) => {
    const keys = (grouped[cat] || []).filter((s: any) => s.key in edits).map((s: any) => s.key);
    if (keys.length === 0) return;
    const payload: Record<string, string> = {};
    for (const k of keys) payload[k] = edits[k];
    setSavingCat(cat);
    try {
      await adminApi.updateSettings(payload);
      pushToast("success", `${categoryMeta[cat]?.label || cat} updated`);
      setEdits((prev) => {
        const next = { ...prev };
        for (const k of keys) delete next[k];
        return next;
      });
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
    } catch (e: any) {
      pushToast("error", e.message || "Failed to save");
    } finally {
      setSavingCat(null);
    }
  };

  const saveAll = async () => {
    if (Object.keys(edits).length === 0) return;
    setSavingCat("__all");
    try {
      await adminApi.updateSettings(edits);
      pushToast("success", "Settings saved");
      setEdits({});
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
    } catch (e: any) {
      pushToast("error", e.message || "Failed to save");
    } finally {
      setSavingCat(null);
    }
  };

  const resetKey = async (key: string) => {
    setResettingKey(key);
    try {
      await adminApi.deleteSetting(key);
      pushToast("success", `${key} reset to default`);
      setEdits((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
    } catch (e: any) {
      pushToast("error", e.message || "Reset failed");
    } finally {
      setResettingKey(null);
    }
  };

  const hasAnyEdits = Object.keys(edits).length > 0;

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Preferences + System Info top row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="glass-strong rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-6">
            <div className="p-1.5 rounded-lg bg-accent/10 text-accent"><Sun className="h-4 w-4" /></div>
            <h3 className="font-bold text-lg">Preferences</h3>
          </div>
          <div className="space-y-6">
            <div>
              <p className="text-xs font-bold text-content-muted uppercase tracking-wider mb-3">Default View Mode</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setViewMode("list")}
                  className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border transition-all duration-200
                    ${viewMode === "list"
                      ? "bg-accent/10 border-accent/30 text-accent shadow-sm"
                      : "bg-surface border-border/50 text-content-muted hover:text-content hover:bg-surface-muted"}`}
                >
                  <List className="h-4 w-4" /> <span className="text-sm font-medium">List View</span>
                </button>
                <button
                  onClick={() => setViewMode("grid")}
                  className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border transition-all duration-200
                    ${viewMode === "grid"
                      ? "bg-accent/10 border-accent/30 text-accent shadow-sm"
                      : "bg-surface border-border/50 text-content-muted hover:text-content hover:bg-surface-muted"}`}
                >
                  <LayoutGrid className="h-4 w-4" /> <span className="text-sm font-medium">Grid View</span>
                </button>
              </div>
            </div>
            <div>
              <p className="text-xs font-bold text-content-muted uppercase tracking-wider mb-3">Accent Theme</p>
              <div className="grid grid-cols-2 gap-2">
                {accentThemes.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => applyTheme(t.id)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-200 ${
                      accent === t.id
                        ? "bg-accent/10 border-accent/30 shadow-sm"
                        : "bg-surface border-border/50 text-content-muted hover:text-content hover:bg-surface-muted"
                    }`}
                  >
                    <div className="flex gap-0.5">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: t.colors[0] }} />
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: t.colors[1] }} />
                    </div>
                    <span className="text-sm font-medium capitalize">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="glass-strong rounded-2xl p-6 border border-border/50 shadow-sm relative overflow-hidden h-fit">
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, currentColor 1px, transparent 0)', backgroundSize: '16px 16px' }} />
          <div className="flex items-center gap-2 mb-5 relative z-10">
            <div className="p-1.5 rounded-lg bg-accent/10 text-accent"><Server className="h-4 w-4" /></div>
            <h3 className="font-bold text-lg">System Information</h3>
          </div>
          <dl className="space-y-4 relative z-10">
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <dt className="text-sm text-content-muted">Product</dt>
              <dd className="font-semibold text-content">{ver?.product || "Nexora"}</dd>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <dt className="text-sm text-content-muted">Version</dt>
              <dd className="font-mono text-xs font-semibold px-2 py-1 rounded bg-surface border border-border/50">{ver?.version || "dev"}</dd>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <dt className="text-sm text-content-muted">Runtime</dt>
              <dd className="font-mono text-xs font-semibold px-2 py-1 rounded bg-surface border border-border/50">{ver?.go || "—"}</dd>
            </div>
            <div className="flex justify-between items-center py-2">
              <dt className="text-sm text-content-muted">Transcoding</dt>
              <dd className="text-xs font-semibold px-2 py-1 rounded bg-surface border border-border/50">{ver?.transcode ? "Available" : "Off"}</dd>
            </div>
          </dl>
        </section>
      </div>

      {/* Server settings */}
      <section className="glass-strong rounded-2xl border border-border/50 shadow-sm overflow-hidden">
        <div className="p-6 pb-4 border-b border-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent"><SlidersHorizontal className="h-5 w-5" /></div>
            <div>
              <h3 className="font-bold text-lg leading-tight">Server Settings</h3>
              <p className="text-xs text-content-muted">DB-backed overrides for NEXORA_* — changes are audited and live-reloaded</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => refetchSettings()} icon={<RefreshCw className="h-4 w-4" />}>Refresh</Button>
            <Button variant="primary" size="sm" onClick={saveAll} disabled={!hasAnyEdits} loading={savingCat === "__all"} icon={<Save className="h-4 w-4" />}>Save all</Button>
          </div>
        </div>

        <div className="p-6">
          {settingsError ? (
            <QueryError message="Could not load settings." onRetry={() => refetchSettings()} />
          ) : settingsLoading ? (
            <SkeletonList />
          ) : (
            <div className="space-y-8">
              {categoryOrder.map((cat) => {
                const items = grouped[cat] || [];
                if (items.length === 0) return null;
                const meta = categoryMeta[cat];
                const catDirty = items.some((s: any) => s.key in edits);
                return (
                  <div key={cat} className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-lg bg-accent/10 text-accent">{meta.icon}</div>
                        <div>
                          <h4 className="font-bold text-content">{meta.label}</h4>
                          <p className="text-xs text-content-muted">{meta.desc}</p>
                        </div>
                      </div>
                      <Button variant="secondary" size="sm" disabled={!catDirty} loading={savingCat === cat} onClick={() => saveCategory(cat)} icon={<Save className="h-3.5 w-3.5" />}>Save</Button>
                    </div>
                    <div className="grid gap-4">
                      {items.map((s: any) => {
                        const val = currentValue(s.key, s.value);
                        const dirty = isDirty(s.key);
                        return (
                          <div key={s.key} className={`rounded-xl border p-4 transition-all ${dirty ? "bg-accent/5 border-accent/30 shadow-sm" : "bg-surface/50 border-border/40 hover:border-border/60"}`}>
                            <div className="flex items-start justify-between gap-3 mb-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-sm text-content">{s.label}</span>
                                  {s.is_overridden && <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/20">Overridden</span>}
                                  {s.requires_restart && <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-warning/15 text-warning border border-warning/20">Restart</span>}
                                  {dirty && <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-warning/15 text-warning border border-warning/20">Modified</span>}
                                </div>
                                <p className="text-xs text-content-muted mt-1 leading-relaxed">{s.description}</p>
                                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                                  <span className="text-[10px] font-mono text-content-muted bg-surface px-1.5 py-0.5 rounded border border-border/30">{s.env}</span>
                                  <span className="text-[11px] text-content-muted">Default: <span className="font-mono text-content">{s.default || "—"}</span></span>
                                  <span className="text-[11px] text-content-muted">Effective: <span className="font-mono text-accent">{s.effective}</span></span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {s.is_overridden && (
                                  <button onClick={() => resetKey(s.key)} disabled={resettingKey === s.key} className="p-2 rounded-lg glass-hover text-content-muted hover:text-warning hover:bg-warning/10 transition-colors" title="Revert to default" aria-label={`Reset ${s.key}`}>
                                    <RotateCcw className={`h-3.5 w-3.5 ${resettingKey === s.key ? "animate-spin" : ""}`} />
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-3 items-center">
                              {s.type === "bool" ? (
                                <div className="flex rounded-xl border border-border/50 overflow-hidden bg-surface">
                                  <button onClick={() => setEdits((p) => ({ ...p, [s.key]: "true" }))} className={`px-4 py-2 text-sm font-medium transition-colors ${val === "true" ? "bg-accent text-accent-foreground shadow-sm" : "text-content-muted hover:text-content"}`}>True</button>
                                  <button onClick={() => setEdits((p) => ({ ...p, [s.key]: "false" }))} className={`px-4 py-2 text-sm font-medium transition-colors ${val === "false" ? "bg-accent text-accent-foreground shadow-sm" : "text-content-muted hover:text-content"}`}>False</button>
                                </div>
                              ) : s.type === "int" ? (
                                <Input type="number" value={val} onChange={(e) => setEdits((p) => ({ ...p, [s.key]: e.target.value }))} className="flex-1" placeholder={s.default} />
                              ) : (
                                <Input value={val} onChange={(e) => setEdits((p) => ({ ...p, [s.key]: e.target.value }))} className="flex-1 font-mono text-sm" placeholder={s.default || "—"} />
                              )}
                              {dirty && (
                                <button onClick={() => setEdits((p) => { const n = { ...p }; delete n[s.key]; return n; })} className="text-xs text-content-muted hover:text-content underline shrink-0">Undo</button>
                              )}
                            </div>
                            {(s.type === "bytes" || s.type === "duration" || s.type === "list") && (
                              <p className="text-[11px] text-content-muted mt-2">
                                {s.type === "bytes" && "Accepts bytes or human sizes like 512MB, 2GB, 256KB."}
                                {s.type === "duration" && "Go duration with day support: 30d, 168h, 15m, 24h, 0 = disabled."}
                                {s.type === "list" && "Comma-separated — empty = allow all / disabled."}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {hasAnyEdits && (
                <div className="sticky bottom-4 glass-strong rounded-xl border border-accent/30 p-4 flex items-center justify-between shadow-lg">
                  <span className="text-sm font-medium text-content">{Object.keys(edits).length} unsaved change{Object.keys(edits).length !== 1 ? "s" : ""}</span>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEdits({})}>Discard</Button>
                    <Button variant="primary" size="sm" onClick={saveAll} loading={savingCat === "__all"} icon={<Save className="h-4 w-4" />}>Save all</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}