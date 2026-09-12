import { useEffect, useState } from "react";
import { X, Copy, Check, TriangleAlert } from "lucide-react";
import { Modal } from "./Modal";
import { Button } from "./ui/Button";
import { getGoogleDiagnostics, isClientIdFormatValid, preloadGis } from "../lib/google";
import { isTauri } from "../lib/desktop";
import { cn } from "../lib/utils";

/**
 * Shared Google setup dialog for Calendar + Tasks. Shows live diagnostics
 * (client ID validity, current origin, library load state) because nearly
 * every "sync doesn't work" report traces back to one of these plus the
 * three Google Cloud console requirements listed inside.
 */
export function GoogleSettingsModal({ onClose, clientId, onSaved, lastError }: {
  onClose: () => void;
  clientId: string;
  onSaved: (v: string) => void;
  lastError?: { title: string; detail: string } | null;
}) {
  const [value, setValue] = useState(clientId);
  const [copied, setCopied] = useState(false);
  const [diag, setDiag] = useState(() => getGoogleDiagnostics());
  // Diagnostics must be live: the GIS script loads async (warm-loaded on
  // mount), and the token can change in another tab/panel. Refresh on
  // mount, on google-state events, and on a short poll until loaded.
  useEffect(() => {
    preloadGis();
    const refresh = () => setDiag(getGoogleDiagnostics());
    refresh();
    window.addEventListener("nexora-google-changed", refresh);
    const t = window.setInterval(refresh, 1000);
    const stop = window.setTimeout(() => window.clearInterval(t), 15000);
    return () => {
      window.removeEventListener("nexora-google-changed", refresh);
      window.clearInterval(t);
      window.clearTimeout(stop);
    };
  }, []);
  const trimmed = value.trim();
  const formatOk = trimmed.length === 0 || isClientIdFormatValid(trimmed);
  const inTauri = isTauri();

  const copyOrigin = async () => {
    try {
      await navigator.clipboard.writeText(diag.origin);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = diag.origin;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal onClose={onClose} title="Google integration">
      <div className="space-y-4 min-w-[min(460px,84vw)]">
        {lastError && (
          <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 flex gap-2.5">
            <TriangleAlert className="h-4 w-4 text-danger shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-danger">{lastError.title}</p>
              <p className="text-xs text-content-muted mt-0.5">{lastError.detail}</p>
            </div>
          </div>
        )}

        <p className="text-sm text-content-muted">
          Create an OAuth client ID (type <em>Web application</em>) in the{" "}
          <a
            className="text-accent underline"
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noreferrer"
          >
            Google Cloud console
          </a>
          , enable the Calendar + Tasks APIs, and paste the client ID here. You can also set{" "}
          <code className="font-mono text-xs">VITE_GOOGLE_CLIENT_ID</code> at build time.
        </p>
        <div>
          <label className="text-xs text-content-muted">OAuth client ID
            <input
              className={cn(
                "mt-1 w-full px-3 py-2 rounded-xl bg-background border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent",
                formatOk ? "border-border" : "border-danger/60",
              )}
              placeholder="xxxx.apps.googleusercontent.com"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          {!formatOk && (
            <p className="text-xs text-danger mt-1">
              That doesn't look like a client ID — it ends with .apps.googleusercontent.com (not a secret or API key).
            </p>
          )}
        </div>

        <div className="rounded-xl border border-border p-3 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wider text-content-muted">Diagnostics</p>
          <DiagRow label="Client ID" value={diag.clientIdSet ? (diag.clientIdValid ? `saved (${diag.clientIdSuffix})` : "saved — format invalid") : "not set"} ok={diag.clientIdValid} />
          <div className="flex items-center gap-2 text-xs">
            <span className="text-content-muted w-24 shrink-0">This origin</span>
            <code className="font-mono truncate flex-1">{diag.origin}</code>
            <button
              onClick={() => void copyOrigin()}
              className="p-1.5 rounded-lg hover:bg-accent/10 shrink-0"
              title="Copy origin"
              aria-label="Copy origin"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
          <DiagRow label="Google library" value={diag.gisLoaded ? "loaded" : "not loaded yet"} ok={diag.gisLoaded} neutral />
          <DiagRow label="Connection" value={diag.connected ? "connected" : "not connected"} ok={diag.connected} neutral />
        </div>

        <ol className="text-xs text-content-muted space-y-1.5 list-decimal list-inside">
          <li>Add the origin above <em>exactly</em> under Credentials → your client ID → Authorized JavaScript origins (scheme + host + port, no trailing slash).</li>
          <li>
            Google rejects bare IPs with “must end with a public top-level domain” —
            <em>http://10.10.10.3:8080</em> can never be saved. Instead open Nexora as{" "}
            <code className="font-mono">http://10.10.10.3.nip.io:8080</code> (magic DNS → same server, ends in .io so Google accepts it) and allowlist that, or{" "}
            <code className="font-mono">ssh -L 8080:localhost:8080 user@10.10.10.3</code> and use{" "}
            <code className="font-mono">http://localhost:8080</code>. Proper fix: serve Nexora over HTTPS on a real domain. Note: the client ID is stored per-origin, so re-paste it after switching URLs.
          </li>
          <li>Enable the <em>Google Calendar API</em> and <em>Tasks API</em> for the same project (APIs &amp; Services → Library).</li>
          <li>If the OAuth consent screen is in Testing mode, add your account under Audience → Test users.</li>
          {inTauri && (
            <li>Desktop: rebuild/install the latest app — older builds block Google's servers. The web app works without this.</li>
          )}
          <li>Allow popups for this site, then press Connect Google.</li>
        </ol>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" /> Close
          </Button>
          <Button size="sm" onClick={() => onSaved(trimmed)} disabled={trimmed.length > 0 && !formatOk}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}

function DiagRow({ label, value, ok, neutral }: { label: string; value: string; ok: boolean; neutral?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-content-muted w-24 shrink-0">{label}</span>
      <span className={cn(
        "inline-flex items-center gap-1.5 font-medium truncate",
        neutral ? "text-content" : ok ? "text-emerald-600" : "text-danger",
      )}>
        <span className={cn(
          "h-1.5 w-1.5 rounded-full shrink-0",
          neutral ? "bg-content-muted" : ok ? "bg-emerald-500" : "bg-danger",
        )} />
        <span className="truncate">{value}</span>
      </span>
    </div>
  );
}
