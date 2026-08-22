import { ChevronRight, FolderInput } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export default function Breadcrumbs({
  rootName,
  path,
  onNavigate,
  /** When provided, dropping selected files onto a crumb moves them there. */
  onDropToFolder,
}: {
  rootName: string;
  path: string;
  onNavigate: (path: string) => void;
  onDropToFolder?: (path: string) => void;
}) {
  const segments = path.split("/").filter(Boolean);
  let acc = "";

  const [dragTarget, setDragTarget] = useState<string | null>(null);

  const handleDragOver = (e: React.DragEvent, targetPath: string) => {
    if (!onDropToFolder) return; // no handler → don't advertise a drop target
    if ([...e.dataTransfer.types].includes("text/plain")) return; // ignore selection text
    e.preventDefault();
    setDragTarget(targetPath);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragTarget(null);
  };

  const handleDrop = (e: React.DragEvent, targetPath: string) => {
    e.preventDefault();
    setDragTarget(null);
    if (onDropToFolder && !([...e.dataTransfer.types].includes("text/plain"))) {
      onDropToFolder(targetPath);
    }
  };

  const crumbClass = (targetPath: string, isLast: boolean) =>
    cn(
      "truncate max-w-[5rem] sm:max-w-[12rem] px-2 py-1 rounded-lg transition-colors duration-200",
      dragTarget === targetPath
        ? "bg-accent/20 text-accent outline-dashed outline-1 outline-accent"
        : isLast
          ? "text-content font-bold bg-surface/50"
          : "hover:bg-surface text-content-muted hover:text-accent font-medium"
    );

  return (
    <nav aria-label="Folder path" className="flex items-center gap-1 text-sm overflow-x-auto no-scrollbar mask-edges pr-4 py-1">
      <button
        onClick={() => onNavigate("")}
        onDragOver={(e) => handleDragOver(e, "")}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, "")}
        className={cn("shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg transition-colors duration-200",
          dragTarget === ""
            ? "bg-accent/20 text-accent outline-dashed outline-1 outline-accent"
            : "hover:bg-surface text-content hover:text-accent font-medium")}
      >
        {dragTarget === "" && <FolderInput className="h-3.5 w-3.5" aria-hidden />}
        {rootName}
      </button>

      {segments.map((seg, i) => {
        acc += (i === 0 ? "" : "/") + seg;
        const p = acc;
        const isLast = i === segments.length - 1;

        return (
          <span key={i} className="flex items-center gap-1 shrink-0 animate-scale-in" style={{ animationDelay: `${i * 0.05}s` }}>
            <ChevronRight className="h-4 w-4 text-content-muted/50" />
            <span className={cn(dragTarget === p && "flex items-center gap-1 rounded-lg")}>
              <button
                onClick={() => onNavigate(p)}
                aria-current={isLast ? "page" : undefined}
                onDragOver={(e) => handleDragOver(e, p)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, p)}
                className={crumbClass(p, isLast)}
              >
                {seg}
              </button>
              {dragTarget === p && <FolderInput className="h-3.5 w-3.5 text-accent" aria-hidden />}
            </span>
          </span>
        );
      })}
    </nav>
  );
}
