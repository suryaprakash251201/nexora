import { useEffect, useMemo, useState } from "react";
import { X, Download, Pencil, Share2, Copy, Check, ZoomIn, ZoomOut } from "lucide-react";
import type { FileItem } from "../api/types";
import { previewKind, isEditable, rawUrl, codeLanguage } from "../lib/preview";
import { renderMarkdown } from "../lib/markdown";
import { usePlayer } from "../store/player";
import MediaPlayer from "./MediaPlayer";

const MAX_TEXT = 400000;

export default function PreviewModal({
  item,
  rootId,
  playlist,
  canWrite,
  onClose,
  onEdit,
  onShare,
}: {
  item: FileItem;
  rootId: string;
  playlist?: FileItem[];
  canWrite?: boolean;
  onClose: () => void;
  onEdit?: (item: FileItem) => void;
  onShare?: (item: FileItem) => void;
}) {
  const [current, setCurrent] = useState(item);
  const kind = previewKind(current);
  const [text, setText] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(1);

  const url = rawUrl(current.root_id || rootId, current.path);

  const audioQueue = useMemo(
    () => (playlist && playlist.length ? playlist.filter((f) => f.mime.startsWith("audio/")) : [current]),
    [playlist, current]
  );
  const queueIndex = audioQueue.findIndex((f) => f.path === current.path);

  useEffect(() => {
    if (kind === "text" || kind === "markdown") {
      setTextLoading(true);
      setText(null);
      fetch(url)
        .then((r) => r.text())
        .then((t) => {
          if (t.length > MAX_TEXT) {
            setTruncated(true);
            setText(t.slice(0, MAX_TEXT));
          } else {
            setTruncated(false);
            setText(t);
          }
        })
        .catch(() => setText("Unable to load preview."))
        .finally(() => setTextLoading(false));
    }
  }, [current.path, url, kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (kind === "audio" && audioQueue.length) {
      usePlayer.getState().play(audioQueue, queueIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.path]);

  useEffect(() => {
    if (kind === "audio") {
      usePlayer.getState().setPrimaryOpen(true);
      return () => usePlayer.getState().setPrimaryOpen(false);
    }
  }, [kind]);

  const copyText = () => {
    if (text) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    }
  };

  const editable = !current.is_dir && isEditable(current);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/70" onMouseDown={onClose}>
      <div className="w-full max-w-5xl h-[88vh] flex flex-col glass-strong rounded-xl overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b glass-divider gap-2">
          <span className="font-medium truncate">{current.name}</span>
          <div className="flex items-center gap-1">
            {kind === "image" && (
              <>
                <button onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} className="p-2 rounded-lg glass-hover" title="Zoom out"><ZoomOut className="h-4 w-4" /></button>
                <button onClick={() => setZoom((z) => Math.min(5, z + 0.25))} className="p-2 rounded-lg glass-hover" title="Zoom in"><ZoomIn className="h-4 w-4" /></button>
              </>
            )}
            {(kind === "text" || kind === "markdown") && (
              <button onClick={copyText} className="p-2 rounded-lg glass-hover" title="Copy">
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </button>
            )}
            {onShare && (
              <button onClick={() => onShare(current)} className="p-2 rounded-lg glass-hover" title="Share"><Share2 className="h-4 w-4" /></button>
            )}
            {canWrite && editable && onEdit && (
              <button onClick={() => { onEdit(current); }} className="p-2 rounded-lg glass-hover" title="Edit"><Pencil className="h-4 w-4" /></button>
            )}
            <a href={rawUrl(current.root_id || rootId, current.path, true)} className="p-2 rounded-lg glass-hover" title="Download"><Download className="h-4 w-4" /></a>
            <button onClick={onClose} className="p-2 rounded-lg glass-hover"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-auto grid place-items-center p-2 bg-black/20">
          {kind === "image" && (
            <img src={url} alt={current.name} className="max-h-full max-w-full object-contain transition-transform" style={{ transform: `scale(${zoom})` }} />
          )}
          {kind === "video" && (
            <MediaPlayer kind="video" url={url} item={current} autoPlay />
          )}
          {kind === "audio" && (
            <MediaPlayer
              kind="audio"
              controlled
              item={current}
              playlist={audioQueue}
              onSelect={(i) => { setCurrent(audioQueue[i]); usePlayer.getState().play(audioQueue, i); }}
            />
          )}
          {kind === "pdf" && <iframe src={url} className="w-full h-full bg-white" title={current.name} />}
          {kind === "markdown" && (
            textLoading ? <span className="text-content-muted">Loading…</span> :
            <div className="w-full h-full overflow-auto bg-surface">
              <div className="markdown-body max-w-3xl mx-auto p-6" dangerouslySetInnerHTML={{ __html: renderMarkdown(text || "") }} />
              {truncated && <p className="text-center text-xs text-content-muted pb-4">Preview truncated — download to view the full file.</p>}
            </div>
          )}
          {kind === "text" && (
            textLoading ? <span className="text-content-muted">Loading…</span> :
            <CodeView text={text || ""} ext={current.extension} truncated={truncated} />
          )}
          {kind === "none" && (
            <div className="text-center text-content-muted p-8">
              <p className="mb-2">No inline preview available for this file type.</p>
              <a href={rawUrl(current.root_id || rootId, current.path, true)} className="text-accent underline">Download instead</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CodeView({ text, ext, truncated }: { text: string; ext: string; truncated: boolean }) {
  const lines = text.split("\n");
  return (
    <div className="w-full h-full overflow-auto bg-surface">
      <div className="flex items-center justify-between px-4 py-1.5 border-b text-xs text-content-muted sticky top-0 bg-surface">
        <span>{codeLanguage(ext)}</span>
        <span>{lines.length} lines{truncated ? " (truncated)" : ""}</span>
      </div>
      <div className="flex font-mono text-sm">
        <div className="select-none text-right py-3 px-2 text-content-muted bg-surface-muted border-r" style={{ minWidth: "3.5rem" }}>
          {lines.map((_, i) => <div key={i} className="leading-6">{i + 1}</div>)}
        </div>
        <pre className="flex-1 py-3 px-3 leading-6 whitespace-pre overflow-x-auto"><code>{text}</code></pre>
      </div>
    </div>
  );
}
