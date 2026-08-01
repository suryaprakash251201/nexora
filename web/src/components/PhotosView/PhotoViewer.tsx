import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft, ChevronRight, X, Star, Info, MapPin, Download, Trash2,
  FolderOpen, Maximize, Minimize, RotateCw, ZoomIn, ZoomOut, ImageOff,
  Share2, Check, Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { photoRaw, photoThumb } from "./media";
import { cn } from "@/lib/utils";
import type { PhotoResult } from "./types";

interface PhotoViewerProps {
  photos: PhotoResult[];
  initialIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onToggleFavorite: (photo: PhotoResult) => void;
  onDelete: (photo: PhotoResult) => void;
  onOpenInFolder: (photo: PhotoResult) => void;
  onShare: (photo: PhotoResult) => Promise<void>;
}

const ZOOM_STEP = 1.4;

/** Average color of an <img> via a tiny canvas, cached per photo id. */
const colorCache = new Map<string, string>();
function dominantColor(img: HTMLImageElement, id: string): string | null {
  const hit = colorCache.get(id);
  if (hit) return hit;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 24;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, 24, 24);
    const { data } = ctx.getImageData(0, 0, 24, 24);
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    const color = `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`;
    colorCache.set(id, color);
    return color;
  } catch {
    return null;
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "Unknown";
  return d.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
}

