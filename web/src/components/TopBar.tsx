import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, LayoutGrid, List, FolderPlus, FilePlus, Upload, ChevronDown, RefreshCw, CheckSquare } from "lucide-react";
import Breadcrumbs from "./Breadcrumbs";
import ProfileMenu from "./ProfileMenu";
import type { User } from "../api/types";
import { useUI } from "../store";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

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
  user,
  isAdmin,
  onLogout,
  onAdmin,
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
  user: User;
  isAdmin: boolean;
  onLogout: () => void;
  onAdmin: () => void;
}) {
  const viewMode = useUI((s) => s.viewMode);
  const setViewMode = useUI((s) => s.setViewMode);
  const selectMode = useUI((s) => s.selectMode);
  const toggleSelectMode = useUI((s) => s.toggleSelectMode);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const newBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggleMenu = () => {
    const r = newBtnRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    setMenuOpen((o) => !o);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || newBtnRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    const onScroll = () => setMenuOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menuOpen]);

  return (
    <div className="h-[72px] glass-bar flex items-center gap-3 px-6 z-30">
      <div className="min-w-0 flex-1">
        <Breadcrumbs rootName={rootName} path={path} onNavigate={onNavigate} />
      </div>

      <div className="relative hidden lg:block w-64 animate-fade-in">
        <Input
          variant="search"
          icon={<Search className="h-4 w-4" />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search files… ( / )"
        />
      </div>

      <div className="hidden md:flex items-center gap-2">
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="text-sm rounded-xl glass-input px-3 py-2 outline-none appearance-none cursor-pointer hover:border-accent/40 transition-colors"
          title="Sort by"
        >
          <option value="name">Name</option>
          <option value="modified">Modified</option>
          <option value="size">Size</option>
          <option value="type">Type</option>
        </select>
        <button
          onClick={() => setOrder(order === "asc" ? "desc" : "asc")}
          className="px-3 py-2 text-sm rounded-xl glass-input glass-hover font-mono"
          title="Toggle order"
        >
          {order === "asc" ? "↑" : "↓"}
        </button>
      </div>

      <div className="flex items-center gap-1.5 border-l border-border/50 pl-3 ml-1">
        <button onClick={onRefresh} className="p-2 rounded-xl glass-hover text-content-muted hover:text-content transition-colors" title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </button>

        <button
          onClick={toggleSelectMode}
          className={`p-2 rounded-xl transition-colors ${selectMode ? "bg-accent text-accent-fg shadow-lg shadow-accent/20" : "glass-hover text-content-muted hover:text-content"}`}
          title={selectMode ? "Exit selection" : "Select items"}
        >
          <CheckSquare className="h-4 w-4" />
        </button>

        <div className="flex rounded-xl overflow-hidden glass-input p-0.5">
          <button
            onClick={() => setViewMode("list")}
            className={`p-1.5 rounded-lg transition-colors ${viewMode === "list" ? "bg-surface shadow-sm text-content" : "text-content-muted hover:text-content"}`}
            title="List view"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode("grid")}
            className={`p-1.5 rounded-lg transition-colors ${viewMode === "grid" ? "bg-surface shadow-sm text-content" : "text-content-muted hover:text-content"}`}
            title="Grid view"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
      </div>

      {canWrite && (
        <>
          <Button
            ref={newBtnRef}
            variant="primary"
            onClick={toggleMenu}
            className="hidden sm:inline-flex ml-2"
          >
            New <ChevronDown className="h-4 w-4" />
          </Button>
          {menuOpen &&
            createPortal(
              <div
                ref={menuRef}
                style={{ top: menuPos.top, right: menuPos.right }}
                className="fixed z-50 w-48 glass-strong rounded-xl p-1.5 shadow-2xl animate-scale-in"
              >
                <button onClick={() => { setMenuOpen(false); onNewFolder(); }} className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg glass-hover font-medium">
                  <FolderPlus className="h-4 w-4 text-accent" /> New folder
                </button>
                <button onClick={() => { setMenuOpen(false); onNewFile(); }} className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg glass-hover font-medium">
                  <FilePlus className="h-4 w-4 text-purple-400" /> New text file
                </button>
                <div className="h-px w-full glass-divider my-1" />
                <button onClick={() => { setMenuOpen(false); onUpload(); }} className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg glass-hover font-medium">
                  <Upload className="h-4 w-4 text-blue-400" /> Upload files
                </button>
              </div>,
              document.body,
            )}
        </>
      )}
      
      <div className="pl-2">
        <ProfileMenu user={user} isAdmin={isAdmin} onLogout={onLogout} onAdmin={onAdmin} />
      </div>
      
      <input id="file-upload-input" type="file" multiple className="hidden" />
    </div>
  );
}
