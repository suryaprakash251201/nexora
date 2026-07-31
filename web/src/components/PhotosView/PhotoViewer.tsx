import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCcw, RotateCw, Download, Share2, Info, MapPin, Star, Trash2, MoreHorizontal, Expand, Minimize } from "lucide-react";
import { cn } from "@/lib/utils";
import { PhotoResult } from "@/api/types";
import { getMediaUrl } from "@/api/client";

interface PhotoViewerProps {
  photos: PhotoResult[];
  initialIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onSelectionToggle: (id: string) => void;
  selectedIds: Set<string>;
}

export function PhotoViewer({
  photos,
  initialIndex,
  onClose,
  onNavigate,
  onSelectionToggle,
  selectedIds,
}: PhotoViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [showUI, setShowUI] = useState(true);
  const [showMetadata, setShowMetadata] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
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
  const hideUITimer = useRef<NodeJS.Timeout>();

  const currentPhoto = photos[currentIndex];
  const isSelected = selectedIds.has(currentPhoto?.id || "");

  // Reset zoom/pan on photo change
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
    setIsLoading(true);
    setImageNaturalSize({ width: 0, height: 0 });
  }, [currentIndex]);

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

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowLeft":
          if (currentIndex > 0) {
            setCurrentIndex((i) => i - 1);
            onNavigate(currentIndex - 1);
          }
          break;
        case "ArrowRight":
          if (currentIndex < photos.length - 1) {
            setCurrentIndex((i) => i + 1);
            onNavigate(currentIndex + 1);
          }
          break;
        case " ":
          e.preventDefault();
          if (currentIndex < photos.length - 1) {
            setCurrentIndex((i) => i + 1);
            onNavigate(currentIndex + 1);
          }
          break;
        case "+":
        case "=":
          e.preventDefault();
          setZoom((z) => Math.min(z * 1.25, 10));
          break;
        case "-":
          e.preventDefault();
          setZoom((z) => Math.max(z / 1.25, 0.1));
          break;
        case "0":
          e.preventDefault();
          setZoom(1);
          setPan({ x: 0, y: 0 });
          break;
        case "f":
          setZoom(1);
          setPan({ x: 0, y: 0 });
          break;
        case "r":
          setRotation((r) => (r + 90) % 360);
          break;
        case "i":
          setShowMetadata((s) => !s);
          break;
        case "m":
          if (currentPhoto?.lat && currentPhoto?.lng) {
            setShowMap((s) => !s);
          }
          break;
        case "s":
          if (currentPhoto) onSelectionToggle(currentPhoto.id);
          break;
        case "d":
          // Download
          break;
      }
      resetHideTimer();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentIndex, photos.length, onClose, onNavigate, currentPhoto, onSelectionToggle, resetHideTimer]);

  // Mouse wheel zoom
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setZoom((z) => Math.min(Math.max(z * delta, 0.1), 10));
      } else if (zoom > 1) {
        // Pan with shift+wheel or when zoomed
        setPan((p) => ({
          x: p.x - e.deltaX * 0.5,
          y: p.y - e.deltaY * 0.5,
        }));
      }
      resetHideTimer();
    },
    [zoom, resetHideTimer]
  );

  // Mouse drag to pan
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (zoom <= 1 && e.button !== 0) return;
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
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
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
  }, [isPanning, panStart]);

  // Touch handling for pinch zoom + swipe
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 1) {
        // Single touch - potential swipe or pan
        const touch = e.touches[0];
        setTouchState({
          startX: touch.clientX,
          startY: touch.clientY,
          startZoom: zoom,
          startPan: pan,
          distance: 0,
        });
      } else if (e.touches.length === 2) {
        // Two touches - pinch zoom
        e.preventDefault();
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const distance = Math.hypot(touch1.clientX - touch2.clientX, touch1.clientY - touch2.clientY);
        setTouchState({
          startX: (touch1.clientX + touch2.clientX) / 2,
          startY: (touch1.clientY + touch2.clientY) / 2,
          startZoom: zoom,
          startPan: pan,
          distance,
        });
      }
      resetHideTimer();
    },
    [zoom, pan, resetHideTimer]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!touchState) return;

      if (e.touches.length === 1 && touchState.distance === 0) {
        // Pan or swipe
        const touch = e.touches[0];
        const deltaX = touch.clientX - touchState.startX;
        const deltaY = touch.clientY - touchState.startY;

        if (zoom > 1) {
          // Pan when zoomed
          e.preventDefault();
          setPan({
            x: touchState.startPan.x + deltaX,
            y: touchState.startPan.y + deltaY,
          });
        }
      } else if (e.touches.length === 2) {
        // Pinch zoom
        e.preventDefault();
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const distance = Math.hypot(touch1.clientX - touch2.clientX, touch1.clientY - touch2.clientY);
        const scale = distance / touchState.distance;
        setZoom(Math.min(Math.max(touchState.startZoom * scale, 0.1), 10));
      }
    },
    [touchState, zoom]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchState) return;

      const deltaX = (e.changedTouches[0]?.clientX || 0) - touchState.startX;
      const deltaY = (e.changedTouches[0]?.clientY || 0) - touchState.startY;
      const swipeThreshold = 50;

      // Horizontal swipe to navigate (only when not zoomed and not panning)
      if (zoom <= 1 && Math.abs(deltaX) > swipeThreshold && Math.abs(deltaY) < swipeThreshold) {
        if (deltaX < 0 && currentIndex < photos.length - 1) {
          setCurrentIndex((i) => i + 1);
          onNavigate(currentIndex + 1);
        } else if (deltaX > 0 && currentIndex > 0) {
          setCurrentIndex((i) => i - 1);
          onNavigate(currentIndex - 1);
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
        // Center zoom on click point
        if ("clientX" in e) {
          const rect = imageRef.current?.getBoundingClientRect();
          if (rect) {
            setPan({
              x: -(e.clientX - rect.left - rect.width / 2) * 2 + rect.width / 2,
              y: -(e.clientY - rect.top - rect.height / 2) * 2 + rect.height / 2,
            });
          }
        }
      } else {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
      resetHideTimer();
    },
    [zoom, resetHideTimer]
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

  // Build image URL
  const imageUrl = currentPhoto ? getMediaUrl("/files/thumbnail", { root: currentPhoto.root_id, path: currentPhoto.path, size: "full" }) : "";

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
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
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
        {isLoading && (
          <div className="flex items-center justify-center">
            <div className="h-12 w-12 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.img
            key={currentIndex}
            ref={imageRef}
            src={imageUrl}
            alt={currentPhoto?.name || "Photo"}
            onLoad={handleImageLoad}
            onError={handleImageError}
            style={{
              transform,
              transformOrigin: "center center",
              maxWidth: zoom > 1 ? "none" : "100%",
              maxHeight: zoom > 1 ? "none" : "100%",
              width: zoom > 1 ? imageNaturalSize.width : "auto",
              height: zoom > 1 ? imageNaturalSize.height : "auto",
              userSelect: "none",
              pointerEvents: zoom > 1 ? "auto" : "none",
            }}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="select-none"
          />
        </AnimatePresence>

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

              {currentPhoto?.lat && currentPhoto?.lng && (
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
                onClick={() => onSelectionToggle(currentPhoto!.id)}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className={cn(
                  "p-2 rounded-full bg-black/50 backdrop-blur transition-colors",
                  isSelected ? "bg-yellow-400/80 text-yellow-50" : "text-white hover:bg-black/70"
                )}
                aria-label={isSelected ? "Remove from selection" : "Add to selection"}
                aria-pressed={isSelected}
              >
                <Star className={cn("h-5 w-5", isSelected && "fill-current")} />
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className="p-2 rounded-full bg-black/50 backdrop-blur text-white hover:bg-black/70 transition-colors"
                aria-label="Download (d)"
              >
                <Download className="h-5 w-5" />
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className="p-2 rounded-full bg-black/50 backdrop-blur text-white hover:bg-black/70 transition-colors"
                aria-label="Share"
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
                className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide max-w-[80vw]"
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
                      src={getMediaUrl("/files/thumbnail", { root: photo.root_id, path: photo.path, size: "small" })}
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
                  onClick={() => setZoom(Math.max(zoom / 1.25, 0.1))}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  disabled={zoom <= 0.1}
                  className="p-2 rounded-full text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Zoom out (-)"
                >
                  <ZoomOut className="h-5 w-5" />
                </motion.button>

                <motion.button
                  onClick={() => {
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                    setRotation(0);
                  }}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  className="p-2 rounded-full text-white hover:bg-white/10 transition-colors"
                  aria-label="Reset zoom (0)"
                >
                  <Expand className="h-5 w-5" />
                </motion.button>

                <motion.button
                  onClick={() => setZoom(Math.min(zoom * 1.25, 10))}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  disabled={zoom >= 10}
                  className="p-2 rounded-full text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Zoom in (+)"
                >
                  <ZoomIn className="h-5 w-5" />
                </motion.button>

                <div className="w-px h-6 bg-white/20 mx-1" />

                <motion.button
                  onClick={() => setRotation((r) => (r - 90) % 360)}
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
                      setCurrentIndex((i) => i - 1);
                      onNavigate(currentIndex - 1);
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
                      setCurrentIndex((i) => i + 1);
                      onNavigate(currentIndex + 1);
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
        {showMetadata && showUI && (
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
              {currentPhoto && (
                <>
                  <div>
                    <p className="text-content-muted">File name</p>
                    <p className="font-mono truncate">{currentPhoto.name}</p>
                  </div>
                  <div>
                    <p className="text-content-muted">Date taken</p>
                    <p>{new Date(currentPhoto.date_taken).toLocaleString()}</p>
                  </div>
                  {currentPhoto.make && (
                    <div>
                      <p className="text-content-muted">Camera</p>
                      <p>{currentPhoto.make} {currentPhoto.model || ""}</p>
                    </div>
                  )}
                  {currentPhoto.lat && currentPhoto.lng && (
                    <div>
                      <p className="text-content-muted">Location</p>
                      <p className="font-mono">
                        {currentPhoto.lat.toFixed(6)}, {currentPhoto.lng.toFixed(6)}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Map View */}
      <AnimatePresence>
        {showMap && showUI && currentPhoto?.lat && currentPhoto?.lng && (
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
            <div className="h-full relative" id="photo-map" style={{ width: "100%", height: "100%" }}>
              {/* Map would be rendered here with MapLibre GL */}
              <div className="flex items-center justify-center h-full text-content-muted">
                Map view (MapLibre GL integration needed)
                <br />
                <span className="font-mono text-xs">
                  {currentPhoto.lat.toFixed(6)}, {currentPhoto.lng.toFixed(6)}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}