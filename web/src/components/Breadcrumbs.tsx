import { ChevronRight } from "lucide-react";

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
  return (
    <div className="flex items-center gap-1 text-sm min-w-0 overflow-hidden">
      <button onClick={() => onNavigate("")} className="hover:text-accent shrink-0">
        {rootName}
      </button>
      {segments.map((seg, i) => {
        acc += (i === 0 ? "" : "/") + seg;
        const p = acc;
        const isLast = i === segments.length - 1;
        return (
          <span key={i} className="flex items-center gap-1 shrink-0">
            <ChevronRight className="h-4 w-4 text-content-muted" />
            <button
              onClick={() => onNavigate(p)}
              className={`truncate max-w-[12rem] ${isLast ? "text-content font-medium" : "hover:text-accent"}`}
            >
              {seg}
            </button>
          </span>
        );
      })}
    </div>
  );
}
