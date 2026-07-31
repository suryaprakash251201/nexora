import { motion } from "motion/react";
import { X, Download, Share2, Trash2, Plus, FolderPlus, MoreHorizontal, Heart, MapPin, Star, Archive } from "lucide-react";
import { cn } from "@/lib/utils";

interface SelectionToolbarProps {
  count: number;
  onDownload: () => void;
  onShare: () => void;
  onDelete: () => void;
  onAddToAlbum: () => void;
  onClear: () => void;
}

export function SelectionToolbar({
  count,
  onDownload,
  onShare,
  onDelete,
  onAddToAlbum,
  onClear,
}: SelectionToolbarProps) {
  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 glass-strong border border-glass-border rounded-2xl shadow-2xl"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 text-sm font-medium text-content">
        <span>{count} selected</span>
        <div className="w-px h-5 bg-white/20" />
      </div>

      <div className="flex items-center gap-1">
        <motion.button
          onClick={onDownload}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className={cn("p-2 rounded-lg bg-surface/50 hover:bg-surface transition-colors text-content-muted hover:text-content")}
          aria-label="Download selected"
        >
          <Download className="h-5 w-5" />
        </motion.button>

        <motion.button
          onClick={onShare}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className={cn("p-2 rounded-lg bg-surface/50 hover:bg-surface transition-colors text-content-muted hover:text-content")}
          aria-label="Share selected"
        >
          <Share2 className="h-5 w-5" />
        </motion.button>

        <motion.button
          onClick={onAddToAlbum}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className={cn("p-2 rounded-lg bg-surface/50 hover:bg-surface transition-colors text-content-muted hover:text-content")}
          aria-label="Add to album"
        >
          <FolderPlus className="h-5 w-5" />
        </motion.button>

        <motion.button
          onClick={onDelete}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className={cn("p-2 rounded-lg bg-surface/50 hover:bg-destructive/20 transition-colors text-destructive/70 hover:text-destructive")}
          aria-label="Delete selected"
        >
          <Trash2 className="h-5 w-5" />
        </motion.button>

        <motion.button
          onClick={onClear}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className={cn("p-2 rounded-lg bg-surface/50 hover:bg-surface transition-colors text-content-muted hover:text-content ml-2")}
          aria-label="Clear selection"
        >
          <X className="h-5 w-5" />
        </motion.button>
      </div>
    </motion.div>
  );
}