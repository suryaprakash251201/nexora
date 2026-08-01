import { motion } from "motion/react";
import { X, Download, Share2, Trash2, FolderPlus, ListChecks } from "lucide-react";

interface SelectionToolbarProps {
  count: number;
  totalOnScreen?: number;
  onDownload: () => void;
  onShare: () => void;
  onDelete: () => void;
  onAddToAlbum: () => void;
  onSelectAll: () => void;
  onClear: () => void;
}

export function SelectionToolbar({
  count,
  totalOnScreen = 0,
  onDownload,
  onShare,
  onDelete,
  onAddToAlbum,
  onSelectAll,
  onClear,
}: SelectionToolbarProps) {
  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 glass-strong border border-glass-border rounded-2xl shadow-2xl"
      role="toolbar"
      aria-label="Selection actions"
    >
      <div className="flex items-center gap-3 text-sm font-medium text-content px-1">
        <span>
          {count} selected{totalOnScreen > 0 && ` of ${totalOnScreen} on screen`}
        </span>
        <div className="w-px h-5 bg-white/20" />
      </div>

      <div className="flex items-center gap-1">
        {totalOnScreen > count && (
          <ToolbarButton onClick={onSelectAll} label={`Select all ${totalOnScreen} on screen`}>
            <ListChecks className="h-5 w-5" />
          </ToolbarButton>
        )}
        <ToolbarButton onClick={onDownload} label="Download selected">
          <Download className="h-5 w-5" />
        </ToolbarButton>
        <ToolbarButton onClick={onShare} label="Create share links">
          <Share2 className="h-5 w-5" />
        </ToolbarButton>
        <ToolbarButton onClick={onAddToAlbum} label="Add to album">
          <FolderPlus className="h-5 w-5" />
        </ToolbarButton>
        <ToolbarButton onClick={onDelete} label="Delete selected" danger>
          <Trash2 className="h-5 w-5" />
        </ToolbarButton>
        <div className="w-px h-5 bg-white/20 mx-1" />
        <ToolbarButton onClick={onClear} label="Clear selection">
          <X className="h-5 w-5" />
        </ToolbarButton>
      </div>
    </motion.div>
  );
}

function ToolbarButton({
  onClick,
  label,
  danger,
  children,
}: {
  onClick: () => void;
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      title={label}
      aria-label={label}
      className={
        danger
          ? "p-2 rounded-lg bg-surface/50 hover:bg-destructive/20 transition-colors text-destructive/70 hover:text-destructive"
          : "p-2 rounded-lg bg-surface/50 hover:bg-surface transition-colors text-content-muted hover:text-content"
      }
    >
      {children}
    </motion.button>
  );
}
