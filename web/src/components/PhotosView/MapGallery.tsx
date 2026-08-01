import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocateFixed, MapPin, Minus, Plus, Loader2 } from "lucide-react";
import type { PhotoResult } from "./types";

const TILE = 256;
const MAX_ZOOM = 17;

function lngToX(lng: number, z: number): number {
  return ((lng + 180) / 360) * 2 ** z;
}
function latToY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

interface View {
  lat: number;
  lng: number;
  zoom: number;
}

function fitBounds(photos: PhotoResult[], w: number, h: number): View {
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const p of photos) {
    if (typeof p.lat !== "number" || typeof p.lng !== "number") continue;
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  }
  if (minLat === 90) return { lat: 0, lng: 0, zoom: 2 };
  const center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
  let zoom = 17;
  const spanLng = Math.max(maxLng - minLng, 0.0001);
  const spanLat = Math.max(maxLat - minLat, 0.0001);
  while (zoom > 3) {
    const tileSpanX = (spanLng / 360) * 2 ** zoom;
    const tileSpanY = (spanLat / 360) * 2 ** zoom;
    if (tileSpanX * TILE <= Math.max(w, 400) && tileSpanY * TILE <= Math.max(h, 300)) break;
    zoom--;
  }
  return { ...center, zoom: Math.min(zoom, MAX_ZOOM) };
}

interface Cluster {
  key: string;
  photos: PhotoResult[];
  lat: number;
  lng: number;
}

interface MapGalleryProps {
  photos: PhotoResult[];
  onOpenAt: (index: number) => void;
  indexOf: (id: string) => number;
}

