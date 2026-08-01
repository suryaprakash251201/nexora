import { Download, Share2, Star, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SelectionBarProps {
  count: number;
  onScreenCount: number;
  allOnScreenSelected: boolean;
  onSelectAllOnScreen: () => void;
  onFavorite: () => void;
  onDownload: () => void;
  onShare: () => void;
  onDelete: () => void;
  onClear: () => void;
  sharing: boolean;
}

function BarButton({
  label, icon, onClick, disabled, danger,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-colors",
        danger
          ? "text-red-400 hover:bg-red-500/15"
          : "text-content-muted hover:bg-white/10 hover:text-content",
        disabled && "pointer-events-none opacity-40"
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export function SelectionBar({
  count, onScreenCount, allOnScreenSelected, onSelectAllOnScreen,
  onFavorite, onDownload, onShare, onDelete, onClear, sharing,
}: SelectionBarProps) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 md:bottom-8">
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-2xl border border-white/10 bg-black/70 p-1.5 shadow-2xl shadow-black/50 backdrop-blur-xl">
        <div className="flex items-center gap-2 px-3">
          <span className="text-sm font-bold text-white">{count}</span>
          <span className="hidden text-xs text-white/60 sm:inline">selected</span>
        </div>
        <div className="mx-1 h-6 w-px bg-white/15" />
        <button
          onClick={onSelectAllOnScreen}
          className="rounded-xl px-3 py-2 text-xs font-medium text-content-muted hover:bg-white/10 hover:text-content"
        >
          {allOnScreenSelected ? "Deselect on screen" : "Select all on screen"}
          <span className="hidden text-white/50 sm:inline"> ({onScreenCount})</span>
        </button>
        <div className="mx-1 h-6 w-px bg-white/15" />
        <BarButton label="Favorite" icon={<Star className="h-4 w-4" />} onClick={onFavorite} />
        <BarButton label="Download" icon={<Download className="h-4 w-4" />} onClick={onDownload} />
        <BarButton label="Share" icon={<Share2 className="h-4 w-4" />} onClick={onShare} disabled={sharing} />
        <BarButton label="Delete" icon={<Trash2 className="h-4 w-4" />} onClick={onDelete} danger />
        <div className="mx-1 h-6 w-px bg-white/15" />
        <BarButton label="Close" icon={<X className="h-4 w-4" />} onClick={onClear} />
      </div>
    </div>
  );
}
