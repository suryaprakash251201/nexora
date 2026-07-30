import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "../api/client";
import type { Root, FileItem } from "../api/types";
import { FileThumb } from "./FileThumb";

interface PhotoResult {
  id: string;
  root_id: string;
  path: string;
  name: string;
  date_taken: string;
  lat?: number;
  lng?: number;
  make?: string;
  model?: string;
}

export default function PhotosView({ roots, onOpen }: { roots: Root[], onOpen: (rootId: string, path: string) => void }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["photos"],
    queryFn: () => get<{ items: PhotoResult[], has_more: boolean }>("/photos?limit=1000"),
    retry: 2,
    staleTime: 30_000,
  });

  const photos = data?.items || [];

  // Group photos by Month/Year
  const groups = useMemo(() => {
    const map = new Map<string, PhotoResult[]>();
    for (const p of photos) {
      if (!p.date_taken) continue;
      try {
        const d = new Date(p.date_taken);
        if (isNaN(d.getTime())) continue;
        const key = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(p);
      } catch (err) {
        // invalid date
      }
    }
    return Array.from(map.entries());
  }, [photos]);

  return (
    <div className="flex-1 overflow-y-auto p-6 pt-24 hide-scrollbar">
      <div className="max-w-7xl mx-auto space-y-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-accent via-accent-secondary to-accent-tertiary">
            Photos
          </h1>
          <p className="text-content-muted mt-2">
            Timeline of your photos, automatically extracted from EXIF metadata.
          </p>
        </header>

        {isLoading ? (
          <div className="flex justify-center p-12">
            <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        ) : isError ? (
          <div className="text-center p-12">
            <p className="text-red-400 font-medium mb-2">Failed to load photos</p>
            <p className="text-content-muted text-sm mb-4">{(error as Error)?.message || "An unexpected error occurred."}</p>
            <button
              onClick={() => refetch()}
              className="px-4 py-2 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition text-sm font-medium"
            >
              Try again
            </button>
          </div>
        ) : groups.length === 0 ? (
          <div className="text-center p-12 text-content-muted">
            <p className="text-lg font-medium mb-2">No photos found</p>
            <p className="text-sm">
              Make sure you have indexed images and wait a moment for the metadata extractor to run.
              Photos must have EXIF date metadata to appear in the timeline.
            </p>
          </div>
        ) : (
          groups.map(([monthYear, groupPhotos]) => (
            <div key={monthYear} className="space-y-4">
              <h2 className="text-xl font-semibold sticky top-20 z-10 bg-background/80 backdrop-blur py-2">
                {monthYear}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                {groupPhotos.map((p) => (
                  <div 
                    key={p.id} 
                    className="relative aspect-square rounded-xl overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary transition group bg-surface"
                    onClick={() => onOpen(p.root_id, p.path)}
                  >
                    <div className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-110">
                      <FileThumb it={{ root_id: p.root_id, path: p.path, name: p.name, is_dir: false, extension: p.name.split('.').pop() || '', mime: 'image/jpeg' } as FileItem} fill />
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    {p.model && (
                      <div className="absolute bottom-2 left-2 text-[10px] text-white opacity-0 group-hover:opacity-100 font-medium drop-shadow-md truncate max-w-[90%]">
                        {p.model}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
