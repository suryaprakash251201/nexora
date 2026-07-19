import { useState, useRef, useEffect } from "react";
import { Image, Upload, Folder, ArrowUp, Check, Loader2 } from "lucide-react";
import { get, upload as apiUpload } from "../api/client";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "./Modal";
import type { FileItem, Root } from "../api/types";
import { thumbUrl } from "../lib/preview";

interface CoverPickerModalProps {
  onClose: () => void;
  onConfirm: (rootId: string, path: string) => void;
}

export default function CoverPickerModal({ onClose, onConfirm }: CoverPickerModalProps) {
  const [tab, setTab] = useState<"browse" | "upload">("browse");
  const [selected, setSelected] = useState<{ rootId: string; path: string } | null>(null);
  const [browseRoot, setBrowseRoot] = useState<string | null>(null);
  const [browsePath, setBrowsePath] = useState("");
  const [uploadRoot, setUploadRoot] = useState<string | null>(null);
  const [uploadPath, setUploadPath] = useState("/covers");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedResult, setUploadedResult] = useState<{ rootId: string; path: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const rootQuery = useQuery({
    queryKey: ["roots"],
    queryFn: () => get<{ roots: Root[] }>("/roots"),
  });

  const coverConfigQuery = useQuery({
    queryKey: ["cover-config"],
    queryFn: () => get<{ cover_path: string }>("/playlists/cover-config"),
  });

  useEffect(() => {
    if (coverConfigQuery.data?.cover_path) {
      const parts = coverConfigQuery.data.cover_path.split(":");
      const rootName = parts[0];
      const path = parts.slice(1).join(":") || "/covers";
      const match = rootQuery.data?.roots.find((r) => r.name === rootName);
      if (match) {
        setUploadRoot(match.id);
      }
      setUploadPath(path);
    }
  }, [coverConfigQuery.data, rootQuery.data]);

  const filesQuery = useQuery({
    queryKey: ["files", browseRoot, browsePath],
    queryFn: () =>
      get<{ items: FileItem[] }>("/files", {
        root: browseRoot!,
        path: browsePath,
        sort: "name",
        order: "asc",
      }),
    enabled: !!browseRoot && tab === "browse",
  });

  const images = (filesQuery.data?.items || []).filter(
    (i) =>
      !i.is_dir &&
      ["jpg", "jpeg", "png", "gif", "webp"].includes(i.extension?.toLowerCase())
  );
  const folders = (filesQuery.data?.items || []).filter((i) => i.is_dir);

  const parentPath = browsePath.includes("/")
    ? browsePath.slice(0, browsePath.lastIndexOf("/"))
    : "";

  const handleUpload = async () => {
    if (!uploadFile || !uploadRoot) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("files", uploadFile);
      await apiUpload(`/files/upload?root=${encodeURIComponent(uploadRoot)}&path=${encodeURIComponent(uploadPath)}`, form);
      const resultPath = uploadPath.replace(/\/?$/, "/") + uploadFile.name;
      setUploadedResult({ rootId: uploadRoot, path: resultPath });
      setSelected({ rootId: uploadRoot, path: resultPath });
    } catch (e) {
      console.error("Upload failed", e);
    } finally {
      setUploading(false);
    }
  };

  const pickRoot = (r: Root) => {
    setBrowseRoot(r.id);
    setBrowsePath("");
  };

  const doConfirm = () => {
    if (selected) onConfirm(selected.rootId, selected.path);
  };

  const canConfirm = tab === "upload" ? !!uploadedResult : !!selected;

  return (
    <Modal
      title="Set cover image"
      onClose={onClose}
      footer={
        <button
          onClick={doConfirm}
          disabled={!canConfirm}
          className="px-3 py-1.5 rounded-lg accent-glass text-sm font-medium disabled:opacity-50"
        >
          Set cover
        </button>
      }
    >
      <div className="flex gap-1 mb-4 rounded-lg bg-surface-muted/50 p-1">
        <button
          onClick={() => setTab("browse")}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            tab === "browse" ? "bg-accent/15 text-accent" : "text-content-muted hover:text-content"
          }`}
        >
          <Image className="h-4 w-4" /> Browse
        </button>
        <button
          onClick={() => setTab("upload")}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            tab === "upload" ? "bg-accent/15 text-accent" : "text-content-muted hover:text-content"
          }`}
        >
          <Upload className="h-4 w-4" /> Upload
        </button>
      </div>

      {tab === "browse" && (
        <div>
          {!browseRoot ? (
            <div>
              <p className="text-xs text-content-muted mb-2">Select a storage root to browse:</p>
              <div className="max-h-60 overflow-auto rounded-lg border glass-divider">
                {rootQuery.data?.roots.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => pickRoot(r)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left glass-hover border-b glass-divider last:border-0"
                  >
                    <Folder className="h-4 w-4 text-accent" />
                    <span className="text-sm font-medium">{r.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => {
                    if (parentPath === "" && browsePath === "") {
                      setBrowseRoot(null);
                    } else {
                      setBrowsePath(parentPath);
                    }
                  }}
                  className="p-1 rounded glass-hover"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <p className="text-xs text-content-muted font-mono truncate">
                  {browseRoot?.slice(0, 8)}/{browsePath || "root"}
                </p>
              </div>
              <div className="max-h-64 overflow-auto rounded-lg border glass-divider">
                {filesQuery.isLoading && (
                  <div className="flex items-center justify-center gap-2 p-6 text-content-muted">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                  </div>
                )}
                {!filesQuery.isLoading && folders.length === 0 && images.length === 0 && (
                  <p className="p-4 text-sm text-content-muted text-center">No images found in this folder.</p>
                )}
                {folders.map((f) => (
                  <button
                    key={f.path}
                    onClick={() => setBrowsePath(f.path)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left glass-hover border-b glass-divider last:border-0"
                  >
                    <Folder className="h-4 w-4 text-accent shrink-0" />
                    <span className="text-sm truncate">{f.name}</span>
                  </button>
                ))}
                {images.length > 0 && (
                  <div className="grid grid-cols-4 gap-2 p-2">
                    {images.map((img) => {
                      const isSelected = selected?.rootId === browseRoot && selected?.path === img.path;
                      return (
                        <button
                          key={img.path}
                          onClick={() => setSelected({ rootId: browseRoot!, path: img.path })}
                          className={`aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                            isSelected ? "border-accent ring-2 ring-accent/30" : "border-transparent hover:border-white/20"
                          }`}
                        >
                          <img
                            src={thumbUrl(img)}
                            alt={img.name}
                            className="h-full w-full object-cover"
                          />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "upload" && (
        <div>
          <div className="space-y-3">
            {!uploadFile && (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-accent/50 transition-colors"
              >
                <Upload className="h-8 w-8 mx-auto mb-2 text-content-muted" />
                <p className="text-sm font-medium">Click to select an image</p>
                <p className="text-xs text-content-muted mt-1">JPG, PNG, GIF, WebP</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setUploadFile(f);
                  }}
                />
              </div>
            )}
            {uploadFile && !uploadedResult && (
              <div className="space-y-3">
                <p className="text-sm font-medium">Selected: {uploadFile.name}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setUploadFile(null); setUploadedResult(null); setSelected(null); }}
                    className="px-3 py-1.5 rounded-lg glass-hover text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpload}
                    disabled={uploading || !uploadRoot}
                    className="px-3 py-1.5 rounded-lg accent-glass text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
                    {uploading ? "Uploading…" : "Upload"}
                  </button>
                </div>
              </div>
            )}
            {uploadedResult && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
                  <Check className="h-4 w-4" /> Uploaded successfully
                </div>
                <p className="text-xs text-content-muted font-mono truncate">{uploadedResult.path}</p>
                {uploadFile && (
                  <img
                    src={URL.createObjectURL(uploadFile)}
                    alt="Preview"
                    className="max-h-40 rounded-lg object-contain border glass-divider"
                  />
                )}
              </div>
            )}
            {!uploadRoot && (
              <p className="text-xs text-amber-400">
                No upload target configured. Set NEXORA_PLAYLIST_COVER_PATH in your .env file.
              </p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
