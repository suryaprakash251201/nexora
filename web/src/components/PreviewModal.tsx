import { useEffect, useMemo, useState, useCallback, useRef, lazy, Suspense } from "react";
import { X, Download, Pencil, Share2, ZoomIn, ZoomOut, Maximize, Minimize, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { FileItem } from "../api/types";
import { previewKind, isEditable, rawUrl } from "../lib/preview";
import { startDownload } from "../lib/transfer";
import { usePlayer } from "../store/player";
import MediaPlayer from "./MediaPlayer";
import { DocumentSkeleton } from "./pdf/ViewerStatus";
import { Button } from "./ui/Button";
import { formatBytes, formatDate } from "../lib/format";
import { cn } from "@/lib/utils";
import { useFocusTrap } from "../lib/useFocusTrap";
import TextWorkspace from "./text/TextWorkspace";
import { IMAGE_EXTS } from "@nexora/core";


// The Document Space (PDF) is code-split on its own — pdf.js only ever
// downloads when a PDF is actually opened.
const PdfWorkspace = lazy(() => import("./pdf/PdfWorkspace"));

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
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // Gallery navigation for images
  const galleryItems = useMemo(() => {
    if (!playlist) return [];
    return playlist.filter(
      (f) => f.mime.startsWith("image/") || IMAGE_EXTS.has((f.extension || "").toLowerCase())
    );
  }, [playlist]);
  
  const galleryIndex = galleryItems.findIndex((f) => f.path === current.path);
  const hasGallery = galleryItems.length > 1 && galleryIndex >= 0;
  
  const navigateGallery = useCallback((direction: 1 | -1) => {
    if (!hasGallery) return;
    const nextIdx = (galleryIndex + direction + galleryItems.length) % galleryItems.length;
    setCurrent(galleryItems[nextIdx]);
  }, [hasGallery, galleryIndex, galleryItems]);

  const url = rawUrl(current.root_id || rootId, current.path);

  const audioQueue = useMemo(
    () => (playlist && playlist.length ? playlist.filter((f) => f.mime.startsWith("audio/")) : [current]),
    [playlist, current]
  );
  const queueIndex = audioQueue.findIndex((f) => f.path === current.path);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // PDFs run their own Document Space keyboard layer (including the
      // Escape cascade); the generic preview shortcuts don't apply.
      if (kind === "pdf") return;
      if (e.key === "Escape") {
        if (isFullscreen) setIsFullscreen(false);
        else handleClose();
      }
      if (hasGallery && kind === "image") {
        if (e.key === "ArrowLeft") { e.preventDefault(); navigateGallery(-1); }
        if (e.key === "ArrowRight") { e.preventDefault(); navigateGallery(1); }
      }
      if (e.key === "i" && !e.ctrlKey && !e.metaKey) {
        setShowInfo((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose, isFullscreen, hasGallery, kind, navigateGallery]);

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


  const editable = !current.is_dir && isEditable(current);
  const focusTrapRef = useFocusTrap(true);

  // ── Document Space: PDFs get the full viewport, not a modal pane ─────
  if (kind === "pdf") {
    return (
      <div
        className="fixed inset-0 z-[var(--z-modal)] animate-fade-in"
        role="dialog"
        aria-modal="true"
        aria-label="Document viewer"
      >
        <div ref={focusTrapRef} className="h-full w-full outline-none">
          <Suspense fallback={<DocumentSkeleton progress={0} />}>
            <PdfWorkspace item={current} rootId={rootId} onClose={handleClose} onShare={onShare} />
          </Suspense>
        </div>
      </div>
    );
  }

  // Text & markdown get the dedicated TextWorkspace experience.
  if (kind === "text" || kind === "markdown") {
    return (
      <TextWorkspace
        item={current}
        rootId={rootId}
        initialMode="preview"
        canWrite={canWrite}
        onClose={handleClose}
        onShare={onShare}
      />
    );
  }

  return (
    <div className={`fixed inset-0 z-[var(--z-modal)] flex items-center justify-center ${kind === "video" ? "p-0" : "p-2 md:p-6"} bg-black/60 backdrop-blur-sm animate-fade-in`} onMouseDown={handleClose} role="dialog" aria-modal="true" aria-label="File preview">
      <div 
        ref={focusTrapRef}
        className={`w-full flex flex-col glass-strong bg-background/95 shadow-2xl transition-all duration-300 ease-out overflow-hidden
          ${isFullscreen ? "h-full max-w-none rounded-none" : kind === "video" ? "h-[90vh] max-w-6xl rounded-none sm:rounded-2xl" : "h-[85vh] max-w-6xl rounded-2xl animate-scale-in"}`} 
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={`flex items-center justify-between px-5 py-4 shrink-0 ${kind === "video" ? "" : "border-b border-border/50"}`}>
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
            
            <button onClick={() => startDownload(current.root_id || rootId, current.path, current.name)} className="p-2 rounded-lg glass-hover text-content-muted hover:text-content" title="Download">
              <Download className="h-4 w-4" />
            </button>
            
            <div className="w-px h-6 bg-border/50 mx-1 hidden sm:block" />
            
            <button onClick={() => setShowInfo(!showInfo)} className={cn("p-2 rounded-lg glass-hover transition-colors hidden sm:block", showInfo ? "text-accent bg-accent/10" : "text-content-muted hover:text-content")} title="File info (I)">
              <Info className="h-4 w-4" />
            </button>
            <button onClick={() => setIsFullscreen(!isFullscreen)} className="p-2 rounded-lg glass-hover text-content-muted hover:text-content hidden sm:block" title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}>
              {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
            
            <button onClick={handleClose} className="p-2 rounded-lg hover:bg-danger/10 text-content-muted hover:text-danger transition-colors ml-1" title="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-auto grid place-items-center bg-black/5 relative">
            {kind === "image" && (
              <ImagePreview
                url={url}
                name={current.name}
                zoom={zoom}
                setZoom={setZoom}
                hasGallery={hasGallery}
                galleryIndex={galleryIndex}
                galleryItems={galleryItems}
                navigateGallery={navigateGallery}
              />
            )}
            {kind === "video" && (
            <div className="w-full h-full bg-black">
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
          {kind === "none" && (
            <div className="text-center text-content-muted p-10 flex flex-col items-center">
              <div className="h-20 w-20 rounded-full bg-surface-muted grid place-items-center mb-6">
                <span className="text-2xl font-mono opacity-50">{current.extension.toUpperCase()}</span>
              </div>
              <p className="mb-6 text-lg font-medium">No inline preview available for this file type.</p>
              <Button variant="primary" onClick={() => startDownload(current.root_id || rootId, current.path, current.name)} icon={<Download className="h-4 w-4" />}>
                Download File
              </Button>
            </div>
          )}
          </div>
          {/* Info panel */}
          <AnimatePresence>
            {showInfo && (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 280, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="shrink-0 border-l border-white/[0.06] overflow-hidden bg-surface/30"
              >
                <div className="w-[280px] p-5 space-y-4">
                  <h3 className="text-sm font-semibold text-text-secondary">File Information</h3>
                  <div className="space-y-3 text-xs">
                    <div>
                      <span className="text-text-tertiary block mb-0.5">Name</span>
                      <span className="text-text-primary font-medium break-all">{current.name}</span>
                    </div>
                    <div>
                      <span className="text-text-tertiary block mb-0.5">Type</span>
                      <span className="text-text-primary">{current.mime || current.extension.toUpperCase()}</span>
                    </div>
                    <div>
                      <span className="text-text-tertiary block mb-0.5">Size</span>
                      <span className="text-text-primary">{formatBytes(current.size)}</span>
                    </div>
                    <div>
                      <span className="text-text-tertiary block mb-0.5">Modified</span>
                      <span className="text-text-primary">{current.modified ? formatDate(current.modified) : '—'}</span>
                    </div>
                    <div>
                      <span className="text-text-tertiary block mb-0.5">Path</span>
                      <span className="text-text-primary font-mono text-[10px] break-all">{current.path}</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function ImagePreview({
  url,
  name,
  zoom,
  setZoom,
  hasGallery,
  galleryIndex,
  galleryItems,
  navigateGallery,
}: {
  url: string;
  name: string;
  zoom: number;
  setZoom: (fn: (z: number) => number) => void;
  hasGallery: boolean;
  galleryIndex: number;
  galleryItems: { path: string }[];
  navigateGallery: (dir: 1 | -1) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  // Mouse wheel zoom (Ctrl+Scroll)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom((z) => Math.max(0.1, Math.min(10, z + delta)));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setZoom]);

  return (
    <div
      ref={wrapRef}
      className="w-full h-full overflow-auto custom-scrollbar grid place-items-center relative"
    >
      {/* Checkerboard background for transparent images */}
      <div
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, #808080 25%, transparent 25%, transparent 75%, #808080 75%, #808080), repeating-linear-gradient(45deg, #808080 25%, transparent 25%, transparent 75%, #808080 75%, #808080)",
          backgroundPosition: "0 0, 10px 10px",
          backgroundSize: "20px 20px",
          zIndex: -1,
        }}
      />
      <img
        src={url}
        alt={name}
        className="transition-transform duration-200 shadow-2xl"
        style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
        draggable={false}
      />
      {/* Gallery navigation arrows */}
      {hasGallery && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigateGallery(-1);
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full glass-strong border border-white/10 text-white/80 hover:text-white hover:bg-white/10 transition-all duration-200 shadow-xl z-10"
            title="Previous image (←)"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigateGallery(1);
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full glass-strong border border-white/10 text-white/80 hover:text-white hover:bg-white/10 transition-all duration-200 shadow-xl z-10"
            title="Next image (→)"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full glass-strong border border-white/10 text-xs font-mono text-white/70 z-10">
            {galleryIndex + 1} / {galleryItems.length}
          </div>
        </>
      )}
    </div>
  );
}

