import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Download, Share2, Trash2, FolderPlus, Heart, MapPin, Star, Info, MoreHorizontal, X, Copy, Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import { PhotoResult } from "@/api/types";

interface PhotoContextMenuProps {
  contextMenu: { photo: PhotoResult; x: number; y: number } | null;
  onClose: () => void;
  onOpen: (rootId: string, path: string) => void;
  onPreview?: (rootId: string, path: string) => void;
  onToggleFavorite: (id: string) => void;
  onDownload: (photo: PhotoResult) => void;
  onDelete: (photo: PhotoResult) => void;
  onShare: (photo: PhotoResult) => void;
  onCopyPath: (photo: PhotoResult) => void;
  onAddToAlbum: (photo: PhotoResult) => void;
  onViewMetadata: (photo: PhotoResult) => void;
  onViewOnMap: (photo: PhotoResult) => void;
  onArchive: (photo: PhotoResult) => void;
}

export function PhotoContextMenu({
  contextMenu,
  onClose,
  onOpen,
  onPreview,
  onToggleFavorite,
  onDownload,
  onDelete,
  onShare,
  onCopyPath,
  onAddToAlbum,
  onViewMetadata,
  onViewOnMap,
  onArchive,
}: PhotoContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const photo = contextMenu?.photo;

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    if (contextMenu) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [contextMenu, onClose]);

  // Focus trap
  useEffect(() => {
    if (menuRef.current) {
      menuRef.current.focus();
    }
  }, [contextMenu]);

  if (!contextMenu || !photo) return null;

  const handleAction = (action: () => void) => {
    action();
    onClose();
  };

  // Calculate position to keep menu in viewport
  const menuWidth = 240;
  const menuHeight = 380;
  const x = Math.min(contextMenu.x, window.innerWidth - menuWidth - 16);
  const y = Math.min(contextMenu.y, window.innerHeight - menuHeight - 16);

  return (
    <motion.div
      ref={menuRef}
      initial={{ opacity: 0, scale: 0.95, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 8 }}
      transition={{ duration: 0.1, ease: "easeOut" }}
      className={cn(
        "fixed z-[70] glass-strong border border-glass-border rounded-xl shadow-2xl p-1 min-w-[240px]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      )}
      style={{
        left: x,
        top: y,
      }}
      role="menu"
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Photo preview */}
      <div className="relative aspect-[4/3] rounded-lg overflow-hidden mb-2 border border-glass-border/50">
        <img
          src={`/api/files/thumbnail?root=${photo.root_id}&path=${encodeURIComponent(photo.path)}&size=medium`}
          alt={photo.name}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
        <div className="absolute bottom-2 left-2 right-2 text-white text-xs truncate">{photo.name}</div>
      </div>

      <nav className="space-y-0.5" aria-label="Photo actions">
        {/* Primary actions */}
        <motion.button
          onClick={() => handleAction(() => onPreview?.(photo.root_id, photo.path) || onOpen(photo.root_id, photo.path))}
          whileHover={{ backgroundColor: "var(--color-glass-bg-strong)" }}
          whileTap={{ scale: 0.98 }}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium",
            "text-content hover:text-accent transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
          )}
          role="menuitem"
        >
          <span className="w-5 h-5 flex items-center justify-center">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </span>
          <span>Open</span>
          <span className="ml-auto text-xs text-content-muted">Enter</span>
        </motion.button>

        <motion.button
          onClick={() => handleAction(() => onToggleFavorite(photo.id))}
          whileHover={{ backgroundColor: "var(--color-glass-bg-strong)" }}
          whileTap={{ scale: 0.98 }}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium",
            "text-content hover:text-accent transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
          )}
          role="menuitem"
          aria-pressed={photo.is_favorite}
        >
          <span className="w-5 h-5 flex items-center justify-center">
            <Star className={cn("h-4 w-4", photo.is_favorite && "fill-current text-yellow-400")} />
          </span>
          <span>{photo.is_favorite ? "Remove from favorites" : "Add to favorites"}</span>
          <span className="ml-auto text-xs text-content-muted">S</span>
        </motion.button>

        <div className="border-t border-glass-border/50 my-1" />

        {/* Organization */}
        <motion.button
          onClick={() => handleAction(() => onAddToAlbum(photo))}
          whileHover={{ backgroundColor: "var(--color-glass-bg-strong)" }}
          whileTap={{ scale: 0.98 }}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium",
            "text-content hover:text-accent transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
          )}
          role="menuitem"
        >
          <span className="w-5 h-5 flex items-center justify-center">
            <FolderPlus className="h-4 w-4" />
          </span>
          <span>Add to album</span>
        </motion.button>

        <motion.button
          onClick={() => handleAction(() => onArchive(photo))}
          whileHover={{ backgroundColor: "var(--color-glass-bg-strong)" }}
          whileTap={{ scale: 0.98 }}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium",
            "text-content hover:text-accent transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
          )}
          role="menuitem"
        >
          <span className="w-5 h-5 flex items-center justify-center">
            <Archive className="h-4 w-4" />
          </span>
          <span>Archive</span>
        </motion.button>

        <div className="border-t border-glass-border/50 my-1" />

        {/* Sharing & Export */}
        <motion.button
          onClick={() => handleAction(() => onShare(photo))}
          whileHover={{ backgroundColor: "var(--color-glass-bg-strong)" }}
          whileTap={{ scale: 0.98 }}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium",
            "text-content hover:text-accent transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
          )}
          role="menuitem"
        >
          <span className="w-5 h-5 flex items-center justify-center">
            <Share2 className="h-4 w-4" />
          </span>
          <span>Share</span>
        </motion.button>

        <motion.button
          onClick={() => handleAction(() => onDownload(photo))}
          whileHover={{ backgroundColor: "var(--color-glass-bg-strong)" }}
          whileTap={{ scale: 0.98 }}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium",
            "text-content hover:text-accent transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
          )}
          role="menuitem"
        >
          <span className="w-5 h-5 flex items-center justify-center">
            <Download className="h-4 w-4" />
          </span>
          <span>Download</span>
          <span className="ml-auto text-xs text-content-muted">D</span>
        </motion.button>

        <motion.button
          onClick={() => handleAction(() => onCopyPath(photo))}
          whileHover={{ backgroundColor: "var(--color-glass-bg-strong)" }}
          whileTap={{ scale: 0.98 }}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium",
            "text-content hover:text-accent transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
          )}
          role="menuitem"
        >
          <span className="w-5 h-5 flex items-center justify-center">
            <Copy className="h-4 w-4" />
          </span>
          <span>Copy path</span>
        </motion.button>

        <div className="border-t border-glass-border/50 my-1" />

        {/* Info & Location */}
        <motion.button
          onClick={() => handleAction(() => onViewMetadata(photo))}
          whileHover={{ backgroundColor: "var(--color-glass-bg-strong)" }}
          whileTap={{ scale: 0.98 }}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium",
            "text-content hover:text-accent transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
          )}
          role="menuitem"
        >
          <span className="w-5 h-5 flex items-center justify-center">
            <Info className="h-4 w-4" />
          </span>
          <span>Show details (EXIF)</span>
          <span className="ml-auto text-xs text-content-muted">I</span>
        </motion.button>

        {photo.lat && photo.lng && (
          <motion.button
            onClick={() => handleAction(() => onViewOnMap(photo))}
            whileHover={{ backgroundColor: "var(--color-glass-bg-strong)" }}
            whileTap={{ scale: 0.98 }}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium",
              "text-content hover:text-accent transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
            )}
            role="menuitem"
          >
            <span className="w-5 h-5 flex items-center justify-center">
              <MapPin className="h-4 w-4" />
            </span>
            <span>View on map</span>
            <span className="ml-auto text-xs text-content-muted">M</span>
          </motion.button>
        )}

        <div className="border-t border-glass-border/50 my-1" />

        {/* Danger zone */}
        <motion.button
          onClick={() => handleAction(() => onDelete(photo))}
          whileHover={{ backgroundColor: "rgba(239, 68, 68, 0.1)" }}
          whileTap={{ scale: 0.98 }}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium",
            "text-destructive hover:bg-destructive/10 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-inset"
          )}
          role="menuitem"
        >
          <span className="w-5 h-5 flex items-center justify-center">
            <Trash2 className="h-4 w-4" />
          </span>
          <span>Delete</span>
          <span className="ml-auto text-xs text-content-muted">Del</span>
        </motion.button>
      </nav>
    </motion.div>
  );
}