export function MapGallery({ photos, onOpenAt, indexOf }: MapGalleryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const geo = useMemo(() => photos.filter((p) => typeof p.lat === "number" && typeof p.lng === "number"), [photos]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>(() => fitBounds(geo, 800, 500));
  const dragRef = useRef<{ x: number; y: number; view: View } | null>(null);

  // Measure container
  const measure = useCallback(() => {
    const el = containerRef.current;
    if (el) setSize({ w: el.clientWidth, h: el.clientHeight });
  }, []);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const measureRef = useRef(measure);
  measureRef.current = measure;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measureRef.current());
    ro.observe(el);
    measureRef.current();
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const { w, h } = sizeRef.current;
    setView(fitBounds(geo, w || 800, h || 500));
  }, [geo]);
  const tiles = useMemo(() => {
    if (!size.w || !size.h) return { list: [] as { x: number; y: number; z: number }[], origin: { x: 0, y: 0 } };
    const { lat, lng, zoom } = view;
    const cx = lngToX(lng, zoom) * TILE;
    const cy = latToY(lat, zoom) * TILE;
    const minTx = Math.floor((cx - size.w / 2) / TILE);
    const maxTx = Math.floor((cx + size.w / 2) / TILE);
    const minTy = Math.floor((cy - size.h / 2) / TILE);
    const maxTy = Math.floor((cy + size.h / 2) / TILE);
    const list: { x: number; y: number; z: number }[] = [];
    for (let tx = minTx; tx <= maxTx; tx++) {
      for (let ty = minTy; ty <= maxTy; ty++) {
        list.push({ x: tx, y: ty, z: zoom });
      }
    }
    const origin = { x: minTx * TILE, y: minTy * TILE };
    return { list, origin };
  }, [view, size]);

  // Cluster photos by tile at the current zoom.
  const clusters = useMemo<Cluster[]>(() => {
    const byTile = new Map<string, PhotoResult[]>();
    for (const p of geo) {
      const [tx, ty] = [Math.floor(lngToX(p.lng!, view.zoom)), Math.floor(latToY(p.lat!, view.zoom))];
      const key = `${tx}:${ty}`;
      const arr = byTile.get(key) || [];
      arr.push(p);
      byTile.set(key, arr);
    }
    const out: Cluster[] = [];
    for (const [key, list] of byTile) {
      const lat = list.reduce((s, p) => s + p.lat!, 0) / list.length;
      const lng = list.reduce((s, p) => s + p.lng!, 0) / list.length;
      out.push({ key, photos: list, lat, lng });
    }
    return out;
  }, [geo, view.zoom]);

  const project = (lat: number, lng: number) => {
    const { zoom } = view;
    const cx = lngToX(view.lng, zoom) * TILE;
    const cy = latToY(view.lat, zoom) * TILE;
    return {
      x: lngToX(lng, zoom) * TILE - cx + size.w / 2,
      y: latToY(lat, zoom) * TILE - cy + size.h / 2,
    };
  };

  // Drag-to-pan (updates view center; zoom held constant).
  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, view };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) < 3) return;
    const z = d.view.zoom;
    const dLng = (-dx / TILE / 2 ** z) * 360;
    const dLat = (dy / TILE / 2 ** z) * 360;
    setView((v) => ({ ...v, lat: Math.max(-85, Math.min(85, d.view.lat + dLat)), lng: (((d.view.lng + dLng) % 360) + 360) % 360 }));
  };
  const onPointerUp = () => { dragRef.current = null; };

  const zoomBy = (dir: 1 | -1) => setView((v) => ({ ...v, zoom: Math.max(2, Math.min(MAX_ZOOM, v.zoom + dir)) }));

  const onClusterClick = (c: Cluster) => {
    if (c.photos.length === 1) {
      onOpenAt(indexOf(c.photos[0].id));
      return;
    }
    setView((v) => ({ ...v, lat: c.lat, lng: c.lng, zoom: Math.min(MAX_ZOOM, v.zoom + 2) }));
  };

  if (!geo.length) {
    return (
      <div className="grid flex-1 place-items-center py-24 text-center">
        <div>
          <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-surface-2 ring-1 ring-white/[0.05] grid place-items-center">
            <MapPin className="h-6 w-6 text-content-muted" />
          </div>
          <p className="font-medium text-content">No geotagged photos</p>
          <p className="mt-1 text-sm text-content-muted">Photos with GPS coordinates in their EXIF data appear on this map.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col px-3 pb-4 sm:px-5">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm text-content-muted">
          <span className="font-medium text-content">{geo.length.toLocaleString()}</span> geotagged photo{geo.length === 1 ? "" : "s"} · click a cluster to zoom in
        </p>
        <button onClick={fit} className="flex items-center gap-1.5 rounded-lg border border-border/40 px-3 py-1.5 text-xs glass-hover">
          <LocateFixed className="h-3.5 w-3.5" /> Fit all
        </button>
      </div>

      <div
        ref={containerRef}
        className="relative min-h-[55vh] flex-1 touch-none overflow-hidden rounded-2xl bg-[#0c0d12] ring-1 ring-white/[0.06]"
        style={{ cursor: "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {size.w > 0 &&
          tiles.list.map((t) => (
            <img
              key={`${t.z}/${t.x}/${t.y}`}
              src={`https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`}
              alt=""
              referrerPolicy="no-referrer"
              loading="lazy"
              draggable={false}
              className="absolute select-none"
              style={{ left: t.x * TILE - tiles.origin.x, top: t.y * TILE - tiles.origin.y, width: TILE, height: TILE }}
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
          ))}

        {clusters.map((c) => {
          const pos = project(c.lat, c.lng);
          const single = c.photos.length === 1;
          return (
            <button
              key={c.key}
              onClick={() => onClusterClick(c)}
              aria-label={`${c.photos.length} photo${c.photos.length === 1 ? "" : "s"}`}
              className={cnPin(single)}
              style={{
                left: pos.x - (single ? 14 : 24),
                top: pos.y - (single ? 14 : 24),
                width: single ? 28 : 48,
                height: single ? 28 : 48,
              }}
            >
              {single ? (
                <MapPin className="h-6 w-6 text-accent drop-shadow-lg" fill="currentColor" />
              ) : (
                <>
                  <span className="text-xs font-bold">{c.photos.length}</span>
                  <span className="absolute -inset-1 -z-10 rounded-full bg-accent/25 blur-sm" />
                </>
              )}
            </button>
          );
        })}

        {!size.w && (
          <div className="absolute inset-0 grid place-items-center text-content-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {/* zoom controls */}
        <div className="absolute right-3 top-3 flex flex-col gap-1">
          <button onClick={() => zoomBy(1)} aria-label="Zoom in" className="rounded-lg bg-black/60 p-2 text-white glass-hover"><Plus className="h-4 w-4" /></button>
          <button onClick={() => zoomBy(-1)} aria-label="Zoom out" className="rounded-lg bg-black/60 p-2 text-white glass-hover"><Minus className="h-4 w-4" /></button>
        </div>

        <p className="absolute bottom-2 left-3 text-[10px] text-white/50">
          © OpenStreetMap contributors · z{view.zoom}
        </p>
      </div>
    </div>
  );
}

function cnPin(single: boolean): string {
  return single
    ? "absolute z-10 grid place-items-center rounded-full transition-transform hover:scale-110"
    : "absolute z-10 grid place-items-center rounded-full bg-accent text-white shadow-lg shadow-accent/40 ring-2 ring-black/20 transition-transform hover:scale-110";
}
