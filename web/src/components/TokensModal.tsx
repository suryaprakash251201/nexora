import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Copy, Check, Loader2, Plus } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { authApi, type TokenInfo } from "../api/endpoints";
import { formatRelative } from "../lib/format";
import { useUI } from "../store";

const EXPIRY_CHOICES = [
  { days: 0, label: "Never" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
];

/**
 * Body for the "API Tokens" settings view — create / list / revoke personal
 * "nxr_…" bearer credentials. The raw token is shown exactly once at creation.
 */
export function TokensBody() {
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const [name, setName] = useState("");
  const [days, setDays] = useState(0);
  const [creating, setCreating] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const tokens = useQuery({
    queryKey: ["api-tokens"],
    queryFn: () => authApi.tokens.list(),
    select: (d) => d.items,
  });

  const create = async () => {
    setCreating(true);
    try {
      const res = await authApi.tokens.create(name.trim() || "api-token", days);
      setFreshToken(res.token);
      setName("");
      await qc.invalidateQueries({ queryKey: ["api-tokens"] });
    } catch (e: any) {
      pushToast("error", e.message || "Could not create token");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    setBusyId(id);
    try {
      await authApi.tokens.revoke(id);
      pushToast("success", "Token revoked");
      await qc.invalidateQueries({ queryKey: ["api-tokens"] });
    } catch (e: any) {
      pushToast("error", e.message || "Revoke failed");
    } finally {
      setBusyId(null);
    }
  };

  const copyFresh = async () => {
    if (!freshToken) return;
    try {
      await navigator.clipboard.writeText(freshToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      pushToast("error", "Clipboard unavailable — copy manually");
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-content-muted">
        Personal bearer tokens for scripts and API access. Use the header{" "}
        <code className="font-mono text-xs bg-black/20 rounded px-1">Authorization: Bearer nxr_…</code>
      </p>
      {freshToken && (
        <div className="mb-4 p-3 rounded-xl border border-accent/40 bg-accent/10">
          <p className="text-xs font-medium text-accent mb-2">Copy this token now — it will not be shown again:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate text-xs font-mono bg-black/20 rounded-lg px-2.5 py-2">{freshToken}</code>
            <Button variant="secondary" size="sm" onClick={copyFresh} icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}

      {/* Create */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Token name (e.g. backup script)"
          aria-label="Token name"
        />
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          aria-label="Token expiry"
          className="glass-input rounded-xl px-2.5 py-2 text-sm shrink-0 w-full sm:w-32"
        >
          {EXPIRY_CHOICES.map((c) => (
            <option key={c.days} value={c.days}>{c.label}</option>
          ))}
        </select>
        <Button variant="primary" loading={creating} onClick={create} className="shrink-0">
          <Plus className="h-4 w-4" /> Create
        </Button>
      </div>

      {/* List */}
      {tokens.isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-content-muted" /></div>
      ) : !tokens.data?.length ? (
        <p className="text-sm text-content-muted py-4 text-center">No API tokens yet.</p>
      ) : (
        <ul className="space-y-2">
          {tokens.data.map((t: TokenInfo) => (
            <li key={t.id} className="flex items-center gap-3 rounded-xl border border-glass-border bg-glass-bg-subtle px-3.5 py-3">
              <KeyRound className="h-4 w-4 shrink-0 text-text-secondary" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{t.name}</div>
                <div className="text-xs text-content-muted truncate">
                  created {formatRelative(t.created_at) || t.created_at} ·{" "}
                  last used {t.last_used_at ? formatRelative(t.last_used_at) || t.last_used_at : "never"} ·{" "}
                  {t.expires_at ? `expires ${formatRelative(t.expires_at) || t.expires_at}` : "no expiry"}
                </div>
              </div>
              <Button variant="outline" size="sm" loading={busyId === t.id} onClick={() => revoke(t.id)} aria-label={`Revoke token ${t.name}`}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
