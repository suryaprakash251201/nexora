import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon, Filter } from "lucide-react";
import { get } from "../api/client";
import { formatBytes, formatDate } from "../lib/format";
import type { Root, SearchResult, FileItem } from "../api/types";
import { FileThumb, FolderTile } from "./FileThumb";
import { Input } from "./ui/Input";
import { EmptyState } from "./ui/EmptyState";
import { SkeletonList } from "./ui/Skeleton";

export default function SearchView({
  initialQuery,
  roots,
  onOpen,
  selection,
  selectMode,
  onSelect,
}: {
  initialQuery: string;
  roots: Root[];
  onOpen: (r: SearchResult) => void;
  selection?: Set<string>;
  selectMode?: boolean;
  onSelect?: (id: string) => void;
}) {
  const [q, setQ] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery);
  const [root, setRoot] = useState("");
  const [kind, setKind] = useState("");
  const [ext, setExt] = useState("");
  const [sort, setSort] = useState("relevance");
  const [showFilters, setShowFilters] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isFetching } = useQuery({
    queryKey: ["search", debounced, root, kind, ext, sort],
    queryFn: () =>
      get<{ items: SearchResult[] }>("/search", {
        q: debounced,
        root: root || undefined,
        kind: kind || undefined,
        ext: ext || undefined,
        sort,
        limit: 100,
      }),
    enabled: debounced.length > 0 || kind !== "" || ext !== "",
  });

  const results = data?.items || [];

  return (
    <div className="flex-1 flex flex-col h-full bg-background">
      <div className="px-6 pt-6 pb-4 border-b border-border/50 bg-surface/50 backdrop-blur-xl sticky top-0 z-10 shrink-0">
        <div className="max-w-4xl mx-auto space-y-4 animate-slide-up">
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                autoFocus
                variant="search"
                icon={<SearchIcon className="h-5 w-5" />}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search all authorized files…"
                className="h-12 text-base"
              />
            </div>
            <button 
              onClick={() => setShowFilters(!showFilters)}
              className={`px-4 rounded-xl transition-colors border ${showFilters ? "bg-accent/15 text-accent border-accent/30" : "glass-input text-content-muted hover:text-content"}`}
              title="Toggle filters"
            >
              <Filter className="h-5 w-5" />
            </button>
          </div>
          
          {showFilters && (
            <div className="flex flex-wrap gap-3">
              <select value={root} onChange={(e) => setRoot(e.target.value)} className="rounded-xl glass-input px-3 py-2 text-sm outline-none cursor-pointer">
                <option value="">All storage roots</option>
                {roots.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              
              <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-xl glass-input px-3 py-2 text-sm outline-none cursor-pointer">
                <option value="">Any type</option>
                <option value="image">Images</option>
                <option value="video">Videos</option>
                <option value="audio">Audio</option>
                <option value="document">Documents</option>
                <option value="archive">Archives</option>
              </select>
              
              <div className="relative">
                <input 
                  value={ext} 
                  onChange={(e) => setExt(e.target.value)} 
                  placeholder="Extension (e.g. pdf)" 
                  className="w-36 rounded-xl glass-input px-3 py-2 text-sm outline-none" 
                />
              </div>
              
              <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-xl glass-input px-3 py-2 text-sm outline-none cursor-pointer ml-auto">
                <option value="relevance">Sort: Relevance</option>
                <option value="newest">Sort: Newest</option>
                <option value="largest">Sort: Largest</option>
                <option value="name">Sort: Name</option>
              </select>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        <div className="max-w-4xl mx-auto">
          {isFetching ? (
            <div className="mt-4"><SkeletonList /></div>
          ) : results.length === 0 ? (
            <div className="mt-12">
              <EmptyState 
                variant="search" 
                title={debounced ? "No results found" : "Type to start searching"} 
                description={debounced ? "Try adjusting your filters or search terms." : "Search uses a background metadata index. New files appear after a scan."}
              />
            </div>
          ) : (
            <div className="space-y-1 stagger-children">
              {results.map((r) => {
                const rootName = roots.find((x) => x.id === r.root_id)?.name || "";
                const id = r.root_id + r.path;
                const selected = selection?.has(id) ?? false;
                return (
                  <div key={id} className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${selected ? "bg-accent/10 ring-1 ring-accent/30" : "hover:bg-surface/60"}`}>
                    {(selectMode || selection?.size) && onSelect && (
                      <label className="flex items-center cursor-pointer shrink-0">
                        <input type="checkbox" checked={selected} onChange={() => onSelect(id)}
                          className="w-4 h-4 rounded border-2 border-border/80 bg-surface/80 text-accent focus:ring-accent cursor-pointer transition-all" />
                      </label>
                    )}
                    <button
                      onClick={() => onOpen(r)}
                      className="flex-1 group grid grid-cols-[auto_1fr_auto] gap-4 items-center text-left outline-none focus:ring-2 focus:ring-accent/40"
                    >
                    <div className="shrink-0 transition-transform duration-300 group-hover:scale-105">
                      {r.is_dir ? <FolderTile /> : <FileThumb it={r as FileItem} />}
                    </div>
                    
                    <div className="min-w-0 flex flex-col justify-center">
                      <p className="truncate font-medium text-content group-hover:text-accent transition-colors">{r.name}</p>
                      <p className="text-xs font-medium text-content-muted/80 truncate font-mono mt-0.5">{rootName} / {r.path}</p>
                    </div>
                    
                    <div className="text-right flex flex-col justify-center">
                      <p className="text-sm font-medium text-content-muted">{r.is_dir ? "—" : formatBytes(r.size)}</p>
                      <p className="text-xs font-medium text-content-muted/70 mt-0.5 hidden sm:block">{formatDate(r.modified)}</p>
                    </div>
                  </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
