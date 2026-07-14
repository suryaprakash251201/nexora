import { useState } from "react";
import { Search, LayoutGrid, List, FolderPlus, FilePlus, Upload, ChevronDown, RefreshCw } from "lucide-react";
import Breadcrumbs from "./Breadcrumbs";
import { useUI } from "../store";

export default function TopBar({
  rootName,
  path,
  onNavigate,
  search,
  setSearch,
  sort,
  setSort,
  order,
  setOrder,
  canWrite,
  onNewFolder,
  onNewFile,
  onUpload,
  onRefresh,
}: {
  rootName: string;
  path: string;
  onNavigate: (p: string) => void;
  search: string;
  setSearch: (s: string) => void;
  sort: string;
  setSort: (s: string) => void;
  order: string;
  setOrder: (s: string) => void;
  canWrite: boolean;
  onNewFolder: () => void;
  onNewFile: () => void;
  onUpload: () => void;
  onRefresh: () => void;
}) {
  const viewMode = useUI((s) => s.viewMode);
  const setViewMode = useUI((s) => s.setViewMode);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="h-14 glass-bar flex items-center gap-3 px-4">
      <div className="min-w-0 flex-1">
        <Breadcrumbs rootName={rootName} path={path} onNavigate={onNavigate} />
      </div>

      <div className="relative hidden sm:block">
        <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-content-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search files…  ( / )"
          className="w-56 pl-8 pr-3 py-1.5 text-sm rounded-lg bg-surface border outline-none focus:ring-2 focus:ring-accent/40"
        />
      </div>

      <select
        value={sort}
        onChange={(e) => setSort(e.target.value)}
        className="hidden md:block text-sm rounded-lg bg-surface border px-2 py-1.5 outline-none"
        title="Sort by"
      >
        <option value="name">Name</option>
        <option value="modified">Modified</option>
        <option value="size">Size</option>
        <option value="type">Type</option>
      </select>
      <button
        onClick={() => setOrder(order === "asc" ? "desc" : "asc")}
        className="hidden md:block px-2 py-1.5 text-sm rounded-lg bg-surface border glass-hover"
        title="Toggle order"
      >
        {order === "asc" ? "↑" : "↓"}
      </button>

      <button onClick={onRefresh} className="p-2 rounded-lg glass-hover" title="Refresh">
        <RefreshCw className="h-4 w-4" />
      </button>

      <div className="flex rounded-lg overflow-hidden border">
        <button
          onClick={() => setViewMode("list")}
          className={`p-2 glass-hover ${viewMode === "list" ? "bg-accent/15 text-accent" : ""}`}
          title="List view"
        >
          <List className="h-4 w-4" />
        </button>
        <button
          onClick={() => setViewMode("grid")}
          className={`p-2 glass-hover ${viewMode === "grid" ? "bg-accent/15 text-accent" : ""}`}
          title="Grid view"
        >
          <LayoutGrid className="h-4 w-4" />
        </button>
      </div>

      {canWrite && (
        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-1 rounded-lg accent-glass px-3 py-1.5 text-sm font-medium"
          >
            New <ChevronDown className="h-4 w-4" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 mt-1 z-20 w-44 glass-strong rounded-lg py-1">
                <button onClick={() => { setMenuOpen(false); onNewFolder(); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm glass-hover">
                  <FolderPlus className="h-4 w-4" /> New folder
                </button>
                <button onClick={() => { setMenuOpen(false); onNewFile(); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm glass-hover">
                  <FilePlus className="h-4 w-4" /> New text file
                </button>
                <button onClick={() => { setMenuOpen(false); onUpload(); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm glass-hover">
                  <Upload className="h-4 w-4" /> Upload files
                </button>
              </div>
            </>
          )}
        </div>
      )}
      <input id="file-upload-input" type="file" multiple className="hidden" />
    </div>
  );
}
