import { useEffect, useState } from "react";
import { X, Download } from "lucide-react";
import type { FileItem } from "../api/types";

function rawUrl(rootId: string, path: string, download = false): string {
  return `/api/v1/files/raw?root=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;
}

export default function PreviewModal({
  item,
  rootId,
  onClose,
}: {
  item: FileItem;
  rootId: string;
  onClose: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const isText = item.mime.startsWith("text/") || ["md", "markdown", "txt", "json", "yaml", "yml", "toml", "ini", "log", "css", "html", "js", "ts", "go", "py", "sh"].includes(item.extension);

  useEffect(() => {
    if (isText) {
      setTextLoading(true);
      fetch(rawUrl(rootId, item.path))
        .then((r) => r.text())
        .then((t) => setText(t.length > 200000 ? t.slice(0, 200000) + "\n… (truncated)" : t))
        .catch(() => setText("Unable to load preview."))
        .finally(() => setTextLoading(false));
    }
  }, [item.path, rootId, isText]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const url = rawUrl(rootId, item.path);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/70" onMouseDown={onClose}>
      <div className="w-full max-w-4xl h-[85vh] flex flex-col bg-surface-elevated border rounded-xl overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="font-medium truncate">{item.name}</span>
          <div className="flex items-center gap-1">
            <a href={rawUrl(rootId, item.path, true)} className="p-2 rounded-lg hover:bg-surface-muted" title="Download"><Download className="h-4 w-4" /></a>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-muted"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto grid place-items-center p-2 bg-black/20">
          {item.mime.startsWith("image/") && <img src={url} alt={item.name} className="max-h-full max-w-full object-contain" />}
          {item.mime.startsWith("video/") && <video src={url} controls className="max-h-full max-w-full" />}
          {item.mime.startsWith("audio/") && <audio src={url} controls className="w-full" />}
          {item.mime === "application/pdf" && <iframe src={url} className="w-full h-full bg-white" title={item.name} />}
          {isText && (
            textLoading ? <span className="text-content-muted">Loading…</span> :
            <pre className="w-full h-full overflow-auto text-sm p-4 bg-surface text-content whitespace-pre">{text}</pre>
          )}
          {!isText && !item.mime.startsWith("image/") && !item.mime.startsWith("video/") && !item.mime.startsWith("audio/") && item.mime !== "application/pdf" && (
            <div className="text-center text-content-muted p-8">
              <p>No inline preview available for this file type.</p>
              <a href={rawUrl(rootId, item.path, true)} className="text-accent underline">Download instead</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
