import { useState } from "react";
import { HardDrive, Cloud, Eye, EyeOff } from "lucide-react";
import { Modal } from "./Modal";
import { useUI } from "../store";
import { adminApi } from "../api/endpoints";
import { ROOT_ICONS } from "../lib/rootIcons";
import type { Root } from "../api/types";

export default function RootModal({
  root,
  onClose,
  onDone,
}: {
  root?: Root | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const pushToast = useUI((s) => s.pushToast);
  const isEdit = !!root;

  // Common fields
  const [name, setName] = useState(root?.name || "");
  const [icon, setIcon] = useState(root?.icon || "hard-drive");
  const [type, setType] = useState<"local" | "s3">(root?.type || "local");
  const [readOnly, setReadOnly] = useState(root?.read_only || false);
  const [enabled, setEnabled] = useState(root ? root.enabled !== false : true);

  // Local filesystem fields
  const [localPath, setLocalPath] = useState(type === "local" ? root?.path || "" : "");

  // S3 fields — parse config from existing root inline (component unmounts on close, so this runs fresh)
  const initialS3Config = root && root.type === "s3" && root.config ? (() => {
    try { return JSON.parse(root.config); } catch { return {}; }
  })() : {};
  const [s3Path, setS3Path] = useState(type === "s3" ? root?.path || "" : "");
  const [endpoint, setEndpoint] = useState(initialS3Config.endpoint || "");
  const [region, setRegion] = useState(initialS3Config.region || "");
  const [bucket, setBucket] = useState(initialS3Config.bucket || "");
  const [accessKeyId, setAccessKeyId] = useState(initialS3Config.access_key_id || "");
  const [secretAccessKey, setSecretAccessKey] = useState(initialS3Config.secret_access_key || "");
  const [prefix, setPrefix] = useState(initialS3Config.prefix || "");
  const [usePathStyle, setUsePathStyle] = useState(initialS3Config.use_path_style || false);
  const [forceListV1, setForceListV1] = useState(initialS3Config.force_list_v1 || false);
  const [showSecret, setShowSecret] = useState(false);

  // Provider-specific help text — use parsed hostname to avoid substring
  // matching bypasses (e.g. "evil.com?s3.amazonaws.com").
  const providerHint = (() => {
    if (!endpoint) return "Select an endpoint format above";
    let hostname = "";
    try { hostname = new URL(endpoint).hostname; } catch { hostname = endpoint; }
    if (hostname === "s3.amazonaws.com" || hostname.endsWith(".s3.amazonaws.com")) return "AWS S3 — region matters (e.g. us-east-1)";
    if (hostname === "r2.cloudflarestorage.com" || hostname.endsWith(".r2.cloudflarestorage.com")) return "Cloudflare R2 — region is 'auto'";
    if (hostname === "localhost" || hostname === "minio" || hostname.endsWith(".minio") || endpoint.includes(":9000")) return "MinIO — enable path-style URLs below";
    return "Custom S3-compatible provider";
  })();

  const buildConfig = () => {
    if (type === "s3") {
      return JSON.stringify({
        endpoint,
        region,
        bucket,
        access_key_id: accessKeyId,
        secret_access_key: secretAccessKey,
        prefix,
        use_path_style: usePathStyle,
        force_list_v1: forceListV1,
      });
    }
    return "{}";
  };

  const run = async () => {
    const body: Record<string, any> = { name, icon, type, read_only: readOnly, enabled, indexed: true };

    if (type === "local") {
      body.path = localPath;
      body.config = "{}";
    } else {
      body.path = s3Path;
      body.config = buildConfig();
    }

    if (!body.path) {
      pushToast("error", type === "local" ? "Host path is required" : "Display path is required");
      return;
    }
    if (type === "s3") {
      if (!endpoint) { pushToast("error", "S3 endpoint is required"); return; }
      if (!bucket) { pushToast("error", "S3 bucket is required"); return; }
    }

    try {
      if (isEdit) {
        await adminApi.updateRoot(root!.id, body);
        pushToast("success", "Storage root updated");
      } else {
        await adminApi.createRoot(body as any);
        pushToast("success", "Storage root created");
      }
      onDone();
    } catch (e: any) {
      pushToast("error", e.message);
    }
  };

  const Icon = ROOT_ICONS.find((i) => i.name === icon)?.icon || HardDrive;

  return (
    <Modal
      title={isEdit ? "Edit storage root" : "New storage root"}
      onClose={onClose}
      footer={
        <button onClick={run} className="px-3 py-1.5 rounded-lg accent-glass text-sm">
          {isEdit ? "Save" : "Create"}
        </button>
      }
    >
      {/* Icon & Name row */}
      <div className="flex items-center gap-3 mb-4">
        <div className="h-12 w-12 rounded-xl grid place-items-center bg-accent/15 text-accent shrink-0">
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg bg-surface border px-3 py-2 outline-none text-sm"
            placeholder="Root name (e.g. Backups)"
          />
        </div>
      </div>

      {/* Icon Picker */}
      <label className="block text-xs font-medium text-content-muted mb-1.5">Icon</label>
      <div className="flex flex-wrap gap-1 mb-4">
        {ROOT_ICONS.map((i) => {
          const I = i.icon;
          return (
            <button
              key={i.name}
              type="button"
              onClick={() => setIcon(i.name)}
              title={i.label}
              className={`h-7 w-7 grid place-items-center rounded-lg border text-xs ${
                icon === i.name
                  ? "border-accent text-accent bg-accent/10"
                  : "border-transparent glass-hover text-content-muted"
              }`}
            >
              <I className="h-3.5 w-3.5" />
            </button>
          );
        })}
      </div>

      {/* Type Selector */}
      <label className="block text-xs font-medium text-content-muted mb-1.5">Type</label>
      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => setType("local")}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
            type === "local"
              ? "border-accent text-accent bg-accent/10"
              : "border-glass-border glass-hover text-content-muted"
          }`}
        >
          <HardDrive className="h-4 w-4" />
          Local
        </button>
        <button
          type="button"
          onClick={() => setType("s3")}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
            type === "s3"
              ? "border-accent text-accent bg-accent/10"
              : "border-glass-border glass-hover text-content-muted"
          }`}
        >
          <Cloud className="h-4 w-4" />
          S3 Compatible
        </button>
      </div>

      {/* ─── Local Fields ─── */}
      {type === "local" && (
        <>
          <label className="block text-xs font-medium text-content-muted mb-1.5">Host path</label>
          <input
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
            className="w-full mb-1 rounded-lg bg-surface border px-3 py-2 outline-none font-mono text-sm"
            placeholder="/mnt/backups"
          />
          <p className="text-[11px] text-content-muted/70 mb-2 flex items-center gap-1">
            <HardDrive className="h-3 w-3 shrink-0" />
            Directory must exist on the host / mounted volume
          </p>
        </>
      )}

      {/* ─── S3 Fields ─── */}
      {type === "s3" && (
        <div className="space-y-3">
          {/* Display path */}
          <div>
            <label className="block text-xs font-medium text-content-muted mb-1.5">Display path</label>
            <input
              value={s3Path}
              onChange={(e) => setS3Path(e.target.value)}
              className="w-full rounded-lg bg-surface border px-3 py-2 outline-none font-mono text-sm"
              placeholder="/my-bucket-files"
            />
            <p className="text-[11px] text-content-muted/70 mt-0.5">
              Visible path shown to users within Nexora
            </p>
          </div>

          {/* Quick provider presets */}
          <label className="block text-xs font-medium text-content-muted mb-1">Provider preset</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {[
              { label: "AWS S3", ep: "https://s3.amazonaws.com", reg: "us-east-1", style: false },
              { label: "R2", ep: "https://<account>.r2.cloudflarestorage.com", reg: "auto", style: false },
              { label: "MinIO", ep: "http://localhost:9000", reg: "us-east-1", style: true },
            ].map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => { setEndpoint(preset.ep); setRegion(preset.reg); setUsePathStyle(preset.style); }}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                  endpoint === preset.ep
                    ? "border-accent text-accent bg-accent/10"
                    : "border-glass-border glass-hover text-content-muted"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Endpoint */}
          <div>
            <label className="block text-xs font-medium text-content-muted mb-1.5">Endpoint *</label>
            <input
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              className="w-full rounded-lg bg-surface border px-3 py-2 outline-none font-mono text-sm"
              placeholder="https://s3.amazonaws.com"
            />
            <p className="text-[11px] text-content-muted/70 mt-0.5">{providerHint}</p>
          </div>

          {/* Region + Bucket row */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-content-muted mb-1.5">Region</label>
              <input
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full rounded-lg bg-surface border px-3 py-2 outline-none font-mono text-sm"
                placeholder="us-east-1"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-muted mb-1.5">Bucket *</label>
              <input
                value={bucket}
                onChange={(e) => setBucket(e.target.value)}
                className="w-full rounded-lg bg-surface border px-3 py-2 outline-none font-mono text-sm"
                placeholder="my-nexora-files"
              />
            </div>
          </div>

          {/* Access Key + Secret Key */}
          <div>
            <label className="block text-xs font-medium text-content-muted mb-1.5">Access Key ID</label>
            <input
              value={accessKeyId}
              onChange={(e) => setAccessKeyId(e.target.value)}
              className="w-full rounded-lg bg-surface border px-3 py-2 outline-none font-mono text-sm"
              placeholder="AKIAIOSFODNN7EXAMPLE"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-content-muted mb-1.5">Secret Access Key</label>
            <div className="relative">
              <input
                type={showSecret ? "text" : "password"}
                value={secretAccessKey}
                onChange={(e) => setSecretAccessKey(e.target.value)}
                className="w-full rounded-lg bg-surface border px-3 py-2 outline-none font-mono text-sm pr-9"
                placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-content-muted hover:text-content"
              >
                {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {/* Prefix */}
          <div>
            <label className="block text-xs font-medium text-content-muted mb-1.5">
              Prefix <span className="text-content-muted/50">(optional)</span>
            </label>
            <input
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              className="w-full rounded-lg bg-surface border px-3 py-2 outline-none font-mono text-sm"
              placeholder="nexora-files/"
            />
            <p className="text-[11px] text-content-muted/70 mt-0.5">
              Restrict to a subfolder within the bucket
            </p>
          </div>

          {/* Options row */}
          <label className="flex items-center gap-2 text-sm pt-1">
            <input
              type="checkbox"
              checked={usePathStyle}
              onChange={(e) => setUsePathStyle(e.target.checked)}
              className="rounded"
            />
            <span className="text-content-muted">Use path-style URLs (required for MinIO)</span>
          </label>
          <label className="flex items-center gap-2 text-sm pt-1">
            <input
              type="checkbox"
              checked={forceListV1}
              onChange={(e) => setForceListV1(e.target.checked)}
              className="rounded"
            />
            <span className="text-content-muted">Use ListObjects V1 (for older/compatible providers)</span>
          </label>
          {forceListV1 && (
            <p className="text-[10px] text-amber-400/80 ml-6">
              Enabled: Uses legacy ListObjects API. Disable if V2 works.
            </p>
          )}
        </div>
      )}

      {/* Options */}
      <div className="flex flex-col gap-2 mt-4 pt-3 border-t border-white/[0.06]">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} className="rounded" />
          <span className="text-content-muted">Read-only</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="rounded" />
          <span className="text-content-muted">Enabled</span>
        </label>
      </div>
    </Modal>
  );
}