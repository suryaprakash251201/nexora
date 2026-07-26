import { useState } from "react";
import { HardDrive, Cloud } from "lucide-react";
import { Modal } from "./Modal";
import { useUI } from "../store";
import { post, put } from "../api/client";
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

  // S3 credential fields
  const [s3Path, setS3Path] = useState(type === "s3" ? root?.path || "" : "");
  const [endpoint, setEndpoint] = useState("");
  const [region, setRegion] = useState("");
  const [bucket, setBucket] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [prefix, setPrefix] = useState("");
  const [usePathStyle, setUsePathStyle] = useState(false);

  // Parse existing config when editing
  const [configLoaded, setConfigLoaded] = useState(false);
  if (root && !configLoaded) {
    const config = root.config ? JSON.parse(root.config) : {};
    setEndpoint(config.endpoint || "");
    setRegion(config.region || "");
    setBucket(config.bucket || "");
    setAccessKeyId(config.access_key_id || "");
    setSecretAccessKey(config.secret_access_key || "");
    setPrefix(config.prefix || "");
    setUsePathStyle(config.use_path_style || false);
    setConfigLoaded(true);

    if (type === "s3" && root.path) {
      setS3Path(root.path);
    }
  }

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
    if (type === "s3" && !endpoint) {
      pushToast("error", "S3 endpoint is required");
      return;
    }
    if (type === "s3" && !bucket) {
      pushToast("error", "S3 bucket is required");
      return;
    }

    try {
      if (isEdit) {
        await put(`/admin/roots/${root!.id}`, body);
        pushToast("success", "Storage root updated");
      } else {
        await post("/admin/roots", body);
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
      {/* Icon Picker */}
      <div className="flex items-center gap-3 mb-4">
        <div className="h-12 w-12 rounded-xl grid place-items-center bg-accent/15 text-accent">
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <label className="block text-sm mb-1">Icon</label>
          <div className="flex flex-wrap gap-1">
            {ROOT_ICONS.map((i) => {
              const I = i.icon;
              return (
                <button
                  key={i.name}
                  type="button"
                  onClick={() => setIcon(i.name)}
                  title={i.label}
                  className={`h-8 w-8 grid place-items-center rounded-lg border ${icon === i.name ? "border-accent text-accent bg-accent/10" : "border-transparent glass-hover"}`}
                >
                  <I className="h-4 w-4" />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Name */}
      <label className="block text-sm mb-1">Name</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full mb-3 rounded-lg bg-surface border px-3 py-2 outline-none"
        placeholder="Backups"
      />

      {/* Type Selector */}
      <label className="block text-sm mb-1">Type</label>
      <div className="flex gap-2 mb-3">
        <button
          type="button"
          onClick={() => setType("local")}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
            type === "local"
              ? "border-accent text-accent bg-accent/10"
              : "border-glass-border glass-hover"
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
              : "border-glass-border glass-hover"
          }`}
        >
          <Cloud className="h-4 w-4" />
          S3 Compatible
        </button>
      </div>

      {/* Local Filesystem Fields */}
      {type === "local" && (
        <>
          <label className="block text-sm mb-1">Host path</label>
          <input
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
            className="w-full mb-3 rounded-lg bg-surface border px-3 py-2 outline-none font-mono"
            placeholder="/mnt/backups"
          />
          <p className="mt-1 text-xs text-content-muted flex items-center gap-1">
            <HardDrive className="h-3 w-3" />
            The directory must exist on the host / mounted volume.
          </p>
        </>
      )}

      {/* S3 Fields */}
      {type === "s3" && (
        <>
          <label className="block text-sm mb-1">Display path</label>
          <input
            value={s3Path}
            onChange={(e) => setS3Path(e.target.value)}
            className="w-full mb-3 rounded-lg bg-surface border px-3 py-2 outline-none font-mono"
            placeholder="/my-bucket-files"
          />
          <p className="text-xs text-content-muted mb-3">
            Visible path shown to users within Nexora
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-sm mb-1">Endpoint *</label>
              <input
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                className="w-full rounded-lg bg-surface border px-3 py-2 outline-none font-mono text-sm"
                placeholder="https://s3.amazonaws.com"
              />
              <p className="text-[10px] text-content-muted mt-0.5">
                AWS S3: https://s3.amazonaws.com &nbsp;|&nbsp; R2: https://&lt;account&gt;.r2.cloudflarestorage.com &nbsp;|&nbsp; MinIO: http://localhost:9000
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1">Region</label>
                <input
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="w-full rounded-lg bg-surface border px-3 py-2 outline-none font-mono text-sm"
                  placeholder="us-east-1"
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Bucket *</label>
                <input
                  value={bucket}
                  onChange={(e) => setBucket(e.target.value)}
                  className="w-full rounded-lg bg-surface border px-3 py-2 outline-none font-mono text-sm"
                  placeholder="my-nexora-files"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm mb-1">Access Key ID</label>
              <input
                value={accessKeyId}
                onChange={(e) => setAccessKeyId(e.target.value)}
                className="w-full rounded-lg bg-surface border px-3 py-2 outline-none font-mono text-sm"
                placeholder="AKIAIOSFODNN7EXAMPLE"
              />
            </div>

            <div>
              <label className="block text-sm mb-1">Secret Access Key</label>
              <input
                type="password"
                value={secretAccessKey}
                onChange={(e) => setSecretAccessKey(e.target.value)}
                className="w-full rounded-lg bg-surface border px-3 py-2 outline-none font-mono text-sm"
                placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
              />
            </div>

            <div>
              <label className="block text-sm mb-1">Prefix (optional)</label>
              <input
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                className="w-full rounded-lg bg-surface border px-3 py-2 outline-none font-mono text-sm"
                placeholder="nexora-files/"
              />
              <p className="text-[10px] text-content-muted mt-0.5">
                Restrict to a subfolder within the bucket
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={usePathStyle} onChange={(e) => setUsePathStyle(e.target.checked)} />
              Use path-style URLs (for MinIO)
            </label>
          </div>
        </>
      )}

      {/* Options */}
      <div className="flex flex-col gap-2 mt-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /> Read-only
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled
        </label>
      </div>
    </Modal>
  );
}
