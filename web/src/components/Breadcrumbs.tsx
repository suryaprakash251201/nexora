import { ChevronRight, MoveHorizontal } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  canDropInto,
  currentDragPaths,
  endDragMove,
  isInternalMoveDrag,
} from "../lib/dragMove";

export default function Breadcrumbs({
  rootName,
  path,
  onNavigate,
  /** When provided, dropping selected files onto a crumb moves them there. */
  onDropToFolder,
  /** When provided, dropping OS files onto a crumb uploads them to that folder. */
  onUploadFiles,
}: {
  rootName: string;
  path: string;
  onNavigate: (path: string) => void;
  /** `paths` is the internal move-drag payload when available. */
  onDropToFolder?: (path: string, paths?: string[]) => void;
  onUploadFiles?: (files: FileList, path: string) => void;
}) {
  const segments = path.split("/").filter(Boolean);
  let acc = "";

  const [dragTarget, setDragTarget] = useState<string | null>(null);

  // External file drags advertise a "Files" type; internal move drags
  // advertise the Nexora move MIME (see lib/dragMove).
  const isFileDrag = (e: React.DragEvent) => [...e.dataTransfer.types].includes("Files");
  const canAccept = (e: React.DragEvent, targetPath: string) => {
    if (isFileDrag(e)) return !!onUploadFiles;
    if (!isInternalMoveDrag(e)) return false;
    // Never accept a drop into itself or its own descendants.
    return !!onDropToFolder && canDropInto(targetPath, currentDragPaths());
  };

  const handleDragOver = (e: React.DragEvent, targetPath: string) => {
    if (!canAccept(e, targetPath)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = isFileDrag(e) ? "copy" : "move";
    setDragTarget(targetPath);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragTarget(null);
  };

  const handleDrop = (e: React.DragEvent, targetPath: string) => {
    const wasInternal = isInternalMoveDrag(e);
    e.preventDefault();
    setDragTarget(null);
    if (isFileDrag(e)) {
      if (onUploadFiles && e.dataTransfer.files.length > 0) onUploadFiles(e.dataTransfer.files, targetPath);
    } else if (wasInternal && onDropToFolder) {
      const paths = currentDragPaths();
      endDragMove();
      onDropToFolder(targetPath, paths);
    }
  };

  const crumbClass = (targetPath: string, isLast: boolean) =>
    cn(
      "truncate max-w-[5rem] sm:max-w-[12rem] px-2 py-1 rounded-lg transition-all duration-200",
      dragTarget === targetPath
        ? "bg-accent/15 text-accent ring-2 ring-accent/60 shadow-[0_0_0_4px_rgba(91,140,255,0.12)] scale-105"
        : isLast
          ? "text-content font-bold bg-surface/50"
          : "hover:bg-surface text-content-muted hover:text-accent font-medium",
    );

  return (
    <nav aria-label="Folder path" className="flex items-center gap-1 text-sm overflow-x-auto no-scrollbar mask-edges pr-4 py-1">
      <button
        onClick={() => onNavigate("")}
        onDragOver={(e) => handleDragOver(e, "")}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, "")}
        className={cn("shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-lg transition-all duration-200",
          dragTarget === ""
            ? "bg-accent/15 text-accent ring-2 ring-accent/60 shadow-[0_0_0_4px_rgba(91,140,255,0.12)]"
            : "hover:bg-surface text-content hover:text-accent font-medium")}
        aria-label={`Move into ${rootName}`}
      >
        {dragTarget === "" ? <MoveHorizontal className="h-3.5 w-3.5" aria-hidden /> : null}
        {rootName}
      </button>

      {segments.map((seg, i) => {
        acc += (i === 0 ? "" : "/") + seg;
        const p = acc;
        const isLast = i === segments.length - 1;

        return (
          <span key={i} className="flex items-center gap-1 shrink-0 animate-scale-in" style={{ animationDelay: `${i * 0.05}s` }}>
            <ChevronRight className="h-4 w-4 text-content-muted/50" />
            <button
              onClick={() => onNavigate(p)}
              aria-current={isLast ? "page" : undefined}
              aria-label={isLast ? seg : `Move into ${seg}`}
              onDragOver={(e) => handleDragOver(e, p)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, p)}
              className={crumbClass(p, isLast)}
            >
              {dragTarget === p ? <MoveHorizontal className="inline h-3 w-3 mr-1 -mt-0.5" aria-hidden /> : null}
              {seg}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
