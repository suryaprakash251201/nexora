/**
 * Extracted from Workspace.tsx — Favourites / Recents / Trash library views.
 */
import { Heart, Clock, Trash2, RotateCcw } from "lucide-react";
import { ViewHeader } from "../ui/ViewHeader";
import { SkeletonList } from "../ui/Skeleton";
import { EmptyState } from "../ui/EmptyState";
import type { TrashItem } from "../../api/types";
import { GridView, type GridItem } from "./GridView";

export function FavouritesView({ loading, items, onOpen }: {
  loading: boolean;
  items: GridItem[];
  onOpen: (item: GridItem) => void;
}) {
  return (
    <>
      <ViewHeader
        icon={Heart}
        title="Favourites"
        subtitle={loading ? "Loading…" : `${items.length} item${items.length === 1 ? "" : "s"} you starred`}
      />
      <GridView
        loading={loading}
        empty="No favorites yet"
        emptyVariant="favorites"
        items={items}
        onOpen={onOpen}
      />
    </>
  );
}

export function RecentsView({ loading, items, onOpen }: {
  loading: boolean;
  items: GridItem[];
  onOpen: (item: GridItem) => void;
}) {
  return (
    <>
      <ViewHeader
        icon={Clock}
        title="Recent Files"
        subtitle={loading ? "Loading…" : `${items.length} item${items.length === 1 ? "" : "s"} opened lately`}
      />
      <GridView
        loading={loading}
        empty="No recent files yet"
        emptyVariant="recents"
        items={items}
        onOpen={onOpen}
      />
    </>
  );
}

export function TrashView({ items, loading, onRestore, onDelete, selection, selectMode, onSelect }: {
  items: TrashItem[]; loading: boolean; onRestore: (id: string) => void; onDelete: (id: string) => void;
  selection?: Set<string>; selectMode?: boolean; onSelect?: (id: string) => void;
}) {
  if (loading) return <div className="p-2"><SkeletonList count={5} /></div>;
  if (!items.length) return (
    <div className="p-10">
      <EmptyState variant="trash" title="Trash is empty" description="Deleted files land here first, so you can always restore them." />
    </div>
  );
  const selectedCount = selection?.size ?? 0;
  return (
    <div>
      <ViewHeader
        icon={Trash2}
        title="Trash"
        subtitle={`${items.length} item${items.length === 1 ? "" : "s"} · restore or delete forever`}
      />
      {selectedCount > 0 && (
        <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-2 glass-bar border-b border-border/50">
          <span className="text-sm font-medium">{selectedCount} selected</span>
          <div className="flex gap-2 ml-auto">
            <button onClick={() => { items.filter((t) => selection?.has(t.id)).forEach((t) => onRestore(t.id)); }} className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg glass-hover border"><RotateCcw className="h-4 w-4" /> Restore</button>
            <button onClick={() => { items.filter((t) => selection?.has(t.id)).forEach((t) => onDelete(t.id)); }} className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg text-danger hover:bg-danger/10"><Trash2 className="h-4 w-4" /> Delete</button>
          </div>
        </div>
      )}
      <div className="p-2">
        {items.map((t) => {
          const selected = selection?.has(t.id) ?? false;
          return (
            <div key={t.id} className={`flex items-center gap-2 rounded-lg transition-colors ${selected ? "bg-accent/10 ring-1 ring-accent/30" : "hover:bg-surface/50"}`}>
              {onSelect && (
                <label className="pl-3 py-2 flex items-center cursor-pointer">
                  <input type="checkbox" checked={selected} onChange={() => onSelect(t.id)}
                    className="w-4 h-4 rounded border-2 border-border/80 bg-surface/80 text-accent focus:ring-accent cursor-pointer transition-all" />
                </label>
              )}
              <div className="flex-1 grid grid-cols-[1fr_auto_auto] gap-2 py-2 pr-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{t.name}</p>
                  <p className="text-xs text-content-muted truncate">{t.root_name} · {t.original_path}</p>
                </div>
                <button onClick={() => onRestore(t.id)} className="flex items-center gap-1 px-2 py-1 text-sm rounded-lg glass-hover border"><RotateCcw className="h-4 w-4" /> Restore</button>
                <button onClick={() => onDelete(t.id)} className="flex items-center gap-1 px-2 py-1 text-sm rounded-lg text-danger hover:bg-danger/10"><Trash2 className="h-4 w-4" /> Delete</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
