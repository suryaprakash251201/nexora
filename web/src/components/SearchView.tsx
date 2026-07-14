import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon } from "lucide-react";
import { get } from "../api/client";
import { formatBytes, formatDate } from "../lib/format";
import type { Root, SearchResult, FileItem } from "../api/types";
import { FileThumb, FolderTile } from "./FileThumb";

export default function SearchView({
  initialQuery,
  roots,
  onOpen,
}: {
  initialQuery: string;
  roots: Root[];
  onOpen: (r: SearchResult) => void;
}) {
  const [q, setQ] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery);
  const [root, setRoot] = useState("");
  const [kind, setKind] = useState("");
  const [ext, setExt] = useState("");
  const [sort, setSort] = useState("relevance");

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
    <div className="flex-1 overflow-auto">
      <div className="p-4 glass-bar space-y-3 sticky top-0 z-10">
        <div className="relative">
          <SearchIcon className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search all authorized files…"
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface-muted border outline-none focus:ring-2 focus:ring-accent/40"
          />
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <select value={root} onChange={(e) => setRoot(e.target.value)} className="rounded-lg bg-surface border px-2 py-1.5 outline-none">
            <option value="">All roots</option>
            {roots.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-lg bg-surface border px-2 py-1.5 outline-none">
            <option value="">Any type</option>
            <option value="image">Images</option>
            <option value="video">Videos</option>
            <option value="audio">Audio</option>
            <option value="document">Documents</option>
            <option value="archive">Archives</option>
          </select>
          <input value={ext} onChange={(e) => setExt(e.target.value)} placeholder="ext (e.g. pdf)" className="w-28 rounded-lg bg-surface border px-2 py-1.5 outline-none" />
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-lg bg-surface border px-2 py-1.5 outline-none">
            <option value="relevance">Relevance</option>
            <option value="newest">Newest</option>
            <option value="largest">Largest</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>

      <div className="p-2">
        {isFetching && <p className="p-4 text-content-muted text-sm">Searching…</p>}
        {!isFetching && results.length === 0 && (
          <div className="p-10 text-center text-content-muted">
            <p>{debounced ? "No results found." : "Type to search across your storage roots."}</p>
            <p className="text-xs mt-1">Search uses a background metadata index. New files appear after a scan.</p>
          </div>
        )}
        {results.map((r) => {
          const rootName = roots.find((x) => x.id === r.root_id)?.name || "";
          return (
            <button
              key={r.root_id + r.path}
              onClick={() => onOpen(r)}
              className="w-full grid grid-cols-[auto_1fr_auto] gap-3 items-center px-3 py-2 rounded-lg glass-hover text-left"
            >
              {r.is_dir ? <FolderTile /> : <FileThumb it={r as FileItem} />}
              <div className="min-w-0">
                <p className="truncate font-medium">{r.name}</p>
                <p className="text-xs text-content-muted truncate">{rootName} / {r.path}</p>
              </div>
              <div className="text-right text-xs text-content-muted">
                <p>{r.is_dir ? "" : formatBytes(r.size)}</p>
                <p>{formatDate(r.modified)}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
