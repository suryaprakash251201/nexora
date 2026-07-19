import { useEffect, useMemo, useState } from "react";
import { X, Download, Pencil, Share2, Copy, Check, ZoomIn, ZoomOut, Maximize, Minimize } from "lucide-react";
import type { FileItem } from "../api/types";
import { previewKind, isEditable, rawUrl, codeLanguage } from "../lib/preview";
import { renderMarkdown } from "../lib/markdown";
import { usePlayer } from "../store/player";
import MediaPlayer from "./MediaPlayer";
import { Button } from "./ui/Button";

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
  const [isFullscreen, setIsFullscreen] = useState(false);

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
      if (e.key === "Escape") {
        if (isFullscreen) setIsFullscreen(false);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, isFullscreen]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 md:p-6 bg-black/60 backdrop-blur-sm animate-fade-in" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="File preview">
      <div 
        className={`w-full flex flex-col glass-strong bg-background/95 shadow-2xl transition-all duration-300 ease-out overflow-hidden
          ${isFullscreen ? "h-full max-w-none rounded-none" : "h-[85vh] max-w-6xl rounded-2xl animate-scale-in"}`} 
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 shrink-0">
          <div className="flex items-center gap-3 min-w-0 pr-4">
            <span className="font-bold text-lg truncate drop-shadow-sm">{current.name}</span>
            <span className="px-2 py-0.5 rounded-md bg-surface-muted text-xs font-mono text-content-muted hidden sm:block">
              {current.extension.toUpperCase()}
            </span>
          </div>
          
          <div className="flex items-center gap-1.5 shrink-0">
            {kind === "image" && (
              <div className="flex items-center mr-2 bg-surface/50 rounded-lg p-0.5">
                <button onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} className="p-1.5 rounded-md glass-hover text-content-muted hover:text-content" title="Zoom out"><ZoomOut className="h-4 w-4" /></button>
                <span className="text-xs font-mono w-12 text-center text-content-muted">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom((z) => Math.min(5, z + 0.25))} className="p-1.5 rounded-md glass-hover text-content-muted hover:text-content" title="Zoom in"><ZoomIn className="h-4 w-4" /></button>
              </div>
            )}
            
            {(kind === "text" || kind === "markdown") && (
              <button onClick={copyText} className="p-2 rounded-lg glass-hover text-content-muted hover:text-content" title="Copy to clipboard">
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </button>
            )}
            
            {onShare && (
              <button onClick={() => onShare(current)} className="p-2 rounded-lg glass-hover text-content-muted hover:text-content" title="Share">
                <Share2 className="h-4 w-4" />
              </button>
            )}
            
            {canWrite && editable && onEdit && (
              <button onClick={() => onEdit(current)} className="p-2 rounded-lg glass-hover text-content-muted hover:text-content" title="Edit file">
                <Pencil className="h-4 w-4" />
              </button>
            )}
            
            <a href={rawUrl(current.root_id || rootId, current.path, true)} className="p-2 rounded-lg glass-hover text-content-muted hover:text-content" title="Download" download>
              <Download className="h-4 w-4" />
            </a>
            
            <div className="w-px h-6 bg-border/50 mx-1 hidden sm:block" />
            
            <button onClick={() => setIsFullscreen(!isFullscreen)} className="p-2 rounded-lg glass-hover text-content-muted hover:text-content hidden sm:block" title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}>
              {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
            
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-danger/10 text-content-muted hover:text-danger transition-colors ml-1" title="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto grid place-items-center bg-black/5 relative">
          {kind === "image" && (
            <div className="w-full h-full overflow-auto custom-scrollbar grid place-items-center relative">
              {/* Checkerboard background for transparent images */}
              <div className="absolute inset-0 pointer-events-none opacity-20" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #808080 25%, transparent 25%, transparent 75%, #808080 75%, #808080), repeating-linear-gradient(45deg, #808080 25%, transparent 25%, transparent 75%, #808080 75%, #808080)', backgroundPosition: '0 0, 10px 10px', backgroundSize: '20px 20px', zIndex: -1 }} />
              <img 
                src={url} 
                alt={current.name} 
                className="max-w-none transition-transform duration-200 shadow-2xl" 
                style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }} 
              />
            </div>
          )}
          {kind === "video" && (
            <div className="w-full h-full">
              <MediaPlayer kind="video" url={url} item={current} autoPlay />
            </div>
          )}
          {kind === "audio" && (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-black/10 to-black/30">
              <MediaPlayer
                kind="audio"
                controlled
                item={current}
                playlist={audioQueue}
                onSelect={(i) => { setCurrent(audioQueue[i]); usePlayer.getState().play(audioQueue, i); }}
              />
            </div>
          )}
          {kind === "pdf" && <iframe src={url} className="w-full h-full bg-white" title={current.name} />}
          {kind === "markdown" && (
            textLoading ? (
              <div className="flex flex-col items-center gap-3">
                <div className="h-8 w-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                <span className="text-content-muted font-medium text-sm animate-pulse">Rendering markdown...</span>
              </div>
            ) : (
              <div className="w-full h-full overflow-auto bg-surface">
                <div className="markdown-body max-w-4xl mx-auto p-6 md:p-10" dangerouslySetInnerHTML={{ __html: renderMarkdown(text || "") }} />
                {truncated && (
                  <div className="text-center p-6 bg-warning/10 text-warning border-t border-warning/20">
                    <p className="font-medium text-sm">Preview truncated — download to view the full file.</p>
                  </div>
                )}
              </div>
            )
          )}
          {kind === "text" && (
            textLoading ? (
              <div className="flex flex-col items-center gap-3">
                <div className="h-8 w-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                <span className="text-content-muted font-medium text-sm animate-pulse">Loading text...</span>
              </div>
            ) : (
              <CodeView text={text || ""} ext={current.extension} truncated={truncated} />
            )
          )}
          {kind === "none" && (
            <div className="text-center text-content-muted p-10 flex flex-col items-center">
              <div className="h-20 w-20 rounded-full bg-surface-muted grid place-items-center mb-6">
                <span className="text-2xl font-mono opacity-50">{current.extension.toUpperCase()}</span>
              </div>
              <p className="mb-6 text-lg font-medium">No inline preview available for this file type.</p>
              <Button variant="primary" onClick={() => window.location.href = rawUrl(current.root_id || rootId, current.path, true)} icon={<Download className="h-4 w-4" />}>
                Download File
              </Button>
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
    <div className="w-full h-full flex flex-col bg-[#0d1117] text-[#e6edf3]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#30363d] text-xs font-mono bg-[#161b22] shadow-sm z-10 shrink-0">
        <span className="px-2 py-1 bg-[#21262d] rounded-md border border-[#30363d] text-accent/90">{codeLanguage(ext)}</span>
        <span className="text-[#8b949e]">{lines.length} lines{truncated ? " (truncated)" : ""}</span>
      </div>
      <div className="flex-1 overflow-auto flex font-mono text-sm leading-relaxed custom-scrollbar">
        <div className="select-none text-right py-4 px-3 text-[#6e7681] bg-[#161b22] border-r border-[#30363d] sticky left-0 min-w-[3.5rem] shrink-0">
          {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <pre className="py-4 px-4 whitespace-pre overflow-x-auto min-w-max pb-10"><code>{text}</code></pre>
      </div>
      {truncated && (
        <div className="text-center p-3 bg-[#D29922]/10 text-[#D29922] border-t border-[#D29922]/20 text-xs shrink-0">
          Preview truncated — download to view the full file.
        </div>
      )}
    </div>
  );
}
