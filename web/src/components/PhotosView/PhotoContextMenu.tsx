import { useRef, useEffect } from "react";
import React from "react";
import { motion } from "motion/react";
import { Download, Share2, Star, Trash2, FolderPlus, Info, MapPin, Copy, Archive, Camera } from "lucide-react";
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
  contextMenu, onClose, onOpen, onPreview, onToggleFavorite,
  onDownload, onDelete, onShare, onCopyPath, onAddToAlbum, onViewMetadata, onViewOnMap, onArchive,
}: PhotoContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const photo = contextMenu?.photo;

  useEffect(() => {
    if (!contextMenu) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (contextMenu) document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [contextMenu, onClose]);

  useEffect(() => {
    if (menuRef.current) menuRef.current.focus();
  }, [contextMenu]);

  if (!contextMenu || !photo) return null;

  const handleAction = (action: () => void) => { action(); onClose(); };
  const menuWidth = 240;
  const menuHeight = 380;
  const x = Math.min(contextMenu.x, window.innerWidth - menuWidth - 16);
  const y = Math.min(contextMenu.y, window.innerHeight - menuHeight - 16);

  return (
    <motion.div
      ref={menuRef}
      initial={{ opacity: 0, scale: 0.95, y: 8 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, y: 8 }}
      transition={{ duration: 0.1, ease: "easeOut" }}
      className="fixed z-[70] glass-strong border border-glass-border rounded-xl p-1 min-w-[240px] pointer-events-auto"
      style={{ left: x, top: y }}
      role="menu"
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
        <MenuButton onClick={() => handleAction(() => onPreview?.(photo.root_id, photo.path) || onOpen(photo.root_id, photo.path))}>
          <Camera className="h-4 w-4" /> Open
          <span className="ml-auto text-xs text-content-muted">Enter</span>
        </MenuButton>
        <MenuButton onClick={() => handleAction(() => onToggleFavorite(photo.id))}>
          <Star className={cn("h-4 w-4", photo.is_favorite && "fill-current text-yellow-400")} />
          <span>{photo.is_favorite ? "Remove from favorites" : "Add to favorites"}</span>
          <span className="ml-auto text-xs text-content-muted">F</span>
        </MenuButton>
        <hr className="border-t border-glass-border/50 my-1" />
        <MenuButton onClick={() => handleAction(() => onAddToAlbum(photo))}>
          <FolderPlus className="h-4 w-4" /> Add to album
        </MenuButton>
        <MenuButton onClick={() => handleAction(() => onArchive(photo))}>
          <Archive className="h-4 w-4" /> Archive
        </MenuButton>
        <hr className="border-t border-glass-border/50 my-1" />
        <MenuButton onClick={() => handleAction(() => onShare(photo))}>
          <Share2 className="h-4 w-4" /> Share
        </MenuButton>
        <MenuButton onClick={() => handleAction(() => onDownload(photo))}>
          <Download className="h-4 w-4" /> Download
          <span className="ml-auto text-xs text-content-muted">D</span>
        </MenuButton>
        <MenuButton onClick={() => handleAction(() => onCopyPath(photo))}>
          <Copy className="h-4 w-4" /> Copy path
        </MenuButton>
        <hr className="border-t border-glass-border/50 my-1" />
        <MenuButton onClick={() => handleAction(() => onViewMetadata(photo))}>
          <Info className="h-4 w-4" /> Show details (EXIF)
          <span className="ml-auto text-xs text-content-muted">I</span>
        </MenuButton>
        {photo.lat && photo.lng && (
          <MenuButton onClick={() => handleAction(() => onViewOnMap(photo))}>
            <MapPin className="h-4 w-4" /> View on map
            <span className="ml-auto text-xs text-content-muted">M</span>
          </MenuButton>
        )}
        <hr className="border-t border-glass-border/50 my-1" />
        <MenuButton destructive onClick={() => handleAction(() => onDelete(photo))}>
          <Trash2 className="h-4 w-4" /> Delete
          <span className="ml-auto text-xs text-content-muted">Del</span>
        </MenuButton>
      </nav>
    </motion.div>
  );
}

function MenuButton({ onClick, children, destructive, className }: { onClick: () => void; children: React.ReactNode; destructive?: boolean; className?: string }) {
  // Split children into icon (first element) and label (rest)
  const items = React.Children.toArray(children);
  const icon = items[0];
  const rest = items.slice(1);
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors",
        destructive
          ? "text-destructive/80 hover:bg-destructive/10 hover:bg-destructive/20"
          : "text-content hover:bg-accent/10 hover:text-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset",
        className,
      )}
      role="menuitem"
    >
      <span className="flex h-5 w-5 items-center justify-center shrink-0">{icon}</span>
      <span className="flex-1 text-left">{rest}</span>
    </button>
  );
}