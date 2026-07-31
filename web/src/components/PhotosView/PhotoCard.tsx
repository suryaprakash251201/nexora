import { useCallback } from "react";
import { FileItem } from "@/api/types";
import { FileThumb } from "../FileThumb";
import { Check, MapPin, Star, Video, Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { PhotoResult } from "@/api/types";

type Density = "compact" | "comfortable" | "spacious";

function formatDateShort(dateStr: string): string {
  try {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

const DENSITY_STYLES: Record<Density, { cardSize: string; badgeSize: string }> = {
  compact: { cardSize: "h-36 w-36 sm:h-40 sm:w-40", badgeSize: "text-[10px] px-1.5 py-0.5" },
  comfortable: { cardSize: "h-44 w-44 sm:h-48 sm:w-48", badgeSize: "text-[11px] px-2 py-0.5" },
  spacious: { cardSize: "h-56 w-56 sm:h-64 sm:w-64", badgeSize: "text-[12px] px-2.5 py-0.5" },
};

interface PhotoCardProps {
  photo: PhotoResult;
  index: number;
  density: Density;
  isSelected: boolean;
  isSelecting: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onSelectionToggle: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  style?: React.CSSProperties;
}

export function PhotoCard({
  photo, index, density, isSelected, isSelecting, onClick, onContextMenu, onSelectionToggle, onKeyDown, style,
}: PhotoCardProps) {
  const dateStr = formatDateShort(photo.date_taken);
  const cameraStr = photo.model ? (photo.make ? `${photo.make} ${photo.model}` : photo.model) : photo.make || "";
  const styles = DENSITY_STYLES[density];

  const fileItem: FileItem = {
    root_id: photo.root_id || "",
    path: photo.path || "",
    name: photo.name || "",
    is_dir: false,
    extension: (photo.name || "").split(".").pop()?.toLowerCase() || "",
    mime: photo.is_video ? "video/mp4" : "image/jpeg",
    size: 0,
    modified: photo.date_taken || "",
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (e.shiftKey || e.metaKey || e.ctrlKey) onSelectionToggle();
        else onClick();
      }
      onKeyDown?.(e);
    },
    [onClick, onKeyDown, onSelectionToggle],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.shiftKey || e.metaKey || e.ctrlKey) { e.preventDefault(); onSelectionToggle(); }
      else onClick();
    },
    [onClick, onSelectionToggle],
  );

  return (
    <div
      className={cn(
        "relative group cursor-pointer select-none",
        "rounded-xl overflow-hidden",
        "transition-all duration-200 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        isSelected && "ring-2 ring-accent ring-offset-2 ring-offset-background",
        isSelecting && "opacity-80",
        styles.cardSize,
      )}
      onClick={handleClick}
      onContextMenu={onContextMenu}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="listitem"
      aria-selected={isSelected}
      aria-label={`${photo.name}${dateStr ? `, taken ${dateStr}` : ""}${cameraStr ? `, ${cameraStr}` : ""}${photo.lat && photo.lng ? ", has location" : ""}${isSelected ? ", selected" : ""}`}
      style={style}
    >
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 transition-transform duration-300 group-hover:scale-[1.03]">
          <FileThumb it={fileItem} fill />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
        {photo.is_video && (
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-black/60 backdrop-blur text-white text-[10px] font-medium">
              <Video className="h-3 w-3" />
              Video
            </span>
          </div>
        )}
        {photo.is_favorite && (
          <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <Star className="h-5 w-5 fill-yellow-400 text-yellow-400 filter drop-shadow" />
          </div>
        )}
        {photo.lat && photo.lng && (
          <div className="absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-black/60 backdrop-blur text-white text-[10px]">
              <MapPin className="h-3 w-3" />
              Location
            </span>
          </div>
        )}
        {dateStr && (
          <div className="absolute bottom-2 left-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <span className={cn("block truncate rounded bg-black/60 backdrop-blur text-white", styles.badgeSize)}>{dateStr}</span>
          </div>
        )}
        {cameraStr && (
          <div className="absolute bottom-2 left-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <span className={cn("block truncate rounded bg-black/60 backdrop-blur text-white", styles.badgeSize)}>
              <Camera className="inline h-2.5 w-2.5 mr-1" />
              {cameraStr}
            </span>
          </div>
        )}
      </div>
      {isSelecting && (
        <div className="absolute top-2 right-2 z-10">
          <button
            onClick={(e) => { e.stopPropagation(); onSelectionToggle(); }}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all duration-150",
              isSelected
                ? "bg-accent border-accent text-accent-foreground"
                : "bg-black/40 border-white/30 text-transparent hover:bg-white/10",
              styles.cardSize.includes("h-36") && "h-5 w-5",
            )}
            aria-label={isSelected ? "Deselect" : "Select"}
            aria-pressed={isSelected}
          >
            {isSelected && <Check className={cn("h-3.5 w-3.5", styles.cardSize.includes("h-36") && "h-3 w-3")} />}
          </button>
        </div>
      )}
      {isSelected && !isSelecting && (
        <div className="absolute top-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-lg">
          <Check className="h-3.5 w-3.5" />
        </div>
      )}
    </div>
  );
}
