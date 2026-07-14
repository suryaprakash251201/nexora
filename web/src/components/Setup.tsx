import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { post } from "../api/client";
import { useUI } from "../store";

export default function Setup({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pushToast = useUI((s) => s.pushToast);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setBusy(true);
    try {
      await post("/auth/setup", { username, email, password, display_name: displayName });
      pushToast("success", "Admin account created");
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm glass-strong rounded-xl p-6">
        <div className="mb-6 text-center">
          <div className="mx-auto h-10 w-10 rounded-lg bg-accent grid place-items-center text-accent-fg font-bold text-lg">N</div>
          <h1 className="mt-3 text-lg font-semibold">Create your admin account</h1>
          <p className="text-sm text-content-muted">First-run setup for Nexora</p>
        </div>
        <label className="block text-sm mb-1">Username</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} className="w-full mb-3 rounded-lg bg-surface border px-3 py-2 outline-none focus:ring-2 focus:ring-accent/50" placeholder="admin" />
        <label className="block text-sm mb-1">Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full mb-3 rounded-lg bg-surface border px-3 py-2 outline-none focus:ring-2 focus:ring-accent/50" placeholder="you@example.com" />
        <label className="block text-sm mb-1">Display name (optional)</label>
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full mb-3 rounded-lg bg-surface border px-3 py-2 outline-none focus:ring-2 focus:ring-accent/50" placeholder="Admin" />
        <label className="block text-sm mb-1">Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full mb-4 rounded-lg bg-surface border px-3 py-2 outline-none focus:ring-2 focus:ring-accent/50" placeholder="••••••••" />
        {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
        <button disabled={busy} className="w-full flex items-center justify-center gap-2 rounded-lg accent-glass py-2 font-medium disabled:opacity-60">
          {busy ? <Loader2 className="animate-spin h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
          Create account
        </button>
      </form>
    </div>
  );
}
