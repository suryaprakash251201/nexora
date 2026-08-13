import { Download, Move, Copy, Share2, Trash2, X } from "lucide-react";
import { Button } from "./ui/Button";

export type SelectionAction = "download" | "move" | "copy" | "share" | "delete";

interface SelectionBarProps {
  allSelected: boolean;
  selectedCount: number;
  totalCount: number;
  onToggleSelectAll: () => void;
  onAction: (action: SelectionAction) => void;
  onClear: () => void;
}

export default function SelectionBar({
  allSelected,
  selectedCount,
  totalCount,
  onToggleSelectAll,
  onAction,
  onClear,
}: SelectionBarProps) {
  const canAct = selectedCount > 0;
  const actionBtn =
    "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl glass-hover border border-border/30 transition-all hover:bg-surface/80 text-content-muted hover:text-content disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap";

  return (
    <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-6 py-2 border-b border-glass-border-soft bg-glass-bg-subtle backdrop-blur-sm" aria-label="Selection actions">
      <label className="flex items-center gap-2 text-xs sm:text-sm font-medium cursor-pointer select-none shrink-0 hover:text-foreground">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={onToggleSelectAll}
          className="rounded border-2 border-glass-border bg-glass-bg text-accent focus:ring-accent cursor-pointer transition-all w-4 h-4 sm:w-4.5 sm:h-4.5"
          aria-label={allSelected ? "Deselect all" : "Select all"}
        />
        <span className="font-medium text-text-secondary hover:text-content">{allSelected ? "Deselect all" : "Select all"}</span>
      </label>

      <span className="text-xs text-text-tertiary whitespace-nowrap shrink-0">
        {selectedCount} of {totalCount} selected
      </span>

      <div className="w-px h-5 bg-border/40 shrink-0 mx-0.5 sm:mx-1" />

      <div className="flex items-center gap-1.5 overflow-x-auto hide-scrollbar">
        <Button size="sm" variant="secondary" disabled={!canAct} onClick={() => onAction("download")} icon={<Download className="h-3.5 w-3.5" />}>
          <span className="hidden sm:inline">Download</span>
        </Button>
        <Button size="sm" variant="secondary" disabled={!canAct} onClick={() => onAction("move")} icon={<Move className="h-3.5 w-3.5" />}>
          <span className="hidden sm:inline">Move</span>
        </Button>
        <Button size="sm" variant="secondary" disabled={!canAct} onClick={() => onAction("copy")} icon={<Copy className="h-3.5 w-3.5" />}>
          <span className="hidden sm:inline">Copy</span>
        </Button>
        <Button size="sm" variant="secondary" disabled={!canAct} onClick={() => onAction("share")} icon={<Share2 className="h-3.5 w-3.5" />}>
          <span className="hidden sm:inline">Share</span>
        </Button>
        <Button size="sm" variant="danger" disabled={!canAct} onClick={() => onAction("delete")} icon={<Trash2 className="h-3.5 w-3.5" />}>
          <span className="hidden sm:inline">Delete</span>
        </Button>
      </div>

      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        <button
          onClick={onClear}
          className={actionBtn}
        >
          <X className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Clear</span>
        </button>
      </div>
    </div>
  );
}
