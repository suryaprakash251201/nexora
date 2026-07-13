import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, ScrollText, RefreshCw, Plus, Shield } from "lucide-react";
import { get, post, put, del } from "../api/client";
import { Modal } from "./Modal";
import { useUI } from "../store";
import { formatDate } from "../lib/format";
import type { AuditItem, User } from "../api/types";

type Tab = "users" | "audit";

export default function AdminPanel() {
  const [tab, setTab] = useState<Tab>("users");
  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="border-b flex items-center gap-1 px-4">
        <TabButton active={tab === "users"} onClick={() => setTab("users")} icon={<Users className="h-4 w-4" />}>Users</TabButton>
        <TabButton active={tab === "audit"} onClick={() => setTab("audit")} icon={<ScrollText className="h-4 w-4" />}>Audit log</TabButton>
      </div>
      {tab === "users" ? <UsersTab /> : <AuditTab />}
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
          <button onClick={reindex} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border text-sm hover:bg-surface-muted"><RefreshCw className="h-4 w-4" /> Reindex search</button>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-accent-fg text-sm"><Plus className="h-4 w-4" /> New user</button>
        </div>
      </div>
      <div className="border rounded-lg divide-y">
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
              <button onClick={() => setPermUser(u)} className="p-2 rounded-lg hover:bg-surface-muted" title="Root access"><Shield className="h-4 w-4" /></button>
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
    <Modal title="Create user" onClose={onClose} footer={<button onClick={submit} className="px-3 py-1.5 rounded-lg bg-accent text-accent-fg text-sm">Create</button>}>
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
      <div className="border rounded-lg divide-y text-sm">
        {items.map((a) => (
          <div key={a.id} className="grid grid-cols-[auto_1fr_auto] gap-3 items-center px-3 py-2">
            <span className="px-1.5 py-0.5 rounded bg-surface-muted text-xs font-mono">{a.action}</span>
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
