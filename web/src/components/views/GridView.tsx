/**
 * Extracted from Workspace.tsx — shared card grid for library views
 * (favourites, recents, photos-style lists).
 */
import { motion } from "framer-motion";
import { FileThumb } from "../FileThumb";
import { SkeletonGrid } from "../ui/Skeleton";
import { EmptyState } from "../ui/EmptyState";
import { formatRelative } from "@/lib/format";
import type { FileItem } from "../../api/types";
import { staggerContainer, staggerItem, cardHover } from "@/lib/animations";

export interface GridItem {
  id: string;
  name: string;
  root_name: string;
  path: string;
  root_id: string;
  date: string;
  extension: string;
}

export function GridView({ loading, empty, emptyVariant, items, onOpen }: {
  loading: boolean;
  empty: string;
  /** Illustration variant for the branded empty state. */
  emptyVariant?: 'files' | 'search' | 'shares' | 'favorites' | 'trash' | 'playlists' | 'generic' | 'recents' | 'uploads' | 'tags' | 'no-results';
  items: GridItem[];
  onOpen: (item: GridItem) => void;
}) {
  if (loading) return <div className="p-6"><SkeletonGrid count={6} /></div>;
  if (!items.length) return <div className="p-10"><EmptyState variant={emptyVariant ?? "generic"} title={empty} /></div>;
  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-6"
    >
      {items.map((item) => {
        const fi: FileItem = {
          name: item.name,
          path: item.path,
          size: 0,
          is_dir: false,
          modified: item.date,
          mime: "",
          root_id: item.root_id,
          extension: item.extension,
        };
        return (
          <motion.button
            key={item.id}
            variants={staggerItem}
            {...cardHover}
            onClick={() => onOpen(item)}
            className="group w-full min-w-0 text-left outline-none flex items-center gap-4 p-3 rounded-2xl glass-strong border border-glass-border hover:border-accent/40 focus-visible:ring-2 focus-visible:ring-accent transition-all duration-300 overflow-hidden relative"
          >
            {/* Inner card glow */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] via-transparent to-transparent pointer-events-none rounded-2xl" />
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/8 to-transparent" />

            <div className="relative h-14 w-14 shrink-0 rounded-xl overflow-hidden shadow-sm">
              <FileThumb it={fi} fill />
              <div className="absolute inset-0 bg-black/[0.05] dark:bg-black/10 group-hover:bg-black/[0.1] dark:group-hover:bg-black/20 transition-colors duration-300" />
            </div>

            <div className="flex-1 min-w-0">
              <p className="truncate text-[15px] font-semibold text-content group-hover:text-accent transition-colors">
                {item.name}
              </p>
              <div className="flex min-w-0 items-center gap-2 mt-1">
                <p className="min-w-0 truncate text-xs font-medium text-content-muted">
                  {item.root_name}
                </p>
                <span className="h-1 w-1 shrink-0 rounded-full bg-border/80" />
                <p className="min-w-0 truncate text-xs font-medium text-content-muted/70 uppercase tracking-wider">
                  {formatRelative(item.date)}
                </p>
              </div>
            </div>
          </motion.button>
        );
      })}
    </motion.div>
  );
}
