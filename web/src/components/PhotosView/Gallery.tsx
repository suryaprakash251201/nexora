import { useEffect, useMemo, useRef } from "react";
import { Sparkles, Loader2, ChevronRight } from "lucide-react";
import { photoThumb } from "./media";
import { PhotoTile } from "./PhotoTile";
import { aspectOf, DENSITY_ROW_HEIGHT, ROW_GAP } from "./types";
import type { DayGroup, Density, PhotoResult, PhotoRow, RowItem } from "./types";

const DAY_MS = 86_400_000;

export function dayKeyOf(p: PhotoResult): string {
  return (p.date_taken || "").slice(0, 10);
}

export function dayLabel(key: string): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = new Date(`${key}T00:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  const diff = Math.round((today.getTime() - d.getTime()) / DAY_MS);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { month: "long", day: "numeric" } : { month: "long", day: "numeric", year: "numeric" });
}

function daySublabel(key: string, count: number): string {
  const d = new Date(`${key}T00:00:00`);
  const weekday = Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { weekday: "long" });
  return `${weekday}${weekday ? " · " : ""}${count} photo${count === 1 ? "" : "s"}`;
}

/** Packs photos into full-width rows whose height is derived from the real
 *  aspect ratios — the signature Google-Photos look. */
export function packRows(photos: PhotoResult[], containerWidth: number, targetHeight: number): PhotoRow[] {
  if (containerWidth <= 0) return [];
  const rows: PhotoRow[] = [];
  let cur: RowItem[] = [];
  let curSum = 0;

  const finish = (items: RowItem[]): PhotoRow => {
    const sumRatio = items.reduce((s, it) => s + it.aspect, 0);
    const height = Math.max(96, Math.min(460, (containerWidth - ROW_GAP * (items.length - 1)) / sumRatio));
    return { items, height };
  };

  for (const p of photos) {
    const item: RowItem = { photo: p, aspect: aspectOf(p) };
    const w = item.aspect * targetHeight;
    if (cur.length && curSum + ROW_GAP + w > containerWidth) {
      rows.push(finish(cur));
      cur = [];
      curSum = 0;
    }
    cur.push(item);
    curSum += w + (cur.length > 1 ? ROW_GAP : 0);
  }
  if (cur.length) rows.push(finish(cur));
  return rows;
}

/** Groups a flat (already date-desc) list into per-day row groups. */
export function groupByDay(photos: PhotoResult[], containerWidth: number, density: Density): DayGroup[] {
  const target = DENSITY_ROW_HEIGHT[density];
  const groups: DayGroup[] = [];
  let cur: PhotoResult[] = [];
  let curKey = "";
  for (const p of photos) {
    const k = dayKeyOf(p);
    if (!k) continue; // undated photos are bucketed separately by the caller
    if (k !== curKey) {
      if (cur.length) {
        groups.push({ key: curKey, label: dayLabel(curKey), sublabel: daySublabel(curKey, cur.length), rows: packRows(cur, containerWidth, target) });
      }
      cur = [p];
      curKey = k;
    } else {
      cur.push(p);
    }
  }
  if (cur.length) {
    groups.push({ key: curKey, label: dayLabel(curKey), sublabel: daySublabel(curKey, cur.length), rows: packRows(cur, containerWidth, target) });
  }
  return groups;
}

/* ------------------------------ Memories strip ------------------------------ */

interface Memory {
  key: string; // MM-DD
  photo: PhotoResult;
  yearsAgo: number;
  count: number;
}

/** "On this day" — photos from previous years that fall on today's date. */
export function computeMemories(photos: PhotoResult[]): Memory[] {
  const now = new Date();
  const todayMMDD = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const byMD = new Map<string, PhotoResult[]>();
  for (const p of photos) {
    const d = new Date(p.date_taken);
    if (Number.isNaN(d.getTime())) continue;
    if (d.getFullYear() >= now.getFullYear()) continue;
    const md = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const list = byMD.get(md) || [];
    list.push(p);
    byMD.set(md, list);
  }
  const out: Memory[] = [];
  for (const [md, list] of byMD) {
    if (md === todayMMDD) {
      out.push({ key: md, photo: list[0], yearsAgo: now.getFullYear() - new Date(list[0].date_taken).getFullYear(), count: list.length });
    }
  }
  // Prefer most recent
  return out.sort((a, b) => b.yearsAgo - a.yearsAgo);
}

function MemoriesStrip({ memories, onOpenAt }: { memories: Memory[]; onOpenAt: (photo: PhotoResult) => void }) {
  if (!memories.length) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-content">
        <Sparkles className="h-4 w-4 text-amber-400" />
        On this day
        <span className="font-normal text-content-muted">· memories from {memories.length} past year{memories.length === 1 ? "" : "s"}</span>
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-2 hide-scrollbar -mx-1 px-1">
        {memories.map((m) => (
          <button
            key={m.key}
            onClick={() => onOpenAt(m.photo)}
            className="group relative h-40 w-56 shrink-0 overflow-hidden rounded-xl bg-surface-2 ring-1 ring-white/[0.05] text-left"
          >
            <img
              src={photoThumb(m.photo.root_id, m.photo.path, 480)}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2.5 pt-8">
              <p className="text-sm font-semibold text-white">{m.yearsAgo} year{m.yearsAgo === 1 ? "" : "s"} ago</p>
              <p className="text-xs text-white/70">
                {new Date(m.photo.date_taken).toLocaleDateString(undefined, { month: "long", day: "numeric" })} · {m.count} photo{m.count === 1 ? "" : "s"}
              </p>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------- Gallery -------------------------------- */

interface GalleryProps {
  photos: PhotoResult[];
  density: Density;
  containerWidth: number;
  stickyTop: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  onLoadMore: () => void;
  onRetry: () => void;
  selecting: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (photo: PhotoResult) => void;
  onOpenAt: (index: number) => void;
  onToggleFavorite: (photo: PhotoResult) => void;
  onContextMenu: (e: React.MouseEvent, photo: PhotoResult) => void;
  emptyTitle?: string;
  emptySubtitle?: string;
}

export function Gallery({
  photos, density, containerWidth, stickyTop,
  loading, loadingMore, hasMore, error, onLoadMore, onRetry,
  selecting, selectedIds, onToggleSelect, onOpenAt, onToggleFavorite, onContextMenu,
  emptyTitle = "No photos here yet",
  emptySubtitle = "Photos you index will appear here, grouped by day.",
}: GalleryProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  const memories = useMemo(() => computeMemories(photos), [photos]);
  const dated = useMemo(() => photos.filter((p) => dayKeyOf(p)), [photos]);
  const undated = useMemo(() => photos.filter((p) => !dayKeyOf(p)), [photos]);
  const groups = useMemo(
    () => groupByDay(dated, containerWidth, density),
    [dated, containerWidth, density]
  );

  // Index map so we can open any photo by its position in the flat list.
  const indexOf = useMemo(() => {
    const m = new Map<string, number>();
    photos.forEach((p, i) => m.set(p.id, i));
    return m;
  }, [photos]);

  useEffect(() => {
    if (!hasMore || !sentinelRef.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          onLoadMore();
        }
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(sentinelRef.current);
    return () => io.disconnect();
  }, [hasMore, onLoadMore]);

  const undatedRows = useMemo(() => packRows(undated, containerWidth, DENSITY_ROW_HEIGHT[density]), [undated, containerWidth, density]);

  const renderRow = (row: PhotoRow, rowKey: string) => (
    <div key={rowKey} className="mb-1.5 flex" style={{ height: row.height }}>
      {row.items.map((it, j) => (
        <PhotoTile
          key={it.photo.id}
          photo={it.photo}
          aspect={it.aspect}
          selecting={selecting}
          selected={selectedIds.has(it.photo.id)}
          onOpen={() => onOpenAt(indexOf.get(it.photo.id) ?? 0)}
          onToggleSelect={() => onToggleSelect(it.photo)}
          onToggleFavorite={() => onToggleFavorite(it.photo)}
          onContextMenu={(e) => onContextMenu(e, it.photo)}
        />
      ))}
    </div>
  );

  if (loading) {
    return (
      <div className="grid flex-1 place-items-center py-24 text-content-muted">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
          <p className="text-sm">Loading photos…</p>
        </div>
      </div>
    );
  }

  if (error && !photos.length) {
    return (
      <div className="grid flex-1 place-items-center py-24">
        <div className="text-center">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={onRetry} className="mt-3 rounded-lg border border-border/40 px-4 py-1.5 text-sm glass-hover">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!photos.length) {
    return (
      <div className="grid flex-1 place-items-center py-24 text-center">
        <div>
          <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-surface-2 ring-1 ring-white/[0.05] grid place-items-center">
            <span className="text-2xl">📷</span>
          </div>
          <p className="font-medium text-content">{emptyTitle}</p>
          <p className="mt-1 text-sm text-content-muted">{emptySubtitle}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 sm:px-5">
      {memories.length > 0 && <MemoriesStrip memories={memories} onOpenAt={(p) => onOpenAt(indexOf.get(p.id) ?? 0)} />}

      {groups.map((g) => (
        <section key={g.key} className="mb-1">
          <header
            className="sticky z-10 flex items-baseline gap-2 pb-1.5 pt-2"
            style={{ top: stickyTop }}
          >
            <h2 className="text-base font-semibold text-content drop-shadow">{g.label}</h2>
            <span className="text-xs text-content-muted">{g.sublabel}</span>
          </header>
          {g.rows.map((row, ri) => renderRow(row, `${g.key}:${ri}`))}
        </section>
      ))}

      {undated.length > 0 && (
        <section className="mb-1">
          <header className="sticky z-10 flex items-baseline gap-2 pb-1.5 pt-2" style={{ top: stickyTop }}>
            <h2 className="text-base font-semibold text-content drop-shadow">Unknown date</h2>
            <span className="text-xs text-content-muted">{undated.length} photo{undated.length === 1 ? "" : "s"}</span>
          </header>
          {undatedRows.map((row, ri) => renderRow(row, `undated:${ri}`))}
        </section>
      )}

      {/* load-more sentinel */}
      <div ref={sentinelRef} className="flex items-center justify-center py-8 text-sm text-content-muted">
        {loadingMore ? (
          <span className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading more…
          </span>
        ) : hasMore ? (
          <span className="flex items-center gap-1 opacity-60">
            Keep scrolling <ChevronRight className="h-3.5 w-3.5 -rotate-90" />
          </span>
        ) : (
          <span className="opacity-50">
            {photos.length.toLocaleString()} photo{photos.length === 1 ? "" : "s"} · you've reached the end
          </span>
        )}
      </div>
    </div>
  );
}
