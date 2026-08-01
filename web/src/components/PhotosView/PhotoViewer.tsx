import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCcw, RotateCw, Download, Share2, Info, MapPin, Star, MoreHorizontal, Expand, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { PhotoResult } from "./types";
import { getMediaUrl } from "@/api/client";
import { rawUrl } from "@/lib/preview";

const MIN_ZOOM = 1;
const MAX_ZOOM = 10;
const SWIPE_THRESHOLD = 50;

interface PhotoViewerProps {
  photos: PhotoResult[];
  initialIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onSelectionToggle: (id: string) => void;
  selectedIds: Set<string>;
  /** Panel to open on mount (e.g. opened from "Show details" action). */
  initialPanel?: "info" | "map" | null;
  onDownload?: (photo: PhotoResult) => void;
  onShare?: (photo: PhotoResult) => void;
}

/**
 * Clamp a pan offset so the image can't be dragged fully off-screen.
 * Bounds depend on zoom and the viewer's viewport size.
 */
function clampPan(pan: { x: number; y: number }, zoom: number, viewport: { w: number; h: number }, imageSize: { width: number; height: number }) {
  if (zoom <= 1) return { x: 0, y: 0 };
  // Effective rendered image size at this zoom level.
  const scale = Math.min(viewport.w / imageSize.width, viewport.h / imageSize.height) || 1;
  const imgW = imageSize.width * scale * zoom;
  const imgH = imageSize.height * scale * zoom;

  const maxX = Math.max(0, (imgW - viewport.w) / 2);
  const maxY = Math.max(0, (imgH - viewport.h) / 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, pan.x)),
    y: Math.max(-maxY, Math.min(maxY, pan.y)),
  };
}

