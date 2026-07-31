import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";

interface YearNavigatorProps {
  years: Array<{ year: number; count: number }>;
  selectedYear?: number;
  onYearSelect: (year: number) => void;
  className?: string;
}

export function YearNavigator({ years, selectedYear, onYearSelect, className }: YearNavigatorProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className={cn("p-3 space-y-1 overflow-y-auto max-h-[calc(100vh-200px)]", className)}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-sm font-medium transition-colors",
          "hover:bg-accent/10 hover:text-accent",
          selectedYear === undefined && "bg-accent/10 text-accent"
        )}
        aria-expanded={expanded}
      >
        <span>All Years</span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden mt-1 space-y-0.5"
        >
          {years.map(({ year, count }) => (
            <button
              key={year}
              onClick={() => onYearSelect(year)}
              className={cn(
                "w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-sm transition-colors",
                "hover:bg-accent/10 hover:text-accent",
                selectedYear === year && "bg-accent/15 text-accent font-medium"
              )}
              aria-current={selectedYear === year ? "true" : "false"}
            >
              <span>{year}</span>
              <span className="text-xs text-content-muted font-normal">{count}</span>
            </button>
          ))}
        </motion.div>
      )}
    </div>
  );
}