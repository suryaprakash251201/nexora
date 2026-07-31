import { useState, useRef, useEffect } from "react";
import { ChevronDown, Filter, X, Calendar, Camera, MapPin, Star, SlidersHorizontal, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "motion/react";

interface FilterBarProps {
  filters: {
    year?: number;
    month?: number;
    cameraMake?: string;
    hasLocation?: boolean;
    favoritesOnly?: boolean;
    dateFrom?: string;
    dateTo?: string;
    sort: "date_desc" | "date_asc" | "name";
  };
  onChange: (filters: FilterBarProps["filters"]) => void;
  cameraMakes: string[];
  yearFacets: Array<{ year: number; count: number }>;
  className?: string;
}

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

const SORT_OPTIONS = [
  { value: "date_desc", label: "Newest first" },
  { value: "date_asc", label: "Oldest first" },
  { value: "name", label: "Name A–Z" },
];

export function FilterBar({ filters, onChange, cameraMakes, yearFacets, className }: FilterBarProps) {
  const [openFilters, setOpenFilters] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpenFilters(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.year !== undefined) count++;
    if (filters.month !== undefined) count++;
    if (filters.cameraMake) count++;
    if (filters.hasLocation !== undefined) count++;
    if (filters.favoritesOnly) count++;
    if (filters.dateFrom || filters.dateTo) count++;
    return count;
  }, [filters]);

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
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {/* Active filters indicator */}
      {activeFilterCount > 0 && (
        <motion.button
          onClick={clearAllFilters}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-accent bg-accent/10 rounded-lg hover:bg-accent/20 transition-colors"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          aria-label="Clear all filters"
        >
          <Filter className="h-3.5 w-3.5" />
          <span>{activeFilterCount} filter{activeFilterCount !== 1 ? "s" : ""}</span>
          <X className="h-3.5 w-3.5 hover:opacity-70" />
        </motion.button>
      )}

      {/* Filter triggers */}
      <div className="flex items-center gap-1">
        {/* Year/Month Filter */}
        <FilterTrigger
          label={filters.year ? `${filters.year}${filters.month ? ` / ${MONTHS[filters.month - 1]?.label.slice(0, 3)}` : ""}` : "Date"}
          icon={<Calendar className="h-3.5 w-3.5" />}
          isActive={filters.year !== undefined || filters.month !== undefined}
          open={openFilters === "date"}
          onClick={() => setOpenFilters(openFilters === "date" ? null : "date")}
          popoverRef={popoverRef}
        >
          <FilterPopoverContent>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-content-muted mb-1">Year</label>
                <select
                  value={filters.year || ""}
                  onChange={(e) => onChange({ ...filters, year: e.target.value ? parseInt(e.target.value) : undefined, month: undefined })}
                  className="w-full px-3 py-2 text-sm bg-surface/50 border border-glass-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-transparent"
                >
                  <option value="">All years</option>
                  {yearFacets.map(({ year }) => (
                    <option key={year} value={String(year)}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-content-muted mb-1">Month</label>
                <select
                  value={filters.month || ""}
                  onChange={(e) => onChange({ ...filters, month: e.target.value ? parseInt(e.target.value) : undefined })}
                  disabled={!filters.year}
                  className="w-full px-3 py-2 text-sm bg-surface/50 border border-glass-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">All months</option>
                  {MONTHS.map((m) => (
                    <option key={m.value} value={String(m.value)}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 flex gap-2 pt-2">
                <button
                  onClick={() => onChange({ ...filters, dateFrom: undefined, dateTo: undefined })}
                  className="flex-1 px-3 py-2 text-sm text-content-muted bg-surface/50 border border-glass-border rounded-lg hover:bg-surface hover:border-accent/50 transition-colors"
                >
                  Clear dates
                </button>
                <button
                  onClick={() => {
                    const today = new Date().toISOString().split("T")[0];
                    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
                    onChange({ ...filters, dateFrom: monthAgo, dateTo: today });
                  }}
                  className="flex-1 px-3 py-2 text-sm text-accent bg-accent/10 border border-accent/30 rounded-lg hover:bg-accent/20 transition-colors"
                >
                  Last 30 days
                </button>
              </div>
            </div>
          </FilterPopoverContent>
        </FilterTrigger>

        {/* Camera Make Filter */}
        <FilterTrigger
          label={filters.cameraMake || "Camera"}
          icon={<Camera className="h-3.5 w-3.5" />}
          isActive={!!filters.cameraMake}
          open={openFilters === "camera"}
          onClick={() => setOpenFilters(openFilters === "camera" ? null : "camera")}
          popoverRef={popoverRef}
        >
          <FilterPopoverContent className="max-h-60 overflow-auto">
            <div className="space-y-1">
              <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-accent/10 cursor-pointer">
                <input
                  type="radio"
                  name="camera-make"
                  checked={!filters.cameraMake}
                  onChange={() => onChange({ ...filters, cameraMake: undefined })}
                  className="h-4 w-4 text-accent border-glass-border focus:ring-accent"
                />
                <span className="text-sm">All cameras</span>
              </label>
              {cameraMakes.map((make) => (
                <label key={make} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-accent/10 cursor-pointer">
                  <input
                    type="radio"
                    name="camera-make"
                    checked={filters.cameraMake === make}
                    onChange={() => onChange({ ...filters, cameraMake: make })}
                    className="h-4 w-4 text-accent border-glass-border focus:ring-accent"
                  />
                  <span className="text-sm truncate">{make}</span>
                </label>
              ))}
            </div>
          </FilterPopoverContent>
        </FilterTrigger>

        {/* Location Filter */}
        <FilterTrigger
          label={filters.hasLocation !== undefined ? (filters.hasLocation ? "Has location" : "No location") : "Location"}
          icon={<MapPin className="h-3.5 w-3.5" />}
          isActive={filters.hasLocation !== undefined}
          open={openFilters === "location"}
          onClick={() => setOpenFilters(openFilters === "location" ? null : "location")}
          popoverRef={popoverRef}
        >
          <FilterPopoverContent>
            <div className="space-y-1">
              <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-accent/10 cursor-pointer">
                <input
                  type="radio"
                  name="location"
                  checked={filters.hasLocation === undefined}
                  onChange={() => onChange({ ...filters, hasLocation: undefined })}
                  className="h-4 w-4 text-accent border-glass-border focus:ring-accent"
                />
                <span className="text-sm">All photos</span>
              </label>
              <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-accent/10 cursor-pointer">
                <input
                  type="radio"
                  name="location"
                  checked={filters.hasLocation === true}
                  onChange={() => onChange({ ...filters, hasLocation: true })}
                  className="h-4 w-4 text-accent border-glass-border focus:ring-accent"
                />
                <span className="text-sm">Has GPS location</span>
              </label>
              <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-accent/10 cursor-pointer">
                <input
                  type="radio"
                  name="location"
                  checked={filters.hasLocation === false}
                  onChange={() => onChange({ ...filters, hasLocation: false })}
                  className="h-4 w-4 text-accent border-glass-border focus:ring-accent"
                />
                <span className="text-sm">No GPS location</span>
              </label>
            </div>
          </FilterPopoverContent>
        </FilterTrigger>

        {/* Favorites Filter */}
        <FilterTrigger
          label="Favorites"
          icon={<Star className="h-3.5 w-3.5" />}
          isActive={filters.favoritesOnly}
          open={openFilters === "favorites"}
          onClick={() => {
            onChange({ ...filters, favoritesOnly: !filters.favoritesOnly });
            setOpenFilters(null);
          }}
          popoverRef={popoverRef}
        />

        {/* Sort */}
        <FilterTrigger
          label={SORT_OPTIONS.find((s) => s.value === filters.sort)?.label || "Sort"}
          icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
          isActive={false}
          open={openFilters === "sort"}
          onClick={() => setOpenFilters(openFilters === "sort" ? null : "sort")}
          popoverRef={popoverRef}
        >
          <FilterPopoverContent>
            <div className="space-y-1">
              {SORT_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-accent/10 cursor-pointer"
                >
                  <input
                    type="radio"
                    name="sort"
                    checked={filters.sort === opt.value}
                    onChange={() => onChange({ ...filters, sort: opt.value })}
                    className="h-4 w-4 text-accent border-glass-border focus:ring-accent"
                  />
                  <span className="text-sm">{opt.label}</span>
                </label>
              ))}
            </div>
          </FilterPopoverContent>
        </FilterTrigger>
      </div>
    </div>
  );
}

// Helper components
interface FilterTriggerProps {
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  open: boolean;
  onClick: () => void;
  popoverRef: React.RefObject<HTMLDivElement>;
  children: React.ReactNode;
}

function FilterTrigger({ label, icon, isActive, open, onClick, popoverRef, children }: FilterTriggerProps) {
  return (
    <div className="relative">
      <button
        onClick={onClick}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors",
          "hover:bg-accent/10 hover:text-accent",
          isActive ? "bg-accent/10 text-accent" : "text-content-muted hover:text-content"
        )}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <span className="flex items-center">{icon}</span>
        <span>{label}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={popoverRef}
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-1.5 z-50 min-w-[200px] glass-strong border border-glass-border rounded-xl p-2 shadow-lg"
            role="menu"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FilterPopoverContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("py-1", className)}>{children}</div>;
}

import { useMemo } from "react";