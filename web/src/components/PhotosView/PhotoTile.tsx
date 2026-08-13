import { memo } from "react";
import { Check, Plus, Star } from "lucide-react";
import { photoThumb } from "./media";
import { cn } from "@/lib/utils";
import type { PhotoResult } from "./types";

interface PhotoTileProps {
  photo: PhotoResult;
  aspect: number;
  selecting: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggleSelect: () => void;
  onToggleFavorite: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function PhotoTileInner({ photo, aspect, selecting, selected, onOpen, onToggleSelect, onToggleFavorite, onContextMenu }: PhotoTileProps) {
  return (
    <div
      className={cn(
        "relative group overflow-hidden rounded-lg bg-surface-2 ring-1 ring-white/[0.05]",
        "cursor-pointer select-none transition-shadow",
        selected && "ring-2 ring-accent"
      )}
      style={{ flexGrow: aspect, flexBasis: 0, minWidth: 0 }}
      onClick={() => (selecting ? onToggleSelect() : onOpen())}
      onContextMenu={onContextMenu}
      role="button"
      aria-label={photo.name}
      title={photo.name}
    >
      <img
        src={photoThumb(photo.root_id, photo.path, 480)}
        alt={photo.name}
        loading="lazy"
        draggable={false}
        className={cn(
          "h-full w-full object-cover transition-transform duration-300",
          "group-hover:scale-[1.04]",
          selected && "opacity-90"
        )}
      />

      {/* bottom gradient + hover veil */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />

      {/* favorite star (hover on desktop, always dim on touch) */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        aria-label={photo.is_favorite ? "Remove from favorites" : "Add to favorites"}
        className={cn(
          "absolute right-1.5 top-1.5 z-10 rounded-full p-1.5 backdrop-blur-sm transition-all duration-150",
          photo.is_favorite
            ? "bg-black/30 text-amber-400 opacity-100"
            : "bg-black/30 text-white/80 focus-visible:opacity-100",
          (selecting || photo.is_favorite) ? "opacity-100" : "opacity-0 group-hover:opacity-100 hover:scale-110"
        )}
      >
        {photo.is_favorite ? <Star className="h-3.5 w-3.5 fill-current" /> : <Star className="h-3.5 w-3.5" />}
      </button>

      {/* selection checkbox */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect();
        }}
        aria-label={selected ? "Deselect" : "Select"}
        className={cn(
          "absolute left-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded-full backdrop-blur-sm transition-all duration-150",
          selected
            ? "bg-accent text-white"
            : "bg-black/30 text-white/80 focus-visible:opacity-100",
          selecting || selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        )}
      >
        {selected ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <Plus className="h-3.5 w-3.5" />}
      </button>

      {/* dim veil when selecting but this tile isn't selected */}
      {selecting && !selected && <div className="pointer-events-none absolute inset-0 bg-black/35" />}
    </div>
  );
}

export const PhotoTile = memo(PhotoTileInner);
