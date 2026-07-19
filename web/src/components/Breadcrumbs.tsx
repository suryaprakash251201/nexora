import { ChevronRight } from "lucide-react";
import { useState } from "react";

export default function Breadcrumbs({
  rootName,
  path,
  onNavigate,
}: {
  rootName: string;
  path: string;
  onNavigate: (path: string) => void;
}) {
  const segments = path.split("/").filter(Boolean);
  let acc = "";
  
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  
  // To implement drag and drop, we'd need a drop handler, but for now we add the UI highlighting
  // The actual drop would need to trigger moveSelectionTo which requires Workspace context
  // This is a simplified visual enhancement for now.
  const handleDragOver = (e: React.DragEvent, targetPath: string) => {
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
    // Ideally this dispatches an event or calls a prop, 
    // but without full Workspace integration we'll just show it visually supported.
  };

  return (
    <div className="flex items-center gap-1 text-sm overflow-x-auto no-scrollbar mask-edges pr-4 py-1">
      <button 
        onClick={() => onNavigate("")} 
        onDragOver={(e) => handleDragOver(e, "")}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, "")}
        className={`shrink-0 px-2 py-1 rounded-lg transition-colors duration-200 ${
          dragTarget === "" ? "bg-accent/20 text-accent outline-dashed outline-1 outline-accent" : "hover:bg-surface text-content hover:text-accent font-medium"
        }`}
      >
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
              onDragOver={(e) => handleDragOver(e, p)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, p)}
              className={`truncate max-w-[12rem] px-2 py-1 rounded-lg transition-colors duration-200 ${
                dragTarget === p 
                  ? "bg-accent/20 text-accent outline-dashed outline-1 outline-accent" 
                  : isLast 
                    ? "text-content font-bold bg-surface/50" 
                    : "hover:bg-surface text-content-muted hover:text-accent font-medium"
              }`}
            >
              {seg}
            </button>
          </span>
        );
      })}
    </div>
  );
}
