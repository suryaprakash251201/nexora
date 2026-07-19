import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Search,
  ChevronDown,
  RefreshCw,
  List,
  LayoutGrid,
  FolderPlus,
  FilePlus,
  Upload,
  Download,
  Share2,
  Star,
  Trash2,
  Move,
  Copy,
  Archive,
  X,
  Filter,
} from "lucide-react";
import Breadcrumbs from "./Breadcrumbs";
import ProfileMenu from "./ProfileMenu";
import type { User } from "../api/types";
import { useUI } from "../store";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { useClickOutside } from "./hooks/useClickOutside";

interface CommandBarProps {
  rootName: string;
  path: string;
  onNavigate: (p: string) => void;
  search: string;
  setSearch: (s: string) => void;
  filter: string;
  setFilter: (f: string) => void;
  sort: string;
  setSort: (s: string) => void;
  order: string;
  setOrder: (s: string) => void;
  canWrite: boolean;
  selectionCount: number;
  onNewFolder: () => void;
  onNewFile: () => void;
  onUpload: () => void;
  onRefresh: () => void;
  onSelectionAction: (action: "move" | "copy" | "delete" | "download" | "share" | "archive" | "favorite") => void;
  onExitSelection: () => void;
  user: User;
  isAdmin: boolean;
  onLogout: () => void;
  onAdmin: () => void;
}