export function PhotoViewer({
  photos, initialIndex, onClose, onNavigate,
  onToggleFavorite, onDelete, onOpenInFolder, onShare,
}: PhotoViewerProps) {
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotate, setRotate] = useState(0);
  const [panel, setPanel] = useState<"info" | "map" | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const [ambient, setAmbient] = useState<string | null>(null);
  const [shared, setShared] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const touchZoomRef = useRef<{ dist: number; zoom: number } | null>(null);

  const photo = photos[index] ?? photos[initialIndex];
  const total = photos.length;
  const hasGeo = typeof photo?.lat === "number" && typeof photo?.lng === "number";

  useEffect(() => {
    if (initialIndex >= 0 && initialIndex < photos.length) setIndex(initialIndex);
  }, [initialIndex, photos.length]);

  // Reset view state per photo
  useEffect(() => {
    setZoom(1); setPan({ x: 0, y: 0 }); setRotate(0); setLoaded(false); setBroken(false);
    setAmbient(null); setShared(false); setPanel((p) => (p === "map" && !hasGeo ? null : p));
  }, [index, hasGeo]);

  const clampPan = useCallback(
    (x: number, y: number) => {
      if (zoom <= 1) return { x: 0, y: 0 };
      // Rough clamp: image is centered and at most container-sized, so pan
      // range grows linearly with zoom. Uses viewport dims as an approximation.
      const vw = window.innerWidth, vh = window.innerHeight;
      const halfExcessW = (vw * (zoom - 1)) / 2;
      const halfExcessH = (vh * (zoom - 1)) / 2;
      return { x: Math.max(-halfExcessW, Math.min(halfExcessW, x)), y: Math.max(-halfExcessH, Math.min(halfExcessH, y)) };
    },
    [zoom]
  );

  const goTo = useCallback(
    (next: number) => {
      const i = ((next % total) + total) % total;
      onNavigate(i);
      setIndex(i);
    },
    [total, onNavigate]
  );

  const toggleZoom = useCallback(() => {
    if (zoom <= 1.01) { setZoom(2); setPan({ x: 0, y: 0 }); }
    else { setZoom(1); setPan({ x: 0, y: 0 }); }
  }, [zoom]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          if (panel) setPanel(null);
          else onClose();
          break;
        case "ArrowLeft": e.preventDefault(); goTo(index - 1); break;
        case "ArrowRight": case " ": case "PageDown": e.preventDefault(); goTo(index + 1); break;
        case "PageUp": e.preventDefault(); goTo(index - 1); break;
        case "+": case "=": setZoom((z) => Math.min(8, z * ZOOM_STEP)); break;
        case "-": setZoom((z) => Math.max(1, z / ZOOM_STEP)); break;
        case "0": case "f": setZoom(1); setPan({ x: 0, y: 0 }); break;
        case "r": setRotate((r) => (r + 90) % 360); break;
        case "i": setPanel((p) => (p === "info" ? null : "info")); break;
        case "m": if (hasGeo) setPanel((p) => (p === "map" ? null : "map")); break;
        case "d": {
          const a = document.createElement("a");
          a.href = photoRaw(photo.root_id, photo.path, true);
          a.download = photo.name || "photo";
          document.body.appendChild(a);
          a.click();
          a.remove();
          break;
        }
        case "t": void onShare(photo).then(() => setShared(true)); break;
        case "s": onToggleFavorite(photo); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, panel, photo, hasGeo, onClose, onShare, onToggleFavorite, goTo]);

  // Prevent the page behind from scrolling while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Non-passive wheel handling so Ctrl+wheel / pinch can zoom.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setZoom((z) => Math.max(1, Math.min(8, z * factor)));
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  // Pointer-based drag to pan (only meaningful when zoomed). These handlers
  // live on the image area only, so clicking chrome (nav buttons, filmstrip…)
  // can never trigger swipe-to-next.
  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || zoom <= 1) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    setPan(clampPan(d.px + dx, d.py + dy));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (zoom <= 1 && d && !d.moved) goTo(index + (e.clientX < window.innerWidth / 2 ? -1 : 1));
  };

  // Touch: pinch to zoom via native touch events on the image area.
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      touchZoomRef.current = { dist, zoom };
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const tz = touchZoomRef.current;
    if (tz && e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      setZoom(Math.max(1, Math.min(8, (tz.zoom * dist) / Math.max(tz.dist, 1))));
    }
  };
  const onTouchEnd = () => { touchZoomRef.current = null; };

  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    setLoaded(true);
    const c = dominantColor(e.currentTarget, photo.id);
    if (c) setAmbient(c);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().then(() => setFullscreen(true)).catch(() => {});
    else document.exitFullscreen?.().then(() => setFullscreen(false)).catch(() => {});
  };

  const imgSrc = photoRaw(photo.root_id, photo.path);
  const thumb = photoThumb(photo.root_id, photo.path, 160);

  const filmstrip = useMemo(() => {
    const out: { photo: PhotoResult; i: number }[] = [];
    for (let d = -6; d <= 6; d++) {
      const i = ((index + d) % total + total) % total;
      out.push({ photo: photos[i], i });
    }
    return out;
  }, [index, photos, total]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 overflow-hidden text-white"
      style={{
        background: ambient
          ? `radial-gradient(130% 130% at 50% 40%, ${ambient} 0%, rgba(0,0,0,0.82) 62%, #000 100%)`
          : "radial-gradient(130% 130% at 50% 40%, #14151a 0%, #000 100%)",
      }}
      role="dialog"
      aria-label="Photo viewer"
    >
      {/* ambient color transition */}
      <div key={photo.id} className="pointer-events-none absolute inset-0 transition-opacity duration-500" />

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-1 bg-gradient-to-b from-black/60 to-transparent p-3 sm:p-4">
        <button onClick={onClose} aria-label="Close viewer" className="rounded-full p-2 glass-hover">
          <X className="h-5 w-5" />
        </button>
        <div className="ml-2 min-w-0">
          <p className="truncate text-sm font-medium">{photo.name}</p>
          <p className="text-xs text-white/60">{index + 1} of {total}{hasGeo ? " · has location" : ""}</p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => { onToggleFavorite(photo); }}
            aria-label="Toggle favorite"
            className={cn("rounded-full p-2 glass-hover", photo.is_favorite && "text-amber-400")}
          >
            <Star className={cn("h-5 w-5", photo.is_favorite && "fill-current")} />
          </button>
          <button
            onClick={() => setPanel((p) => (p === "info" ? null : "info"))}
            aria-label="Photo info"
            className={cn("rounded-full p-2 glass-hover", panel === "info" && "bg-white/20")}
          >
            <Info className="h-5 w-5" />
          </button>
          {hasGeo && (
            <button
              onClick={() => setPanel((p) => (p === "map" ? null : "map"))}
              aria-label="Location"
              className={cn("rounded-full p-2 glass-hover", panel === "map" && "bg-white/20")}
            >
              <MapPin className="h-5 w-5" />
            </button>
          )}
          <button
            onClick={() => void onShare(photo).then(() => setShared(true))}
            aria-label="Share"
            className="rounded-full p-2 glass-hover"
          >
            {shared ? <Check className="h-5 w-5 text-emerald-400" /> : <Share2 className="h-5 w-5" />}
          </button>
          <button onClick={toggleFullscreen} aria-label="Fullscreen" className="rounded-full p-2 glass-hover">
            {fullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Main image */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ cursor: zoom > 1 ? "grab" : "pointer" }}
        onDoubleClick={toggleZoom}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div
          className="relative will-change-transform"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) rotate(${rotate}deg) scale(${zoom})`, transition: "transform 0.12s ease-out" }}
        >
          {!loaded && !broken && (
            <img src={thumb} alt="" className="max-h-[70vh] max-w-[80vw] rounded-md opacity-50 blur-[1px]" />
          )}
          <img
            ref={imgRef}
            src={imgSrc}
            alt={photo.name}
            draggable={false}
            onLoad={onImgLoad}
            onError={() => setBroken(true)}
            className={cn("max-h-[92vh] max-w-[94vw] rounded-lg object-contain shadow-2xl shadow-black/50", loaded ? "" : "hidden")}
          />
          {!loaded && !broken && (
            <div className="absolute inset-0 grid place-items-center">
              <Loader2 className="h-6 w-6 animate-spin text-white/70" />
            </div>
          )}
          {broken && (
            <div className="grid h-64 w-96 max-w-[80vw] place-items-center rounded-xl bg-black/50 text-white/60">
              <div className="flex flex-col items-center gap-2">
                <ImageOff className="h-8 w-8" />
                <p className="text-sm">Couldn't load this image</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Prev / Next */}
      {total > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); goTo(index - 1); }}
            aria-label="Previous photo"
            className="absolute left-2 sm:left-4 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/40 p-2.5 backdrop-blur glass-hover"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); goTo(index + 1); }}
            aria-label="Next photo"
            className="absolute right-2 sm:right-4 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/40 p-2.5 backdrop-blur glass-hover"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      {/* Filmstrip */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex items-end gap-1.5 overflow-x-auto px-3 pb-3 hide-scrollbar">
        {filmstrip.map(({ photo: fp, i }) => (
          <button
            key={fp.id + i}
            onClick={() => goTo(i)}
            className={cn(
              "relative h-12 w-12 shrink-0 overflow-hidden rounded-md ring-1 transition-all",
              i === index ? "h-16 w-16 ring-2 ring-white" : "ring-white/20 opacity-60 hover:opacity-100"
            )}
          >
            <img src={photoThumb(fp.root_id, fp.path, 128)} alt="" loading="lazy" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>

      {/* Bottom-left utility row */}
      <div className="absolute bottom-4 left-3 z-20 flex items-center gap-1 sm:left-4">
        <button onClick={() => setZoom((z) => Math.max(1, z / ZOOM_STEP))} aria-label="Zoom out" className="rounded-full bg-black/40 p-2 backdrop-blur glass-hover">
          <ZoomOut className="h-4 w-4" />
        </button>
        <button onClick={toggleZoom} aria-label="Reset zoom" className="rounded-full bg-black/40 px-3 py-2 text-xs backdrop-blur glass-hover">
          {Math.round(zoom * 100)}%
        </button>
        <button onClick={() => setZoom((z) => Math.min(8, z * ZOOM_STEP))} aria-label="Zoom in" className="rounded-full bg-black/40 p-2 backdrop-blur glass-hover">
          <ZoomIn className="h-4 w-4" />
        </button>
        <button onClick={() => setRotate((r) => (r + 90) % 360)} aria-label="Rotate" className="rounded-full bg-black/40 p-2 backdrop-blur glass-hover">
          <RotateCw className="h-4 w-4" />
        </button>
        <button
          onClick={() => {
            const a = document.createElement("a");
            a.href = photoRaw(photo.root_id, photo.path, true);
            a.download = photo.name || "photo";
            document.body.appendChild(a);
            a.click();
            a.remove();
          }}
          aria-label="Download"
          className="rounded-full bg-black/40 p-2 backdrop-blur glass-hover"
        >
          <Download className="h-4 w-4" />
        </button>
        <button
          onClick={() => onOpenInFolder(photo)}
          aria-label="Open in folder"
          className="hidden rounded-full bg-black/40 p-2 backdrop-blur glass-hover sm:block"
        >
          <FolderOpen className="h-4 w-4" />
        </button>
        <button
          onClick={() => onDelete(photo)}
          aria-label="Delete photo"
          className="rounded-full bg-black/40 p-2 backdrop-blur glass-hover hover:text-red-400"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Info panel */}
      <AnimatePresence>
        {panel && (
          <motion.aside
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute right-0 top-0 z-30 h-full w-80 max-w-[85vw] overflow-y-auto border-l border-white/10 bg-black/70 p-5 backdrop-blur-xl"
          >
            {panel === "info" ? (
              <>
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Details</h3>
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="text-white/50">Name</dt>
                    <dd className="break-all text-white/90">{photo.name}</dd>
                  </div>
                  <div>
                    <dt className="text-white/50">Taken</dt>
                    <dd>{formatDate(photo.date_taken)}</dd>
                  </div>
                  {photo.make || photo.model ? (
                    <div>
                      <dt className="text-white/50">Camera</dt>
                      <dd>{[photo.make, photo.model].filter(Boolean).join(" ")}</dd>
                    </div>
                  ) : null}
                  {photo.width && photo.height ? (
                    <div>
                      <dt className="text-white/50">Resolution</dt>
                      <dd>{photo.width} × {photo.height} px</dd>
                    </div>
                  ) : null}
                  {hasGeo ? (
                    <div>
                      <dt className="text-white/50">Location</dt>
                      <dd className="font-mono text-xs">
                        {photo.lat!.toFixed(5)}, {photo.lng!.toFixed(5)}
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-white/50">Path</dt>
                    <dd className="break-all font-mono text-xs text-white/70">{photo.path}</dd>
                  </div>
                </dl>
                <button
                  onClick={() => onOpenInFolder(photo)}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium glass-hover"
                >
                  <FolderOpen className="h-4 w-4" /> Open in folder
                </button>
                {hasGeo && (
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${photo.lat}&mlon=${photo.lng}#map=15/${photo.lat}/${photo.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium glass-hover"
                  >
                    <MapPin className="h-4 w-4" /> View on OpenStreetMap
                  </a>
                )}
              </>
            ) : (
              <>
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Location</h3>
                <div className="aspect-square w-full overflow-hidden rounded-lg bg-black/40">
                  <iframe
                    title="Map"
                    className="h-full w-full border-0"
                    loading="lazy"
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${photo.lng! - 0.01}%2C${photo.lat! - 0.008}%2C${photo.lng! + 0.01}%2C${photo.lat! + 0.008}&layer=mapnik&marker=${photo.lat}%2C${photo.lng}`}
                  />
                </div>
                <a
                  href={`https://www.openstreetmap.org/?mlat=${photo.lat}&mlon=${photo.lng}#map=15/${photo.lat}/${photo.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium glass-hover"
                >
                  <MapPin className="h-4 w-4" /> Open full map
                </a>
              </>
            )}
          </motion.aside>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
