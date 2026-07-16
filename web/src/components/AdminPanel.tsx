import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, ScrollText, RefreshCw, Plus, Shield, Settings, HardDrive, Sun, Moon, Monitor, LayoutGrid, List, Pencil, Trash2, ShieldCheck, Clock } from "lucide-react";
import { get, post, put, del } from "../api/client";
import { Modal } from "./Modal";
import RootModal from "./RootModal";
import { useUI } from "../store";
import { formatDate } from "../lib/format";
import { rootIcon } from "../lib/rootIcons";
import type { AuditItem, User, Root } from "../api/types";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { SkeletonList } from "./ui/Skeleton";
import { EmptyState } from "./ui/EmptyState";

type Tab = "users" | "audit" | "settings";

export default function AdminPanel() {
  const [tab, setTab] = useState<Tab>("users");
  
  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-background">
      {/* Header & Tabs */}
      <div className="bg-surface/50 backdrop-blur-xl border-b border-border/50 shrink-0 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="h-10 w-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Administration</h1>
              <p className="text-sm text-content-muted">Manage users, security, and system configuration</p>
            </div>
          </div>
          
          <div className="flex items-center gap-1">
            <TabButton active={tab === "users"} onClick={() => setTab("users")} icon={<Users className="h-4 w-4" />}>Users</TabButton>
            <TabButton active={tab === "audit"} onClick={() => setTab("audit")} icon={<ScrollText className="h-4 w-4" />}>Audit Log</TabButton>
            <TabButton active={tab === "settings"} onClick={() => setTab("settings")} icon={<Settings className="h-4 w-4" />}>Settings</TabButton>
          </div>
        </div>
      </div>
      
      {/* Content Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-6xl mx-auto p-6 pb-20">
          {tab === "users" ? <UsersTab /> : tab === "audit" ? <AuditTab /> : <SettingsTab />}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button 
      onClick={onClick} 
      className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium transition-all duration-200 border-b-2 
        ${active 
          ? "border-accent text-accent bg-accent/5" 
          : "border-transparent text-content-muted hover:text-content hover:bg-surface/50"}`}
    >
      {icon} {children}
    </button>
  );
}

function UsersTab() {
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const { data, isLoading } = useQuery({ queryKey: ["admin-users"], queryFn: () => get<{ users: User[] }>("/admin/users") });
  const [showCreate, setShowCreate] = useState(false);
  const [permUser, setPermUser] = useState<User | null>(null);

  const reindex = async () => {
    try { await post("/admin/search/reindex"); pushToast("success", "Reindex started in background"); }
    catch (e: any) { pushToast("error", e.message); }
  };

  const updateUser = async (id: string, body: any) => {
    try { await put(`/admin/users/${id}`, body); pushToast("success", "User updated"); qc.invalidateQueries({ queryKey: ["admin-users"] }); }
    catch (e: any) { pushToast("error", e.message); }
  };

  const removeUser = async (u: User) => {
    if (!confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    try { await del(`/admin/users/${u.id}`); pushToast("success", "User deleted"); qc.invalidateQueries({ queryKey: ["admin-users"] }); }
    catch (e: any) { pushToast("error", e.message); }
  };

  const users = data?.users || [];
  
  return (
    <div className="space-y-6 animate-slide-up">
      {/* Action Bar */}
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
      
      {/* Data Table */}
      <div className="glass-strong rounded-2xl border border-border/50 overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6"><SkeletonList /></div>
        ) : users.length === 0 ? (
          <div className="p-10"><EmptyState title="No users found" description="Create a user to get started." /></div>
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-sm text-left">
              <thead className="bg-surface/50 border-b border-border/50 text-xs uppercase font-semibold text-content-muted">
                <tr>
                  <th className="px-6 py-4 rounded-tl-2xl">User</th>
                  <th className="px-6 py-4">Role</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right rounded-tr-2xl">Actions</th>
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
                      <select 
                        value={u.role} 
                        onChange={(e) => updateUser(u.id, { role: e.target.value })} 
                        className="text-sm rounded-lg glass-input px-3 py-1.5 outline-none font-medium cursor-pointer"
                      >
                        <option value="admin">Admin</option>
                        <option value="user">User</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      <select 
                        value={u.status} 
                        onChange={(e) => updateUser(u.id, { status: e.target.value })} 
                        className={`text-sm rounded-lg border px-3 py-1.5 outline-none font-medium cursor-pointer
                          ${u.status === 'active' ? 'bg-success/10 text-success border-success/20' : 'bg-surface-muted text-content-muted border-border'}`}
                      >
                        <option value="active">Active</option>
                        <option value="disabled">Disabled</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => setPermUser(u)} 
                          className="p-2 rounded-lg glass-hover text-accent hover:bg-accent/10 transition-colors" 
                          title="Manage Root Access"
                        >
                          <Shield className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => removeUser(u)} 
                          className="p-2 rounded-lg glass-hover text-danger hover:bg-danger/10 transition-colors" 
                          title="Delete User"
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
      await post("/admin/users", form); 
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
  const { data, isLoading } = useQuery({ queryKey: ["user-roots", user.id], queryFn: () => get<{ roots: any[] }>(`/admin/users/${user.id}/roots`) });
  
  const set = async (rootId: string, permission: string | null) => {
    try {
      if (permission === null) await del(`/admin/users/${user.id}/roots/${rootId}`);
      else await post(`/admin/users/${user.id}/roots`, { root_id: rootId, permission });
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
        {isLoading ? (
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
  const { data, isLoading } = useQuery({ queryKey: ["audit"], queryFn: () => get<{ items: AuditItem[] }>("/admin/audit", { limit: 200 }) });
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
        {isLoading ? (
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
                {items.map((a) => (
                  <tr key={a.id} className="hover:bg-surface/30 transition-colors">
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 rounded-md bg-surface border border-border/50 text-xs font-mono font-bold shadow-sm inline-block">
                        {a.action}
                      </span>
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
  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const viewMode = useUI((s) => s.viewMode);
  const setViewMode = useUI((s) => s.setViewMode);
  const pushToast = useUI((s) => s.pushToast);
  const qc = useQueryClient();
  const { data: ver } = useQuery({ queryKey: ["version"], queryFn: () => get<{ version: string; go: string; product: string; tagline: string }>("/version") });
  const { data: roots, isLoading: rootsLoading } = useQuery({ queryKey: ["roots-admin"], queryFn: () => get<{ roots: Root[] }>("/roots") });
  const [editRoot, setEditRoot] = useState<Root | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const removeRoot = async (r: Root) => {
    if (!confirm(`Delete storage root "${r.name}"? This cannot be undone.`)) return;
    try { await del(`/admin/roots/${r.id}`); pushToast("success", "Storage root deleted"); qc.invalidateQueries({ queryKey: ["roots-admin"] }); qc.invalidateQueries({ queryKey: ["roots"] }); }
    catch (e: any) { pushToast("error", e.message); }
  };

  const themeOpts = [
    { key: "light" as const, label: "Light", icon: <Sun className="h-4 w-4" /> },
    { key: "dark" as const, label: "Dark", icon: <Moon className="h-4 w-4" /> },
    { key: "system" as const, label: "System", icon: <Monitor className="h-4 w-4" /> },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-slide-up">
      
      {/* Left Column - Preferences & System */}
      <div className="space-y-6 lg:col-span-1">
        <section className="glass-strong rounded-2xl p-6 border border-border/50 shadow-sm">
          <div className="flex items-center gap-2 mb-6">
            <div className="p-1.5 rounded-lg bg-accent/10 text-accent"><Sun className="h-4 w-4" /></div>
            <h3 className="font-bold text-lg">Appearance</h3>
          </div>
          
          <div className="space-y-6">
            <div>
              <p className="text-xs font-bold text-content-muted uppercase tracking-wider mb-3">Color Theme</p>
              <div className="grid grid-cols-3 gap-2">
                {themeOpts.map((o) => (
                  <button
                    key={o.key}
                    onClick={() => setTheme(o.key)}
                    className={`flex flex-col items-center justify-center gap-2 p-3 rounded-xl border transition-all duration-200
                      ${theme === o.key 
                        ? "bg-accent/10 border-accent/30 text-accent shadow-sm" 
                        : "bg-surface border-border/50 text-content-muted hover:text-content hover:bg-surface-muted"}`}
                  >
                    {o.icon} 
                    <span className="text-xs font-medium">{o.label}</span>
                  </button>
                ))}
              </div>
            </div>
            
            <div className="pt-6 border-t border-border/50">
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
          </div>
        </section>

        <section className="glass-strong rounded-2xl p-6 border border-border/50 shadow-sm relative overflow-hidden">
          {/* Subtle tech background pattern */}
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, currentColor 1px, transparent 0)', backgroundSize: '16px 16px' }} />
          
          <h3 className="font-bold text-lg mb-5 relative z-10">System Information</h3>
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
          </dl>
        </section>
      </div>

      {/* Right Column - Storage Roots */}
      <div className="lg:col-span-2">
        <section className="glass-strong rounded-2xl border border-border/50 shadow-sm flex flex-col h-full">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 border-b border-border/50 shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-accent/10 text-accent"><HardDrive className="h-5 w-5" /></div>
              <div>
                <h3 className="font-bold text-lg">Storage Roots</h3>
                <p className="text-sm text-content-muted">Configure server directories accessible via the app</p>
              </div>
            </div>
            <Button variant="primary" onClick={() => setShowCreate(true)} icon={<Plus className="h-4 w-4" />}>
              Add Root
            </Button>
          </div>
          
          <div className="flex-1 p-6">
            {rootsLoading ? (
              <SkeletonList />
            ) : (!roots?.roots || roots.roots.length === 0) ? (
              <EmptyState title="No storage roots" description="Add a directory from your server to start serving files." />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(roots?.roots || []).map((r) => {
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
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="bg-surface/50 rounded-lg p-2.5 mb-4 border border-border/30">
                        <p className="text-xs font-mono text-content-muted truncate" title={r.path}>{r.path}</p>
                      </div>
                      
                      <div className="mt-auto flex gap-2">
                        <Button variant="secondary" size="sm" className="flex-1" onClick={() => setEditRoot(r)} icon={<Pencil className="h-3.5 w-3.5" />}>
                          Edit
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => removeRoot(r)} className="px-3">
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
      </div>

      {showCreate && <RootModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ["roots-admin"] }); qc.invalidateQueries({ queryKey: ["roots"] }); }} />}
      {editRoot && <RootModal root={editRoot} onClose={() => setEditRoot(null)} onDone={() => { setEditRoot(null); qc.invalidateQueries({ queryKey: ["roots-admin"] }); qc.invalidateQueries({ queryKey: ["roots"] }); }} />}
    </div>
  );
}