export default function CommandBar({
  rootName,
  path,
  onNavigate,
  search,
  setSearch,
  filter,
  setFilter,
  sort,
  setSort,
  order,
  setOrder,
  canWrite,
  selectionCount,
  onNewFolder,
  onNewFile,
  onUpload,
  onRefresh,
  onSelectionAction,
  onExitSelection,
  user,
  isAdmin,
  onLogout,
  onAdmin,
}: CommandBarProps) {
  const viewMode = useUI((s) => s.viewMode);
  const setViewMode = useUI((s) => s.setViewMode);
  const [menuOpen, setMenuOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const [filterPos, setFilterPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const [sortPos, setSortPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const newBtnRef = useRef<HTMLButtonElement>(null);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const sortBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  const toggleMenu = () => {
    const r = newBtnRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    setMenuOpen((o) => !o);
    setFilterOpen(false);
    setSortOpen(false);
  };

  const toggleFilter = () => {
    const r = filterBtnRef.current?.getBoundingClientRect();
    if (r) setFilterPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    setFilterOpen((o) => !o);
    setMenuOpen(false);
    setSortOpen(false);
  };

  const toggleSort = () => {
    const r = sortBtnRef.current?.getBoundingClientRect();
    if (r) setSortPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    setSortOpen((o) => !o);
    setMenuOpen(false);
    setFilterOpen(false);
  };

  const closeAllMenus = () => {
    setMenuOpen(false);
    setFilterOpen(false);
    setSortOpen(false);
  };

  useClickOutside(
    [menuRef, newBtnRef, filterRef, filterBtnRef, sortRef, sortBtnRef],
    closeAllMenus,
    menuOpen || filterOpen || sortOpen,
  );

  const inSelectionMode = selectionCount > 0;

  const sortOptions = [
    { value: "name", label: "Name" },
    { value: "modified", label: "Modified" },
    { value: "size", label: "Size" },
    { value: "type", label: "Type" },
  ];

  const filterOptions = [
    { value: "all", label: "All files" },
    { value: "documents", label: "Documents" },
    { value: "images", label: "Images" },
    { value: "videos", label: "Videos" },
    { value: "audio", label: "Audio" },
    { value: "archives", label: "Archives" },
    { value: "folders", label: "Folders" },
  ];

  return (
    <div className="h-14 sm:h-[72px] glass-bar flex items-center gap-2 sm:gap-3 px-3 sm:px-6 z-30">
      <div className="min-w-0 flex-1 flex items-center gap-3">
        <Breadcrumbs rootName={rootName} path={path} onNavigate={onNavigate} />

        <div className="relative flex-1 sm:flex-none sm:w-72 sm:max-w-xs animate-fade-in max-sm:max-w-[160px]">
          <Input
            variant="search"
            icon={<Search className="h-4 w-4" />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full"
          />
        </div>
      </div>

      <div className="hidden md:flex items-center gap-1.5">
        <button
          ref={filterBtnRef}
          onClick={toggleFilter}
          className={`p-2 rounded-xl glass-input glass-hover transition-colors ${filterOpen ? "bg-surface text-content" : "text-content-muted hover:text-content"}`}
          title="Filter (Alt+F)"
          aria-label="Filter"
          aria-expanded={filterOpen}
        >
          <Filter className="h-4 w-4" />
        </button>

        <button
          ref={sortBtnRef}
          onClick={toggleSort}
          className={`p-2 rounded-xl glass-input glass-hover transition-colors ${sortOpen ? "bg-surface text-content" : "text-content-muted hover:text-content"}`}
          title="Sort (Alt+S)"
          aria-label="Sort"
          aria-expanded={sortOpen}
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${sortOpen ? "rotate-180" : ""}`} />
        </button>

        <button
          onClick={onRefresh}
          className="p-2 rounded-xl glass-hover text-content-muted hover:text-content transition-colors"
          title="Refresh (F5)"
        >
          <RefreshCw className="h-4 w-4" />
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

      <div className="flex items-center gap-1.5 border-l border-border/50 pl-3 ml-1">
        {canWrite && (
          <>
            <Button
              ref={newBtnRef}
              variant="primary"
              onClick={toggleMenu}
              className="hidden sm:inline-flex"
            >
              <FolderPlus className="h-4 w-4 mr-1" /> New
              <ChevronDown className="h-4 w-4 ml-1" />
            </Button>
            <Button
              variant="secondary"
              onClick={onUpload}
              className="hidden sm:inline-flex"
              icon={<Upload className="h-4 w-4" />}
            >
              Upload
            </Button>
          </>
        )}

        <div className="flex items-center gap-1.5 border-l border-border/50 pl-3 ml-1">
          {inSelectionMode ? (
            <>
              <span className="text-sm font-medium text-content">
                {selectionCount} item{selectionCount !== 1 ? "s" : ""} selected
              </span>
              <div className="flex rounded-xl overflow-hidden glass-input p-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Download className="h-4 w-4" />}
                  onClick={() => onSelectionAction("download")}
                >
                  Download
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Share2 className="h-4 w-4" />}
                  onClick={() => onSelectionAction("share")}
                >
                  Share
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Archive className="h-4 w-4" />}
                  onClick={() => onSelectionAction("archive")}
                >
                  Archive
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Move className="h-4 w-4" />}
                  onClick={() => onSelectionAction("move")}
                >
                  Move
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Copy className="h-4 w-4" />}
                  onClick={() => onSelectionAction("copy")}
                >
                  Copy
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Star className="h-4 w-4" />}
                  onClick={() => onSelectionAction("favorite")}
                >
                  Favorite
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => onSelectionAction("delete")}
                  icon={<Trash2 className="h-4 w-4" />}
                >
                  Delete
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onExitSelection}
                  icon={<X className="h-4 w-4" />}
                >
                  Clear
                </Button>
              </div>
            </>
          ) : (
            <>
              <button
                onClick={onRefresh}
                className="p-2 rounded-xl glass-hover text-content-muted hover:text-content transition-colors"
                title="Refresh (F5)"
              >
                <RefreshCw className="h-4 w-4" />
              </button>

              <button
                onClick={() => setViewMode(viewMode === "list" ? "grid" : "list")}
                className={`p-2 rounded-xl transition-colors ${
                  viewMode === "grid" ? "bg-surface shadow-sm text-content" : "glass-hover text-content-muted hover:text-content"
                }`}
                title={viewMode === "grid" ? "List view" : "Grid view"}
              >
                {viewMode === "grid" ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
              </button>
            </>
          )}
        </div>

        <div className="pl-2">
          <ProfileMenu user={user} isAdmin={isAdmin} onLogout={onLogout} onAdmin={onAdmin} />
        </div>
      </div>

      {menuOpen && createPortal(
        <div
          ref={menuRef}
          style={{ top: menuPos.top, right: menuPos.right }}
          className="fixed z-50 w-56 glass-strong rounded-xl p-1.5 shadow-2xl animate-scale-in"
          role="menu"
        >
          <button
            onClick={() => { closeAllMenus(); onNewFolder(); }}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg glass-hover font-medium"
            role="menuitem"
          >
            <FolderPlus className="h-4 w-4 text-accent" /> New folder
          </button>
          <button
            onClick={() => { closeAllMenus(); onNewFile(); }}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg glass-hover font-medium"
            role="menuitem"
          >
            <FilePlus className="h-4 w-4 text-purple-400" /> New text file
          </button>
          <div className="h-px w-full glass-divider my-1" />
          <button
            onClick={() => { closeAllMenus(); onUpload(); }}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg glass-hover font-medium"
            role="menuitem"
          >
            <Upload className="h-4 w-4 text-blue-400" /> Upload files
          </button>
        </div>,
        document.body,
      )}

      {filterOpen && createPortal(
        <div
          ref={filterRef}
          style={{ top: filterPos.top, right: filterPos.right }}
          className="fixed z-50 w-48 glass-strong rounded-xl p-1.5 shadow-2xl animate-scale-in"
          role="menu"
        >
          {filterOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setFilter(opt.value); closeAllMenus(); }}
              className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg glass-hover ${filter === opt.value ? "text-accent font-medium" : ""}`}
              role="menuitem"
            >
              {opt.label}
              {filter === opt.value && <ChevronDown className="h-4 w-4 ml-auto text-accent" />}
            </button>
          ))}
        </div>,
        document.body,
      )}

      {sortOpen && createPortal(
        <div
          ref={sortRef}
          style={{ top: sortPos.top, right: sortPos.right }}
          className="fixed z-50 w-48 glass-strong rounded-xl p-1.5 shadow-2xl animate-scale-in"
          role="menu"
        >
          {sortOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setSort(opt.value); closeAllMenus(); }}
              className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg glass-hover ${sort === opt.value ? "text-accent font-medium" : ""}`}
              role="menuitem"
            >
              {opt.label}
              {sort === opt.value && <ChevronDown className="h-4 w-4 ml-auto text-accent" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}