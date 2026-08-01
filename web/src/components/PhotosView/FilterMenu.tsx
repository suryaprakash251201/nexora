import { useEffect, useMemo, useRef, useState } from "react";
import { SlidersHorizontal, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PhotoFilters } from "./types";

interface FilterMenuProps {
  filters: PhotoFilters;
  onChange: (f: PhotoFilters) => void;
  availableCameras: string[];
  activeCount: number;
}

function Toggle({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm glass-hover"
    >
      <span>{label}</span>
      <span
        className={cn(
          "relative h-5 w-9 rounded-full transition-colors",
          checked ? "bg-accent" : "bg-surface-3"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
            checked ? "left-[18px]" : "left-0.5"
          )}
        />
      </span>
    </button>
  );
}

function SelectRow({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-content-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border/40 bg-surface-2 px-2.5 py-1.5 text-sm outline-none focus:border-accent"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

export function FilterMenu({ filters, onChange, availableCameras, activeCount }: FilterMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const set = (patch: Partial<PhotoFilters>) => onChange({ ...filters, ...patch });

  const cameraOptions = useMemo(
    () => [
      { value: "", label: "Any camera" },
      ...availableCameras.map((c) => ({ value: c, label: c })),
    ],
    [availableCameras]
  );

  const hasActive = activeCount > 0;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors",
          hasActive
            ? "border-accent/50 bg-accent/10 text-accent"
            : "border-border/40 glass-hover text-content-muted"
        )}
      >
        <SlidersHorizontal className="h-4 w-4" />
        <span className="hidden sm:inline">Filters</span>
        {hasActive && (
          <span className="grid h-4.5 min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-72 rounded-2xl border border-border/40 bg-surface-1 p-3 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between px-2">
            <p className="text-sm font-semibold">Filters</p>
            <button onClick={() => setOpen(false)} aria-label="Close filters" className="rounded p-1 glass-hover">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-1">
            <Toggle
              label="Favorites only"
              checked={!!filters.favoritesOnly}
              onToggle={() => set({ favoritesOnly: !filters.favoritesOnly })}
            />
            <Toggle
              label="Has location"
              checked={!!filters.hasLocation}
              onToggle={() => set({ hasLocation: !filters.hasLocation })}
            />
          </div>

          <div className="mt-3 space-y-2 border-t border-border/30 pt-3">
            <SelectRow
              label="Camera"
              value={filters.cameraMake || ""}
              options={cameraOptions}
              onChange={(v) => set({ cameraMake: v || undefined })}
            />
            <SelectRow
              label="Sort"
              value={filters.sort}
              options={[
                { value: "date_desc", label: "Newest first" },
                { value: "date_asc", label: "Oldest first" },
                { value: "name", label: "By name" },
              ]}
              onChange={(v) => set({ sort: v as PhotoFilters["sort"] })}
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-content-muted">From</span>
                <input
                  type="date"
                  value={filters.dateFrom || ""}
                  onChange={(e) => set({ dateFrom: e.target.value || undefined })}
                  className="w-full rounded-lg border border-border/40 bg-surface-2 px-2 py-1.5 text-sm outline-none focus:border-accent"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-content-muted">To</span>
                <input
                  type="date"
                  value={filters.dateTo || ""}
                  onChange={(e) => set({ dateTo: e.target.value || undefined })}
                  className="w-full rounded-lg border border-border/40 bg-surface-2 px-2 py-1.5 text-sm outline-none focus:border-accent"
                />
              </label>
            </div>
          </div>

          {hasActive && (
            <button
              onClick={() => onChange({ ...filters, year: undefined, month: undefined, cameraMake: undefined, hasLocation: false, favoritesOnly: false, dateFrom: undefined, dateTo: undefined, sort: "date_desc" })}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border/40 px-3 py-1.5 text-sm glass-hover"
            >
              <Check className="h-4 w-4" /> Reset all filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
