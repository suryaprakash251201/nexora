import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, Smartphone, ShieldAlert, Loader2 } from "lucide-react";
import { Button } from "./ui/Button";
import { authApi } from "../api/endpoints";
import type { SessionInfo } from "../api/endpoints";
import { formatRelative } from "../lib/format";
import { useUI } from "../store";

/** Very small UA classifier for a friendly device label. */
function deviceLabel(ua: string): { label: string; Icon: typeof Monitor } {
  const s = ua.toLowerCase();
  if (/iphone|android.*mobile|phone/.test(s)) return { label: "Phone", Icon: Smartphone };
  if (/ipad|tablet|android/.test(s)) return { label: "Tablet", Icon: Smartphone };
  if (!ua) return { label: "Unknown device", Icon: Monitor };
  if (/curl|wget|python|node/.test(s)) return { label: "Script / API", Icon: ShieldAlert };
  const browser = /edg\//.test(s) ? "Edge" : /chrome|crios/.test(s) ? "Chrome" : /firefox|fxios/.test(s) ? "Firefox" : /safari/.test(s) ? "Safari" : "";
  const os = /windows/.test(s) ? "Windows" : /mac os|macintosh/.test(s) ? "macOS" : /linux/.test(s) ? "Linux" : /android/.test(s) ? "Android" : /iphone|ipad|ios/.test(s) ? "iOS" : "";
  return { label: [browser, os].filter(Boolean).join(" · ") || "Browser", Icon: Monitor };
}

/**
 * Body for the "Active Sessions" settings view — lists the signed-in user's
 * live sessions with revoke actions. Current session is badged and cannot be
 * revoked here (use Logout).
 */
export function SessionsBody() {
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const [busyId, setBusyId] = useState<string | null>(null);
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: () => authApi.sessions.list(),
    select: (d) => d.items,
  });

  const act = async (fn: () => Promise<unknown>, id: string | "others", okMsg: string) => {
    setBusyId(id);
    try {
      await fn();
      pushToast("success", okMsg);
      await qc.invalidateQueries({ queryKey: ["sessions"] });
    } catch (e: any) {
      pushToast("error", e.message || "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  const items: SessionInfo[] = sessions.data ?? [];
  const others = items.filter((s) => !s.is_current);

  return (
    <div className="space-y-4">
      <p className="text-sm text-content-muted">Devices currently signed in to your account.</p>
      <div className="flex items-center justify-end">
        <Button
          variant="danger"
          size="sm"
          loading={busyId === "others"}
          disabled={others.length === 0}
          onClick={() => act(() => authApi.sessions.revokeOthers(), "others", `Revoked ${others.length} other session${others.length === 1 ? "" : "s"}`)}
        >
          Revoke all others
        </Button>
      </div>
      {sessions.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-content-muted" /></div>
      ) : items.length === 0 ? (
        <p className="text-sm text-content-muted py-4">No active sessions found.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((s) => {
            const { label, Icon } = deviceLabel(s.user_agent || "");
            return (
              <li
                key={s.id}
                className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 ${
                  s.is_current ? "border-accent/40 bg-accent/10" : "border-glass-border bg-glass-bg-subtle"
                }`}
              >
                <Icon className="h-5 w-5 shrink-0 text-text-secondary" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{label}</span>
                    {s.is_current && (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent/20 text-accent">
                        This device
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-content-muted truncate">
                    {s.ip || "unknown ip"} · signed in {formatRelative(s.created_at) || s.created_at} · expires {formatRelative(s.expires_at) || s.expires_at}
                  </div>
                </div>
                {!s.is_current && (
                  <Button
                    variant="outline"
                    size="sm"
                    loading={busyId === s.id}
                    onClick={() => act(() => authApi.sessions.revoke(s.id), s.id, "Session revoked")}
                    aria-label={`Revoke session on ${label}`}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
