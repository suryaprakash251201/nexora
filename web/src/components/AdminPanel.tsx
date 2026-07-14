import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, ScrollText, RefreshCw, Plus, Shield, Settings, HardDrive, Sun, Moon, Monitor, LayoutGrid, List, Pencil, Trash2 } from "lucide-react";
import { get, post, put, del } from "../api/client";
import { Modal } from "./Modal";
import RootModal from "./RootModal";
import { useUI } from "../store";
import { formatDate } from "../lib/format";
import { rootIcon } from "../lib/rootIcons";
import type { AuditItem, User, Root } from "../api/types";

type Tab = "users" | "audit" | "settings";

export default function AdminPanel() {
  const [tab, setTab] = useState<Tab>("users");
  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="border-b flex items-center gap-1 px-4 glass-divider">
        <TabButton active={tab === "users"} onClick={() => setTab("users")} icon={<Users className="h-4 w-4" />}>Users</TabButton>
        <TabButton active={tab === "audit"} onClick={() => setTab("audit")} icon={<ScrollText className="h-4 w-4" />}>Audit log</TabButton>
        <TabButton active={tab === "settings"} onClick={() => setTab("settings")} icon={<Settings className="h-4 w-4" />}>Settings</TabButton>
      </div>
      {tab === "users" ? <UsersTab /> : tab === "audit" ? <AuditTab /> : <SettingsTab />}
    </div>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2 px-3 py-3 text-sm border-b-2 ${active ? "border-accent text-accent" : "border-transparent text-content-muted hover:text-content"}`}>
      {icon} {children}
    </button>
  );
}

function UsersTab() {
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const { data } = useQuery({ queryKey: ["admin-users"], queryFn: () => get<{ users: User[] }>("/admin/users") });
  const [showCreate, setShowCreate] = useState(false);
  const [permUser, setPermUser] = useState<User | null>(null);

  const reindex = async () => {
    try { await post("/admin/search/reindex"); pushToast("success", "Reindex started"); }
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
    <div className="flex-1 overflow-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Users</h2>
        <div className="flex gap-2">
          <button onClick={reindex} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border text-sm glass-hover"><RefreshCw className="h-4 w-4" /> Reindex search</button>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg accent-glass text-sm"><Plus className="h-4 w-4" /> New user</button>
        </div>
      </div>
      <div className="glass rounded-lg divide-y glass-divider">
        {users.map((u) => (
          <div key={u.id} className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center px-3 py-2">
            <div className="min-w-0">
              <p className="font-medium truncate">{u.display_name || u.username}</p>
              <p className="text-xs text-content-muted truncate">{u.email}</p>
            </div>
            <select value={u.role} onChange={(e) => updateUser(u.id, { role: e.target.value })} className="text-sm rounded-lg bg-surface border px-2 py-1 outline-none">
              <option value="admin">Admin</option>
              <option value="user">User</option>
              <option value="viewer">Viewer</option>
            </select>
            <select value={u.status} onChange={(e) => updateUser(u.id, { status: e.target.value })} className="text-sm rounded-lg bg-surface border px-2 py-1 outline-none">
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
            <div className="flex gap-1">
              <button onClick={() => setPermUser(u)} className="p-2 rounded-lg glass-hover" title="Root access"><Shield className="h-4 w-4" /></button>
              <button onClick={() => removeUser(u)} className="px-2 py-1 rounded-lg text-red-500 hover:bg-red-500/10 text-sm">Delete</button>
            </div>
          </div>
        ))}
      </div>
      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ["admin-users"] }); }} />}
      {permUser && <PermModal user={permUser} onClose={() => setPermUser(null)} />}
    </div>
  );
}

function CreateUserModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const pushToast = useUI((s) => s.pushToast);
  const [form, setForm] = useState({ username: "", email: "", password: "", display_name: "", role: "user" });
  const submit = async () => {
    try { await post("/admin/users", form); pushToast("success", "User created"); onDone(); }
    catch (e: any) { pushToast("error", e.message); }
  };
  const upd = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Modal title="Create user" onClose={onClose} footer={<button onClick={submit} className="px-3 py-1.5 rounded-lg accent-glass text-sm">Create</button>}>
      <div className="space-y-3">
        <input value={form.username} onChange={(e) => upd("username", e.target.value)} placeholder="Username" className="w-full rounded-lg bg-surface border px-3 py-2 outline-none" />
        <input value={form.email} onChange={(e) => upd("email", e.target.value)} placeholder="Email" className="w-full rounded-lg bg-surface border px-3 py-2 outline-none" />
        <input type="password" value={form.password} onChange={(e) => upd("password", e.target.value)} placeholder="Password (min 8 chars)" className="w-full rounded-lg bg-surface border px-3 py-2 outline-none" />
        <select value={form.role} onChange={(e) => upd("role", e.target.value)} className="w-full rounded-lg bg-surface border px-3 py-2 outline-none">
          <option value="user">User</option>
          <option value="viewer">Viewer</option>
          <option value="admin">Admin</option>
        </select>
      </div>
    </Modal>
  );
}

function PermModal({ user, onClose }: { user: User; onClose: () => void }) {
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const { data } = useQuery({ queryKey: ["user-roots", user.id], queryFn: () => get<{ roots: any[] }>(`/admin/users/${user.id}/roots`) });
  const set = async (rootId: string, permission: string | null) => {
    try {
      if (permission === null) await del(`/admin/users/${user.id}/roots/${rootId}`);
      else await post(`/admin/users/${user.id}/roots`, { root_id: rootId, permission });
      qc.invalidateQueries({ queryKey: ["user-roots", user.id] });
    } catch (e: any) { pushToast("error", e.message); }
  };
  return (
    <Modal title={`Root access — ${user.username}`} onClose={onClose}>
      <div className="space-y-2">
        {(data?.roots || []).map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2">
            <span className="truncate">{r.name}{r.read_only && <span className="text-xs text-content-muted"> (ro)</span>}</span>
            <select
              value={r.granted ? r.permission : "none"}
              onChange={(e) => set(r.id, e.target.value === "none" ? null : e.target.value)}
              className="text-sm rounded-lg bg-surface border px-2 py-1 outline-none"
            >
              <option value="none">No access</option>
              <option value="read">Read</option>
              {!r.read_only && <option value="write">Write</option>}
            </select>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function AuditTab() {
  const { data, isLoading } = useQuery({ queryKey: ["audit"], queryFn: () => get<{ items: AuditItem[] }>("/admin/audit", { limit: 200 }) });
  const items = data?.items || [];
  return (
    <div className="flex-1 overflow-auto p-4">
      <h2 className="text-lg font-semibold mb-4">Audit log</h2>
      {isLoading && <p className="text-content-muted">Loading…</p>}
      <div className="glass rounded-lg divide-y glass-divider text-sm">
        {items.map((a) => (
          <div key={a.id} className="grid grid-cols-[auto_1fr_auto] gap-3 items-center px-3 py-2">
            <span className="px-1.5 py-0.5 rounded glass-chip text-xs font-mono">{a.action}</span>
            <div className="min-w-0">
              <p className="truncate">{a.target}{a.detail ? ` — ${a.detail}` : ""}</p>
              <p className="text-xs text-content-muted">{a.user_id || "anonymous"} · {a.ip}</p>
            </div>
            <span className="text-xs text-content-muted whitespace-nowrap">{formatDate(a.created_at)}</span>
          </div>
        ))}
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
  const { data: roots } = useQuery({ queryKey: ["roots-admin"], queryFn: () => get<{ roots: Root[] }>("/roots") });
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
    <div className="flex-1 overflow-auto p-4 space-y-4">
      <section className="glass rounded-xl p-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2"><Sun className="h-4 w-4" /> Appearance</h3>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-content-muted mb-2">Theme</p>
            <div className="inline-flex rounded-lg border overflow-hidden glass">
              {themeOpts.map((o) => (
                <button
                  key={o.key}
                  onClick={() => setTheme(o.key)}
                  className={`flex items-center gap-1 px-3 py-1.5 text-sm ${theme === o.key ? "bg-accent/15 text-accent" : "glass-hover"}`}
                >
                  {o.icon} {o.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm text-content-muted mb-2">Default file view</p>
            <div className="inline-flex rounded-lg border overflow-hidden glass">
              <button
                onClick={() => setViewMode("list")}
                className={`flex items-center gap-1 px-3 py-1.5 text-sm ${viewMode === "list" ? "bg-accent/15 text-accent" : "glass-hover"}`}
              >
                <List className="h-4 w-4" /> List
              </button>
              <button
                onClick={() => setViewMode("grid")}
                className={`flex items-center gap-1 px-3 py-1.5 text-sm ${viewMode === "grid" ? "bg-accent/15 text-accent" : "glass-hover"}`}
              >
                <LayoutGrid className="h-4 w-4" /> Grid
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="glass rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2"><HardDrive className="h-4 w-4" /> Storage roots</h3>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg accent-glass text-sm"><Plus className="h-4 w-4" /> New</button>
        </div>
        <div className="space-y-2">
          {(roots?.roots || []).map((r) => {
            const Icon = rootIcon(r.icon);
            return (
              <div key={r.id} className="flex items-center justify-between gap-2 text-sm glass rounded-lg px-3 py-2">
                <span className="flex items-center gap-2 truncate min-w-0">
                  <Icon className="h-4 w-4 shrink-0 text-content-muted" />
                  <span className="truncate">{r.name}</span>
                  <span className="text-[11px] text-content-muted truncate">{r.path}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className={`text-[11px] ${r.enabled === false ? "text-content-muted" : r.read_only ? "text-amber-500" : "text-emerald-500"}`}>
                    {r.enabled === false ? "Disabled" : r.read_only ? "Read-only" : "Read & write"}
                  </span>
                  <button onClick={() => setEditRoot(r)} className="p-1.5 rounded-lg glass-hover" title="Edit"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => removeRoot(r)} className="p-1.5 rounded-lg glass-hover text-red-500 hover:bg-red-500/10" title="Delete"><Trash2 className="h-4 w-4" /></button>
                </span>
              </div>
            );
          })}
          {(!roots?.roots || roots.roots.length === 0) && <p className="text-sm text-content-muted">No storage roots configured.</p>}
        </div>
      </section>

      <section className="glass rounded-xl p-4">
        <h3 className="font-semibold mb-3">System</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-content-muted">Product</dt>
          <dd>{ver?.product || "Nexora"}</dd>
          <dt className="text-content-muted">Version</dt>
          <dd>{ver?.version || "dev"}</dd>
          <dt className="text-content-muted">Runtime</dt>
          <dd>{ver?.go || "—"}</dd>
        </dl>
      </section>

      {showCreate && <RootModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ["roots-admin"] }); qc.invalidateQueries({ queryKey: ["roots"] }); }} />}
      {editRoot && <RootModal root={editRoot} onClose={() => setEditRoot(null)} onDone={() => { setEditRoot(null); qc.invalidateQueries({ queryKey: ["roots-admin"] }); qc.invalidateQueries({ queryKey: ["roots"] }); }} />}
    </div>
  );
}
