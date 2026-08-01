import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Filter, X, ChevronDown, MapPin, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { PhotoFilters, YearFacet, CameraFacet } from "./types";

const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

interface FilterBarProps {
  filters: PhotoFilters;
  onChange: (filters: PhotoFilters) => void;
  yearFacets: YearFacet[];
  cameraFacets: CameraFacet[];
  className?: string;
}

interface FilterTriggerProps {
  label: string;
  active?: boolean;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function FilterTrigger({ label, active, open, onToggle, children }: FilterTriggerProps) {
  return (
    <div className="relative">
      <motion.button
        onClick={onToggle}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        aria-haspopup="true"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
          open
            ? "bg-accent text-white"
            : active
              ? "bg-accent/15 text-accent border border-accent/30"
              : "bg-surface/50 text-content-secondary hover:bg-surface border border-glass-border"
        )}
      >
        <span>{label}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </motion.button>

      {open && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="absolute top-full left-0 mt-2 p-4 bg-surface border border-glass-border rounded-xl shadow-xl z-50 min-w-[280px]"
        >
          {children}
        </motion.div>
      )}
    </div>
  );
}

export function FilterBar({ filters, onChange, yearFacets, cameraFacets, className }: FilterBarProps) {
  const [openFilters, setOpenFilters] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Close any open dropdown on outside click or Escape.
  useEffect(() => {
    if (!openFilters) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenFilters(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenFilters(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openFilters]);

  const activeFilterCount = [
    filters.year,
    filters.month,
    filters.cameraMake,
    filters.hasLocation,
    filters.favoritesOnly,
    filters.dateFrom,
    filters.dateTo,
  ].filter(Boolean).length;

  const clearAllFilters = () => {
    onChange({
      year: undefined,
      month: undefined,
      cameraMake: undefined,
      hasLocation: undefined,
      favoritesOnly: false,
      dateFrom: undefined,
      dateTo: undefined,
      sort: "date_desc",
    });
    setOpenFilters(null);
  };

  return (
    <div ref={barRef} className={cn("flex flex-wrap items-center gap-2", className)}>
      {activeFilterCount > 0 && (
        <motion.button
          onClick={clearAllFilters}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-accent bg-accent/10 rounded-lg hover:bg-accent/20 transition-colors"
          aria-label="Clear all filters"
        >
          <Filter className="h-3.5 w-3.5" />
          <span>{activeFilterCount} filter{activeFilterCount !== 1 ? "s" : ""}</span>
          <X className="h-3.5 w-3.5" />
        </motion.button>
      )}

      <div className="flex items-center gap-1">
        {/* Date Filter */}
        <FilterTrigger
          label={filters.year ? `${filters.year}${filters.month ? ` / ${MONTHS[filters.month - 1]?.label.slice(0, 3)}` : ""}` : "Date"}
          active={!!(filters.year || filters.month || filters.dateFrom || filters.dateTo)}
          open={openFilters === "date"}
          onToggle={() => setOpenFilters(openFilters === "date" ? null : "date")}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-content-muted mb-1">Year</label>
              <select
                value={filters.year || ""}
                onChange={(e) =>
                  onChange({ ...filters, year: e.target.value ? parseInt(e.target.value) : undefined, month: undefined })
                }
                className="w-full px-3 py-2 text-sm bg-surface/50 border border-glass-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-transparent"
              >
                <option value="">All years</option>
                {yearFacets.map(({ year }) => (
                  <option key={year} value={String(year)}>{year}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-content-muted mb-1">Month</label>
              <select
                value={filters.month || ""}
                onChange={(e) => onChange({ ...filters, month: e.target.value ? parseInt(e.target.value) : undefined })}
                disabled={!filters.year}
                className="w-full px-3 py-2 text-sm bg-surface/50 border border-glass-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-transparent disabled:opacity-50"
              >
                <option value="">All months</option>
                {MONTHS.map(({ value, label }) => (
                  <option key={value} value={String(value)}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-content-muted mb-1">From</label>
              <input
                type="date"
                value={filters.dateFrom || ""}
                onChange={(e) => onChange({ ...filters, dateFrom: e.target.value || undefined })}
                className="w-full px-3 py-2 text-sm bg-surface/50 border border-glass-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-muted mb-1">To</label>
              <input
                type="date"
                value={filters.dateTo || ""}
                onChange={(e) => onChange({ ...filters, dateTo: e.target.value || undefined })}
                className="w-full px-3 py-2 text-sm bg-surface/50 border border-glass-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-transparent"
              />
            </div>
          </div>
        </FilterTrigger>

        {/* Camera Filter */}
        <FilterTrigger
          label={filters.cameraMake || "Camera"}
          active={!!filters.cameraMake}
          open={openFilters === "camera"}
          onToggle={() => setOpenFilters(openFilters === "camera" ? null : "camera")}
        >
          <label className="block text-xs font-medium text-content-muted mb-2">Camera Make</label>
          <select
            value={filters.cameraMake || ""}
            onChange={(e) => onChange({ ...filters, cameraMake: e.target.value || undefined })}
            className="w-full px-3 py-2 text-sm bg-surface/50 border border-glass-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-transparent"
          >
            <option value="">All cameras</option>
            {cameraFacets.map(({ make, count }) => (
              <option key={make} value={make}>{make} ({count})</option>
            ))}
          </select>
        </FilterTrigger>

        {/* Quick Filters */}
        <motion.button
          onClick={() =>
            onChange({
              ...filters,
              // Normalize to a strict boolean so the active state is stable.
              hasLocation: !filters.hasLocation,
            })
          }
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
            filters.hasLocation
              ? "bg-accent text-white"
              : "bg-surface/50 text-content-secondary hover:bg-surface border border-glass-border"
          )}
          aria-pressed={filters.hasLocation}
        >
          <MapPin className="h-3.5 w-3.5" />
          <span>Location</span>
        </motion.button>

        <motion.button
          onClick={() => onChange({ ...filters, favoritesOnly: !filters.favoritesOnly })}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
            filters.favoritesOnly
              ? "bg-yellow-400 text-yellow-900"
              : "bg-surface/50 text-content-secondary hover:bg-surface border border-glass-border"
          )}
          aria-pressed={filters.favoritesOnly}
        >
          <Star className={cn("h-3.5 w-3.5", filters.favoritesOnly && "fill-current")} />
          <span>Favorites</span>
        </motion.button>
      </div>

      {/* Sort */}
      <div className="ml-auto">
        <select
          value={filters.sort}
          onChange={(e) => onChange({ ...filters, sort: e.target.value as PhotoFilters["sort"] })}
          className="px-3 py-1.5 text-xs font-medium bg-surface/50 border border-glass-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-transparent"
          aria-label="Sort photos"
        >
          <option value="date_desc">Newest first</option>
          <option value="date_asc">Oldest first</option>
          <option value="name">Name</option>
        </select>
      </div>
    </div>
  );
}