export function PhotoViewer({
  photos,
  initialIndex,
  onClose,
  onNavigate,
  onSelectionToggle,
  selectedIds,
  initialPanel = null,
  onDownload,
  onShare,
}: PhotoViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [showUI, setShowUI] = useState(true);
  const [showMetadata, setShowMetadata] = useState(initialPanel === "info");
  const [showMap, setShowMap] = useState(initialPanel === "map");
  const [rotation, setRotation] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 });
  const [touchState, setTouchState] = useState<{
    startX: number;
    startY: number;
    startZoom: number;
    startPan: { x: number; y: number };
    distance: number;
  } | null>(null);

  const viewerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const thumbnailStripRef = useRef<HTMLDivElement>(null);
  const hideUITimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const viewportSize = useRef({ w: 0, h: 0 });

  const currentPhoto = photos[currentIndex];
  const isSelected = selectedIds.has(currentPhoto?.id || "");

  // Sync external index changes (e.g. "show details" while already open).
  useEffect(() => {
    setCurrentIndex(initialIndex);
  }, [initialIndex]);

  // Reset zoom/pan on photo change
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
    setIsLoading(true);
    setImageError(false);
    setImageNaturalSize({ width: 0, height: 0 });
  }, [currentIndex]);

  // Measure the viewport once the viewer mounts (used for pan clamping).
  useEffect(() => {
    if (containerRef.current) {
      viewportSize.current = {
        w: containerRef.current.clientWidth,
        h: containerRef.current.clientHeight,
      };
    }
  }, []);

  // Load image and get natural dimensions
  const handleImageLoad = useCallback(() => {
    if (imageRef.current) {
      setImageNaturalSize({
        width: imageRef.current.naturalWidth,
        height: imageRef.current.naturalHeight,
      });
    }
    setIsLoading(false);
  }, []);

  const handleImageError = useCallback(() => {
    setIsLoading(false);
    setImageError(true);
  }, []);

  // Auto-hide UI after 3 seconds of inactivity
  const resetHideTimer = useCallback(() => {
    if (hideUITimer.current) clearTimeout(hideUITimer.current);
    setShowUI(true);
    hideUITimer.current = setTimeout(() => setShowUI(false), 3000);
  }, []);

  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideUITimer.current) clearTimeout(hideUITimer.current);
    };
  }, [resetHideTimer]);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
  }, []);

  const applyZoom = useCallback(
    (nextZoom: number, anchor?: { x: number; y: number }) => {
      const z = Math.min(Math.max(nextZoom, MIN_ZOOM), MAX_ZOOM);
      setZoom(z);
      if (z <= 1) {
        setPan({ x: 0, y: 0 });
        return;
      }
      // Keep the point under the cursor stable when zooming with a wheel anchor.
      if (anchor && imageRef.current) {
        const rect = imageRef.current.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const px = anchor.x - rect.left;
        const py = anchor.y - rect.top;
        const ratio = (z - zoom) / zoom;
        setPan((p) => clampPan(
          { x: p.x - (px - cx) * ratio, y: p.y - (py - cy) * ratio },
          z,
          viewportSize.current,
          imageNaturalSize
        ));
      }
    },
    [zoom, imageNaturalSize]
  );

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case "Escape":
          // Close panels first, then the viewer.
          if (showMetadata) setShowMetadata(false);
          else if (showMap) setShowMap(false);
          else onClose();
          break;
        case "ArrowLeft":
          if (currentIndex > 0) {
            const next = currentIndex - 1;
            setCurrentIndex(next);
            onNavigate(next);
          }
          break;
        case "ArrowRight":
        case " ":
          e.preventDefault();
          if (currentIndex < photos.length - 1) {
            const next = currentIndex + 1;
            setCurrentIndex(next);
            onNavigate(next);
          }
          break;
        case "+":
        case "=":
          e.preventDefault();
          applyZoom(zoom + 1);
          break;
        case "-":
          e.preventDefault();
          applyZoom(zoom - 1);
          break;
        case "0":
        case "f":
          e.preventDefault();
          resetView();
          break;
        case "r":
          setRotation((r) => (r + 90) % 360);
          break;
        case "i":
          setShowMetadata((s) => !s);
          break;
        case "m":
          if (currentPhoto?.lat != null && currentPhoto?.lng != null) {
            setShowMap((s) => !s);
          }
          break;
        case "s":
          if (currentPhoto) onSelectionToggle(currentPhoto.id);
          break;
        case "d":
          e.preventDefault();
          if (currentPhoto) onDownload?.(currentPhoto);
          break;
        case "t":
          // Share shortcut (matches context menu convention)
          if (currentPhoto) onShare?.(currentPhoto);
          break;
      }
      resetHideTimer();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentIndex, photos.length, onClose, onNavigate, currentPhoto, onSelectionToggle, resetHideTimer, applyZoom, resetView, zoom, showMetadata, showMap, onDownload, onShare]);

  // ── Non-passive native listeners for wheel/touch so preventDefault works ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY > 0 ? 1 / 1.1 : 1.1;
        applyZoom(zoom * factor, anchor);
      } else if (zoom > 1) {
        // Pan with the wheel when zoomed in.
        setPan((p) => clampPan(
          { x: p.x - e.deltaX, y: p.y - e.deltaY },
          zoom,
          viewportSize.current,
          imageNaturalSize
        ));
      }
      resetHideTimer();
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!touchState) return;
      if (e.touches.length === 1 && touchState.distance === 0) {
        const touch = e.touches[0];
        const deltaX = touch.clientX - touchState.startX;
        const deltaY = touch.clientY - touchState.startY;
        if (zoom > 1) {
          e.preventDefault();
          setPan((p) => clampPan(
            { x: touchState.startPan.x + deltaX, y: touchState.startPan.y + deltaY },
            zoom,
            viewportSize.current,
            imageNaturalSize
          ));
        }
      } else if (e.touches.length === 2 && touchState.distance > 0) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const distance = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        const scale = distance / touchState.distance;
        setZoom(Math.min(Math.max(touchState.startZoom * scale, MIN_ZOOM), MAX_ZOOM));
        // Pan with the pinch midpoint so the gesture feels anchored.
        const midX = (t1.clientX + t2.clientX) / 2;
        const midY = (t1.clientY + t2.clientY) / 2;
        setPan((p) => clampPan(
          {
            x: touchState.startPan.x + (midX - touchState.startX),
            y: touchState.startPan.y + (midY - touchState.startY),
          },
          touchState.startZoom * scale,
          viewportSize.current,
          imageNaturalSize
        ));
      }
      resetHideTimer();
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, [zoom, touchState, imageNaturalSize, applyZoom, resetHideTimer]);

  // Mouse drag to pan (only when zoomed in)
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if (zoom <= 1) return; // never pan at 1x — keeps image centered
      if (e.target !== imageRef.current && e.target !== containerRef.current) return;

      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      document.body.style.cursor = "grabbing";
      resetHideTimer();
    },
    [zoom, pan, resetHideTimer]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isPanning) return;
      setPan((p) => clampPan(
        { x: e.clientX - panStart.x, y: e.clientY - panStart.y },
        zoom,
        viewportSize.current,
        imageNaturalSize
      ));
    };

    const handleMouseUp = () => {
      setIsPanning(false);
      document.body.style.cursor = "";
    };

    if (isPanning) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
    };
  }, [isPanning, panStart, zoom, imageNaturalSize]);

  // Touch gesture state
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        setTouchState({
          startX: touch.clientX,
          startY: touch.clientY,
          startZoom: zoom,
          startPan: pan,
          distance: 0,
        });
      } else if (e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const distance = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        setTouchState({
          startX: (t1.clientX + t2.clientX) / 2,
          startY: (t1.clientY + t2.clientY) / 2,
          startZoom: zoom,
          startPan: pan,
          distance,
        });
      }
      resetHideTimer();
    },
    [zoom, pan, resetHideTimer]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchState) return;

      const deltaX = (e.changedTouches[0]?.clientX || 0) - touchState.startX;
      const deltaY = (e.changedTouches[0]?.clientY || 0) - touchState.startY;

      // Horizontal swipe to navigate (only when not zoomed and not panning)
      if (zoom <= 1 && Math.abs(deltaX) > SWIPE_THRESHOLD && Math.abs(deltaY) < SWIPE_THRESHOLD) {
        if (deltaX < 0 && currentIndex < photos.length - 1) {
          const next = currentIndex + 1;
          setCurrentIndex(next);
          onNavigate(next);
        } else if (deltaX > 0 && currentIndex > 0) {
          const next = currentIndex - 1;
          setCurrentIndex(next);
          onNavigate(next);
        }
      }

      setTouchState(null);
      resetHideTimer();
    },
    [touchState, zoom, currentIndex, photos.length, onNavigate, resetHideTimer]
  );

  // Double click/tap to zoom
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (zoom === 1) {
        setZoom(2);
        if ("clientX" in e) {
          const rect = imageRef.current?.getBoundingClientRect();
          if (rect) {
            setPan((p) => clampPan(
              {
                x: -(e.clientX - rect.left - rect.width / 2) * 2 + rect.width / 2,
                y: -(e.clientY - rect.top - rect.height / 2) * 2 + rect.height / 2,
              },
              2,
              viewportSize.current,
              imageNaturalSize
            ));
          }
        }
      } else {
        resetView();
      }
      resetHideTimer();
    },
    [zoom, imageNaturalSize, resetHideTimer, resetView]
  );

  // Thumbnail strip scroll to keep current visible
  const scrollThumbnailIntoView = useCallback(() => {
    if (thumbnailStripRef.current) {
      const thumb = thumbnailStripRef.current.querySelector(`[data-index="${currentIndex}"]`);
      if (thumb) {
        thumb.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      }
    }
  }, [currentIndex]);

  useEffect(() => {
    scrollThumbnailIntoView();
  }, [currentIndex, scrollThumbnailIntoView]);

  // Build image URLs — full-res raw file with a low-res thumbnail placeholder.
  const imageUrl = currentPhoto ? rawUrl(currentPhoto.root_id, currentPhoto.path) : "";
  const placeholderUrl = currentPhoto
    ? getMediaUrl("/files/thumbnail", { root: currentPhoto.root_id, path: currentPhoto.path, size: 400 })
    : "";

  const transform = useMemo(() => {
    return `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`;
  }, [pan, zoom, rotation]);

  return (
    <motion.div
      ref={viewerRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 backdrop-blur-sm"
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onDoubleClick={handleDoubleClick}
      onClick={() => resetHideTimer()}
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
    >
      {/* Background click to close */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Image container */}
      <div
        ref={containerRef}
        className="relative flex-1 w-full h-full flex items-center justify-center overflow-hidden"
        style={{ touchAction: "none" }}
        onClick={(e) => e.stopPropagation()}
      >
        {currentPhoto && (
          <AnimatePresence mode="wait">
            <motion.div
              key={currentIndex}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.04 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="relative flex items-center justify-center"
            >
              {/* Low-res placeholder while the full image streams in */}
              {placeholderUrl && isLoading && (
                <img
                  src={placeholderUrl}
                  alt=""
                  aria-hidden
                  className="absolute inset-0 w-full h-full object-contain blur-sm scale-105 select-none"
                />
              )}

              {!imageError ? (
                <img
                  ref={imageRef}
                  src={imageUrl}
                  alt={currentPhoto?.name || "Photo"}
                  onLoad={handleImageLoad}
                  onError={handleImageError}
                  draggable={false}
                  style={{
                    transform,
                    transformOrigin: "center center",
                    maxWidth: zoom > 1 ? "none" : "100%",
                    maxHeight: zoom > 1 ? "none" : "100%",
                    width: zoom > 1 ? imageNaturalSize.width : "auto",
                    height: zoom > 1 ? imageNaturalSize.height : "auto",
                    userSelect: "none",
                    pointerEvents: zoom > 1 ? "auto" : "none",
                    opacity: isLoading ? 0 : 1,
                    transition: "opacity 0.25s ease",
                  }}
                  className="select-none"
                />
              ) : (
                <div className="flex flex-col items-center gap-3 text-white/60">
                  <ImageOff className="h-14 w-14" />
                  <p className="text-sm">This image could not be loaded</p>
                  <p className="font-mono text-xs text-white/40 max-w-xs truncate">{currentPhoto.name}</p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        )}

        {/* Loading spinner */}
        {isLoading && !imageError && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        )}

        {/* Zoom indicator */}
        {zoom !== 1 && showUI && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/70 backdrop-blur text-white text-sm font-mono"
          >
            {Math.round(zoom * 100)}%
          </motion.div>
        )}
      </div>

      {/* Top Bar */}
      <AnimatePresence>
        {showUI && (
          <motion.div
            initial={{ y: -60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -60, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute top-0 left-0 right-0 px-4 py-4 flex items-center justify-between pointer-events-none z-10"
          >
            <div className="pointer-events-auto flex items-center gap-2">
              <motion.button
                onClick={onClose}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className="p-2 rounded-full bg-black/50 backdrop-blur text-white hover:bg-black/70 transition-colors"
                aria-label="Close (Esc)"
              >
                <X className="h-6 w-6" />
              </motion.button>

              <div className="ml-4 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur text-white text-sm font-mono">
                {currentIndex + 1} / {photos.length}
              </div>
            </div>

            <div className="pointer-events-auto flex items-center gap-2">
              <motion.button
                onClick={() => setShowMetadata(!showMetadata)}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className={cn(
                  "p-2 rounded-full bg-black/50 backdrop-blur text-white transition-colors",
                  showMetadata ? "bg-accent/80" : "hover:bg-black/70"
                )}
                aria-label="Info (i)"
                aria-pressed={showMetadata}
              >
                <Info className="h-5 w-5" />
              </motion.button>

              {currentPhoto?.lat != null && currentPhoto?.lng != null && (
                <motion.button
                  onClick={() => setShowMap(!showMap)}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  className={cn(
                    "p-2 rounded-full bg-black/50 backdrop-blur text-white transition-colors",
                    showMap ? "bg-accent/80" : "hover:bg-black/70"
                  )}
                  aria-label="Map (m)"
                  aria-pressed={showMap}
                >
                  <MapPin className="h-5 w-5" />
                </motion.button>
              )}

              <motion.button
                onClick={() => {
                  if (currentPhoto) onSelectionToggle(currentPhoto.id);
                }}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className={cn(
                  "p-2 rounded-full bg-black/50 backdrop-blur transition-colors",
                  isSelected ? "bg-accent/80 text-white" : "text-white hover:bg-black/70"
                )}
                aria-label={isSelected ? "Remove from selection" : "Add to selection"}
                aria-pressed={isSelected}
              >
                <Star className={cn("h-5 w-5", isSelected && "fill-current")} />
              </motion.button>

              <motion.button
                onClick={() => currentPhoto && onDownload?.(currentPhoto)}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className="p-2 rounded-full bg-black/50 backdrop-blur text-white hover:bg-black/70 transition-colors"
                aria-label="Download (d)"
              >
                <Download className="h-5 w-5" />
              </motion.button>

              <motion.button
                onClick={() => currentPhoto && onShare?.(currentPhoto)}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className="p-2 rounded-full bg-black/50 backdrop-blur text-white hover:bg-black/70 transition-colors"
                aria-label="Share (t)"
              >
                <Share2 className="h-5 w-5" />
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className="p-2 rounded-full bg-black/50 backdrop-blur text-white hover:bg-black/70 transition-colors"
                aria-label="More"
              >
                <MoreHorizontal className="h-5 w-5" />
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Bar - Thumbnail Strip + Controls */}
      <AnimatePresence>
        {showUI && (
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute bottom-0 left-0 right-0 p-4 pointer-events-none z-10"
          >
            <div className="pointer-events-auto flex flex-col items-center gap-4">
              {/* Thumbnail Strip */}
              <div
                ref={thumbnailStripRef}
                className="flex gap-2 overflow-x-auto pb-2 hide-scrollbar max-w-[80vw]"
                role="tablist"
                aria-label="Photo thumbnails"
              >
                {photos.map((photo, index) => (
                  <motion.button
                    key={photo.id}
                    onClick={() => {
                      setCurrentIndex(index);
                      onNavigate(index);
                    }}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className={cn(
                      "relative shrink-0 w-20 h-20 rounded-lg overflow-hidden border-2 transition-all",
                      index === currentIndex
                        ? "border-accent ring-2 ring-accent ring-offset-2 ring-offset-black"
                        : "border-transparent hover:border-white/30"
                    )}
                    data-index={index}
                    role="tab"
                    aria-selected={index === currentIndex}
                    aria-label={`${photo.name}, ${index + 1} of ${photos.length}`}
                  >
                    <img
                      src={getMediaUrl("/files/thumbnail", { root: photo.root_id, path: photo.path, size: 160 })}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    {index === currentIndex && (
                      <div className="absolute inset-0 bg-accent/20" />
                    )}
                  </motion.button>
                ))}
              </div>

              {/* Zoom/Nav Controls */}
              <div className="flex items-center gap-3 px-4 py-2 rounded-full bg-black/50 backdrop-blur border border-white/10">
                <motion.button
                  onClick={() => applyZoom(zoom - 1)}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  disabled={zoom <= MIN_ZOOM}
                  className="p-2 rounded-full text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Zoom out (-)"
                >
                  <ZoomOut className="h-5 w-5" />
                </motion.button>

                <motion.button
                  onClick={resetView}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  className="p-2 rounded-full text-white hover:bg-white/10 transition-colors"
                  aria-label="Reset zoom (0)"
                >
                  <Expand className="h-5 w-5" />
                </motion.button>

                <motion.button
                  onClick={() => applyZoom(zoom + 1)}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  disabled={zoom >= MAX_ZOOM}
                  className="p-2 rounded-full text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Zoom in (+)"
                >
                  <ZoomIn className="h-5 w-5" />
                </motion.button>

                <div className="w-px h-6 bg-white/20 mx-1" />

                <motion.button
                  onClick={() => setRotation((r) => (r + 270) % 360)}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  className="p-2 rounded-full text-white hover:bg-white/10 transition-colors"
                  aria-label="Rotate left"
                >
                  <RotateCcw className="h-5 w-5" />
                </motion.button>

                <motion.button
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  className="p-2 rounded-full text-white hover:bg-white/10 transition-colors"
                  aria-label="Rotate right"
                >
                  <RotateCw className="h-5 w-5" />
                </motion.button>

                <div className="w-px h-6 bg-white/20 mx-1" />

                <motion.button
                  onClick={() => {
                    if (currentIndex > 0) {
                      const next = currentIndex - 1;
                      setCurrentIndex(next);
                      onNavigate(next);
                    }
                  }}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  disabled={currentIndex === 0}
                  className="p-2 rounded-full text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Previous photo (←)"
                >
                  <ChevronLeft className="h-6 w-6" />
                </motion.button>

                <motion.button
                  onClick={() => {
                    if (currentIndex < photos.length - 1) {
                      const next = currentIndex + 1;
                      setCurrentIndex(next);
                      onNavigate(next);
                    }
                  }}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  disabled={currentIndex === photos.length - 1}
                  className="p-2 rounded-full text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Next photo (→)"
                >
                  <ChevronRight className="h-6 w-6" />
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Metadata Sidebar */}
      <AnimatePresence>
        {showMetadata && currentPhoto && (
          <motion.div
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="absolute top-0 right-0 bottom-0 w-80 bg-black/90 backdrop-blur border-l border-white/10 overflow-y-auto z-20"
          >
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="font-semibold">Information</h3>
              <button
                onClick={() => setShowMetadata(false)}
                className="p-1 rounded hover:bg-white/10 transition-colors"
                aria-label="Close info"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 space-y-4 text-sm">
              <InfoRow label="File name" value={currentPhoto.name} mono />
              <InfoRow
                label="Date taken"
                value={formatSafeDate(currentPhoto.date_taken)}
              />
              {currentPhoto.make && (
                <InfoRow label="Camera" value={`${currentPhoto.make} ${currentPhoto.model || ""}`.trim()} />
              )}
              {currentPhoto.lat != null && currentPhoto.lng != null && (
                <InfoRow
                  label="Location"
                  value={`${currentPhoto.lat.toFixed(6)}, ${currentPhoto.lng.toFixed(6)}`}
                  mono
                />
              )}
              {currentPhoto.is_favorite && (
                <div className="flex items-center gap-2 text-yellow-400">
                  <Star className="h-4 w-4 fill-current" />
                  Favorite
                </div>
              )}
              {!currentPhoto.make && currentPhoto.lat == null && (
                <p className="text-content-muted text-xs">
                  No additional metadata is indexed for this photo yet. The background scanner
                  extracts EXIF data periodically.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Map View */}
      <AnimatePresence>
        {showMap && currentPhoto?.lat != null && currentPhoto?.lng != null && (
          <motion.div
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="absolute top-0 right-0 bottom-0 w-96 bg-black/90 backdrop-blur border-l border-white/10 z-20"
          >
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="font-semibold">Location</h3>
              <button
                onClick={() => setShowMap(false)}
                className="p-1 rounded hover:bg-white/10 transition-colors"
                aria-label="Close map"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="h-full relative" style={{ width: "100%", height: "100%" }}>
              {/* Embedded map via OpenStreetMap static tile viewer */}
              <div className="flex flex-col items-center justify-center h-full text-content-muted gap-3">
                <div className="text-xs">
                  {currentPhoto.lat.toFixed(6)}, {currentPhoto.lng.toFixed(6)}
                </div>
                <a
                  href={`https://www.openstreetmap.org/?mlat=${currentPhoto.lat}&mlon=${currentPhoto.lng}#map=15/${currentPhoto.lat}/${currentPhoto.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-2 rounded-lg bg-accent/20 text-accent hover:bg-accent/30 text-sm font-medium transition-colors"
                >
                  Open in OpenStreetMap
                </a>
                <iframe
                  title="Photo location map"
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${currentPhoto.lng - 0.01}%2C${currentPhoto.lat - 0.01}%2C${currentPhoto.lng + 0.01}%2C${currentPhoto.lat + 0.01}&layer=mapnik&marker=${currentPhoto.lat}%2C${currentPhoto.lng}`}
                  className="w-full flex-1 border-0"
                  loading="lazy"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-content-muted">{label}</p>
      <p className={cn(mono && "font-mono break-all")}>{value}</p>
    </div>
  );
}

function formatSafeDate(dateStr: string): string {
  if (!dateStr) return "Unknown";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleString();
}
