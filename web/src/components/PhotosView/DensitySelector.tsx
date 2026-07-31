import { Grid, Layout, LayoutList, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";

type Density = "compact" | "comfortable" | "spacious";

const DENSITY_OPTIONS: Array<{ value: Density; label: string; icon: React.ReactNode; description: string }> = [
  {
    value: "compact",
    label: "Compact",
    icon: <LayoutGrid className="h-4 w-4" />,
    description: "More photos per row",
  },
  {
    value: "comfortable",
    label: "Comfortable",
    icon: <Layout className="h-4 w-4" />,
    description: "Balanced spacing",
  },
  {
    value: "spacious",
    label: "Spacious",
    icon: <LayoutList className="h-4 w-4" />,
    description: "Larger thumbnails",
  },
];

interface DensitySelectorProps {
  value: Density;
  onChange: (density: Density) => void;
  className?: string;
}

export function DensitySelector({ value, onChange, className }: DensitySelectorProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className={cn("relative", className)}>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
          "hover:bg-accent/10 hover:text-accent",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Grid density: ${value}`}
      >
        {DENSITY_OPTIONS.find((d) => d.value === value)?.icon}
        <span className="hidden sm:inline">{value.charAt(0).toUpperCase() + value.slice(1)}</span>
        <svg className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <motion.div
        ref={popoverRef}
        initial={{ opacity: 0, y: -8, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.95 }}
        transition={{ duration: 0.12 }}
        className="absolute right-0 top-full mt-1.5 z-50 glass-strong border border-glass-border rounded-xl p-1 shadow-lg min-w-[160px]"
        role="listbox"
        aria-label="Select grid density"
      >
        {DENSITY_OPTIONS.map((option) => (
          <motion.button
            key={option.value}
            onClick={() => {
              onChange(option.value);
              setOpen(false);
            }}
            whileHover={{ backgroundColor: "var(--color-glass-bg-strong)" }}
            whileTap={{ scale: 0.98 }}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              "text-content hover:text-accent",
              value === option.value && "bg-accent/10 text-accent",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset"
            )}
            role="option"
            aria-selected={value === option.value}
          >
            <span className={cn("w-5 h-5 flex items-center justify-center", value === option.value && "text-accent")}>
              {option.icon}
            </span>
            <div className="flex-1 text-left">
              <p className="font-medium">{option.label}</p>
              <p className="text-[11px] text-content-muted">{option.description}</p>
            </div>
            {value === option.value && (
              <svg className="h-4 w-4 text-accent flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </motion.button>
        ))}
      </motion.div>
    </div>
  );
}

import { useState, useRef, useEffect } from "react";