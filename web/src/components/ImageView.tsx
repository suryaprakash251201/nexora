import { useState, useRef, useEffect, useCallback } from "react";
import { X, ChevronLeft, ChevronRight, Download, Share2, ZoomIn, ZoomOut, RotateCw } from "lucide-react";
import type { FileItem } from "../api/types";
import { rawUrl, thumbUrl } from "../lib/preview";

export default function ImageView({
  item,
  images,
  rootId,
  onClose,
  onShare,
}: {
  item: FileItem;
  images: FileItem[];
  rootId: string;
  onClose: () => void;
  onShare?: (item: FileItem) => void;
}) {
  const [index, setIndex] = useState(() => Math.max(0, images.findIndex((img) => img.path === item.path)));
  const current = images[index] || item;
  const url = rawUrl(rootId, current.path);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showControls, setShowControls] = useState(true);
  const [imgLoaded, setImgLoaded] = useState(false);
  const controlsRef = useRef<number>();
  const wrapRef = useRef<HTMLDivElement>(null);
  const filmstripRef = useRef<HTMLDivElement>(null);

  const resetTimer = useCallback(() => {
    setShowControls(true);
    window.clearTimeout(controlsRef.current);
    controlsRef.current = window.setTimeout(() => setShowControls(false), 3000);
  }, []);

  useEffect(() => {
    resetTimer();
    return () => window.clearTimeout(controlsRef.current);
  }, [current.path, resetTimer]);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setImgLoaded(false);
  }, [current.path]);

  const go = useCallback((dir: number) => {
    const next = index + dir;
    if (next < 0 || next >= images.length) return;
    setIndex(next);
    resetTimer();
  }, [index, images.length, resetTimer]);

  useEffect(() => {
    const el = filmstripRef.current;
    if (!el) return;
    const thumb = el.children[index] as HTMLElement;
    if (thumb) thumb.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [index]);

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      switch (e.key) {
        case "Escape": onClose(); break;
        case "ArrowLeft": e.preventDefault(); go(-1); break;
        case "ArrowRight": e.preventDefault(); go(1); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, go]);

  // Pan on mouse drag when zoomed
  const drag = useRef({ active: false, sx: 0, sy: 0, px: 0, py: 0 });

  const onImgMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1.01) return;
    drag.current = { active: true, sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
  };

  useEffect(() => {
    if (!drag.current.active) return;
    const onMove = (e: MouseEvent) => {
      if (!drag.current.active) return;
      setPan({ x: drag.current.px + e.clientX - drag.current.sx, y: drag.current.py + e.clientY - drag.current.sy });
    };
    const onUp = () => { drag.current.active = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [zoom, pan]);

  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;

  return (
    <div
      ref={wrapRef}
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm select-none animate-fade-in"
      onMouseMove={resetTimer}
    >
      {/* Top bar */}
      <div className={`absolute top-0 inset-x-0 z-30 flex items-center justify-between px-5 py-4 bg-gradient-to-b from-black/60 to-transparent transition-opacity duration-500 ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-white/90 font-semibold truncate text-sm">{current.name}</span>
          {images.length > 1 && (
            <span className="text-white/50 text-xs font-mono shrink-0">{index + 1} / {images.length}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onShare && (
            <button onClick={() => onShare(current)} className="p-2 rounded-full hover:bg-white/15 text-white/70 hover:text-white transition-colors" title="Share">
              <Share2 className="h-5 w-5" />
            </button>
          )}
          <a href={rawUrl(rootId, current.path, true)} download className="p-2 rounded-full hover:bg-white/15 text-white/70 hover:text-white transition-colors" title="Download">
            <Download className="h-5 w-5" />
          </a>
          <div className="w-px h-5 bg-white/15 mx-1" />
          <button onClick={() => setZoom(z => Math.max(0.25, z - 0.25))} className="p-2 rounded-full hover:bg-white/15 text-white/70 hover:text-white transition-colors" title="Zoom out">
            <ZoomOut className="h-5 w-5" />
          </button>
          <span className="text-white/50 text-xs font-mono w-10 tabular-nums text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(5, z + 0.25))} className="p-2 rounded-full hover:bg-white/15 text-white/70 hover:text-white transition-colors" title="Zoom in">
            <ZoomIn className="h-5 w-5" />
          </button>
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="p-2 rounded-full hover:bg-white/15 text-white/70 hover:text-white transition-colors" title="Reset zoom">
            <RotateCw className="h-4 w-4" />
          </button>
          <div className="w-px h-6 bg-white/15 mx-1" />
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/15 text-white/70 hover:text-white transition-colors" title="Close (Esc)">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Navigation arrows */}
      {hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); go(-1); }}
          className={`absolute left-3 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full bg-black/40 hover:bg-black/60 text-white backdrop-blur-sm transition-all duration-300 hover:scale-105 ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          title="Previous (←)"
        >
          <ChevronLeft className="h-7 w-7" />
        </button>
      )}
      {hasNext && (
        <button
          onClick={(e) => { e.stopPropagation(); go(1); }}
          className={`absolute right-3 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full bg-black/40 hover:bg-black/60 text-white backdrop-blur-sm transition-all duration-300 hover:scale-105 ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          title="Next (→)"
        >
          <ChevronRight className="h-7 w-7" />
        </button>
      )}

      {/* Image */}
      <div className="absolute inset-0 z-10 grid place-items-center p-16 pb-28">
        <img
          key={current.path}
          src={url}
          alt={current.name}
          className="max-h-full max-w-full object-contain select-none"
          style={{
            opacity: imgLoaded ? 1 : 0,
            transition: "opacity 0.25s",
            transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            cursor: zoom > 1.01 ? "grab" : "default",
          }}
          onLoad={() => setImgLoaded(true)}
          onMouseDown={onImgMouseDown}
          draggable={false}
        />
      </div>

      {/* Filmstrip */}
      {images.length > 1 && (
        <div className={`absolute bottom-0 inset-x-0 z-30 transition-opacity duration-500 ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
          <div className="bg-gradient-to-t from-black/80 via-black/60 to-transparent pt-12 pb-4 px-4">
            <div ref={filmstripRef} className="flex items-center gap-2 overflow-x-auto justify-center pb-1">
              {images.map((img, i) => (
                <FilmstripThumb
                  key={img.path}
                  img={img}
                  active={i === index}
                  onClick={() => { setIndex(i); resetTimer(); }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilmstripThumb({ img, active, onClick }: { img: FileItem; active: boolean; onClick: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      onClick={onClick}
      className={`shrink-0 w-16 h-12 rounded-lg overflow-hidden ring-2 transition-all duration-200 ${
        active
          ? "ring-accent ring-offset-2 ring-offset-black/80 scale-110 opacity-100"
          : "ring-transparent opacity-50 hover:opacity-90"
      }`}
    >
      {failed ? (
        <div className="h-full w-full bg-white/10 grid place-items-center">
          <span className="text-white/30 text-[10px] font-mono">{img.extension.toUpperCase()}</span>
        </div>
      ) : (
        <img src={thumbUrl(img)} alt="" className="h-full w-full object-cover" draggable={false} onError={() => setFailed(true)} />
      )}
    </button>
  );
}
