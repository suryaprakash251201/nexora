import { motion } from "motion/react";
import { Grid2X2, Grid3X3, LayoutGrid, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type GridZoom = "compact" | "default" | "large" | "gallery";

const zoomLevels: { value: GridZoom; icon: React.FC<{ className?: string }>; label: string; colClass: string }[] = [
  { value: "compact", icon: Grid3X3, label: "Compact", colClass: "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10" },
  { value: "default", icon: Grid2X2, label: "Default", colClass: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" },
  { value: "large", icon: LayoutGrid, label: "Large", colClass: "grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" },
  { value: "gallery", icon: Maximize2, label: "Gallery", colClass: "grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" },
];

const STORAGE_KEY = "nexora-grid-zoom";

export function getStoredZoom(): GridZoom {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && zoomLevels.some((z) => z.value === v)) return v as GridZoom;
  } catch {}
  return "default";
}

export function storeZoom(zoom: GridZoom) {
  try { localStorage.setItem(STORAGE_KEY, zoom); } catch {}
}

export function getGridColClass(zoom: GridZoom): string {
  return zoomLevels.find((z) => z.value === zoom)?.colClass || zoomLevels[1].colClass;
}

export function getCardSize(zoom: GridZoom): "sm" | "md" | "lg" | "xl" {
  switch (zoom) {
    case "compact": return "sm";
    case "default": return "md";
    case "large": return "lg";
    case "gallery": return "xl";
  }
}

export function ZoomSlider({ value, onChange }: { value: GridZoom; onChange: (v: GridZoom) => void }) {
  const idx = zoomLevels.findIndex((z) => z.value === value);

  return (
    <div className="flex items-center gap-1 p-1 rounded-xl glass-subtle border border-white/[0.06]">
      {zoomLevels.map((z, i) => {
        const Icon = z.icon;
        const active = i === idx;
        return (
          <button
            key={z.value}
            onClick={() => { onChange(z.value); storeZoom(z.value); }}
            title={z.label}
            className={cn(
              "relative p-1.5 rounded-lg transition-all duration-200",
              active ? "text-accent" : "text-text-tertiary hover:text-text-secondary"
            )}
          >
            {active && (
              <motion.div
                layoutId="zoom-active"
                className="absolute inset-0 rounded-lg bg-accent/12 border border-accent/25"
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              />
            )}
            <Icon className="h-4 w-4 relative z-10" />
          </button>
        );
      })}
    </div>
  );
}
