import { Download, Share2, Star, Trash2, Move, Copy, Archive, X } from "lucide-react";

interface SelectionBarProps {
  count: number;
  onDownload: () => void;
  onMove: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onShare: () => void;
  onArchive: () => void;
  onFavorite: () => void;
  onClear: () => void;
}

export default function SelectionBar({
  count,
  onDownload,
  onMove,
  onCopy,
  onDelete,
  onShare,
  onArchive,
  onFavorite,
  onClear,
}: SelectionBarProps) {
  if (count === 0) return null;

  const btn =
    "flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl glass-hover border border-border/30 transition-colors hover:bg-surface/80 text-content-muted hover:text-content disabled:opacity-40";

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none pb-4 sm:pb-6">
      <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-2.5 glass-strong rounded-2xl border border-border/40 shadow-2xl backdrop-blur-2xl max-w-full overflow-x-auto">
        <span className="text-sm font-semibold text-content whitespace-nowrap mr-1 sm:mr-2">
          {count} selected
        </span>

        <div className="w-px h-6 bg-border/40" />

        <button onClick={onDownload} className={btn} title="Download">
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">Download</span>
        </button>
        <button onClick={onMove} className={btn} title="Move">
          <Move className="h-4 w-4" />
          <span className="hidden sm:inline">Move</span>
        </button>
        <button onClick={onCopy} className={btn} title="Copy">
          <Copy className="h-4 w-4" />
          <span className="hidden sm:inline">Copy</span>
        </button>
        <button onClick={onArchive} className={btn} title="Archive">
          <Archive className="h-4 w-4" />
          <span className="hidden sm:inline">Archive</span>
        </button>
        <button onClick={onShare} className={btn} title="Share">
          <Share2 className="h-4 w-4" />
          <span className="hidden sm:inline">Share</span>
        </button>
        <button onClick={onFavorite} className={btn} title="Favorite">
          <Star className="h-4 w-4" />
          <span className="hidden sm:inline">Favorite</span>
        </button>

        <div className="w-px h-6 bg-border/40" />

        <button onClick={onDelete} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl glass-hover border border-border/30 transition-colors text-red-400 hover:bg-red-500/10" title="Delete">
          <Trash2 className="h-4 w-4" />
          <span className="hidden sm:inline">Delete</span>
        </button>
        <button onClick={onClear} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl glass-hover border border-border/30 transition-colors text-content-muted hover:text-content" title="Clear selection">
          <X className="h-4 w-4" />
          <span className="hidden sm:inline">Clear</span>
        </button>
      </div>
    </div>
  );
}
