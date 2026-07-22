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
  Trash2,
  X,
  Filter,
  Command,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Breadcrumbs from "./Breadcrumbs";
import ProfileMenu from "./ProfileMenu";
import type { User } from "../api/types";
import { useUI } from "../store";
import { Button } from "./ui/Button";
import { useClickOutside } from "./hooks/useClickOutside";
import { cn } from "@/lib/utils";

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
  onCommandPalette?: () => void;
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
  onCommandPalette,
}: CommandBarProps) {
  const viewMode = useUI((s) => s.viewMode);
  const setViewMode = useUI((s) => s.setViewMode);
  const [menuOpen, setMenuOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const [filterPos, setFilterPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const [sortPos, setSortPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const newBtnRef = useRef<HTMLButtonElement>(null);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const sortBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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
    <div className="relative z-30 mx-3 mt-3 mb-0 sm:mx-4 sm:mt-4">
      <div className="glass rounded-2xl flex items-center gap-2 sm:gap-3 px-3 sm:px-5 h-14 sm:h-16">
        {/* Left: Breadcrumbs */}
        <div className="min-w-0 flex-1 flex items-center gap-3">
          <Breadcrumbs rootName={rootName} path={path} onNavigate={onNavigate} />

          {/* Spotlight Search */}
          <motion.div
            className="relative flex-1 sm:flex-none sm:w-80 sm:max-w-sm max-sm:max-w-[180px]"
            animate={searchFocused ? { scale: 1.02 } : { scale: 1 }}
            transition={{ duration: 0.2 }}
          >
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder="Search files…"
                className={cn(
                  "w-full glass-input rounded-xl pl-9 pr-20 py-2 text-sm transition-all duration-200",
                  searchFocused && "ring-2 ring-accent/30 border-accent/50"
                )}
              />
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono text-text-tertiary bg-glass-bg rounded border border-glass-border-soft">
                  <Command className="h-2.5 w-2.5" />K
                </kbd>
              </div>
            </div>
            {/* Animated focus glow */}
            <AnimatePresence>
              {searchFocused && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="absolute -inset-0.5 rounded-xl bg-gradient-to-r from-accent/10 via-transparent to-accent-secondary/10 -z-10 blur-sm"
                />
              )}
            </AnimatePresence>
          </motion.div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5">
          {/* Filter */}
          <button
            ref={filterBtnRef}
            onClick={toggleFilter}
            className={`p-2 rounded-xl glass-hover transition-colors hidden sm:block min-w-[36px] min-h-[36px] ${filter !== "all" ? "text-accent-tertiary" : "text-text-secondary hover:text-foreground"}`}
            title="Filter"
            aria-label="Filter"
            aria-expanded={filterOpen}
          >
            <Filter className="h-4 w-4" />
          </button>

          {/* Sort */}
          <button
            ref={sortBtnRef}
            onClick={toggleSort}
            className="p-2 rounded-xl glass-hover text-text-secondary hover:text-accent-purple transition-colors hidden sm:block min-w-[36px] min-h-[36px]"
            title="Sort"
            aria-label="Sort"
            aria-expanded={sortOpen}
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${sortOpen ? "rotate-180" : ""}`} />
          </button>

          {/* Refresh */}
          <button
            onClick={onRefresh}
            className="p-2 rounded-xl glass-hover text-text-secondary hover:text-foreground transition-colors min-w-[36px] min-h-[36px]"
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>

          {/* View Mode Toggle */}
          <div className="flex rounded-xl overflow-hidden bg-glass-bg-subtle p-0.5 border border-glass-border-soft">
            <button
              onClick={() => setViewMode("list")}
              className={cn(
                "p-1.5 rounded-lg transition-all duration-200 min-w-[32px] min-h-[32px]",
                viewMode === "list"
                  ? "bg-glass-bg-strong text-foreground shadow-sm"
                  : "text-text-tertiary hover:text-foreground"
              )}
              title="List view"
              aria-label="List view"
              aria-pressed={viewMode === "list"}
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={cn(
                "p-1.5 rounded-lg transition-all duration-200 min-w-[32px] min-h-[32px]",
                viewMode === "grid"
                  ? "bg-glass-bg-strong text-foreground shadow-sm"
                  : "text-text-tertiary hover:text-foreground"
              )}
              title="Grid view"
              aria-label="Grid view"
              aria-pressed={viewMode === "grid"}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Separator + Actions */}
        <div className="flex items-center gap-1.5 border-l border-glass-border pl-3 ml-1">
          {canWrite && !inSelectionMode && (
            <>
              <Button
                ref={newBtnRef}
                variant="primary"
                onClick={toggleMenu}
                size="sm"
                className="hidden sm:inline-flex"
              >
                <FolderPlus className="h-4 w-4 mr-1" /> New
                <ChevronDown className="h-4 w-4 ml-1" />
              </Button>
              <Button
                variant="secondary"
                onClick={onUpload}
                size="sm"
                className="hidden sm:inline-flex"
                icon={<Upload className="h-4 w-4" />}
              >
                Upload
              </Button>
            </>
          )}

          {inSelectionMode && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-foreground mr-1">
                {selectionCount}
              </span>
              <div className="flex rounded-xl overflow-hidden bg-glass-bg-subtle p-0.5">
                <Button variant="ghost" size="xs" icon={<Download className="h-3.5 w-3.5" />} onClick={() => onSelectionAction("download")}>DL</Button>
                <Button variant="ghost" size="xs" icon={<Share2 className="h-3.5 w-3.5" />} onClick={() => onSelectionAction("share")}>Share</Button>
                <Button variant="ghost" size="xs" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => onSelectionAction("delete")} className="text-danger">Del</Button>
                <Button variant="ghost" size="xs" onClick={onExitSelection}><X className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          )}

          <div className="pl-1">
            <ProfileMenu user={user} isAdmin={isAdmin} onLogout={onLogout} onAdmin={onAdmin} />
          </div>
        </div>
      </div>

      {/* New Menu */}
      {menuOpen && createPortal(
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, scale: 0.95, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -4 }}
          transition={{ duration: 0.15 }}
          style={{ top: menuPos.top, right: menuPos.right }}
          className="fixed z-50 w-56 menu-surface rounded-xl p-1.5 shadow-2xl"
          role="menu"
        >
          <button
            onClick={() => { closeAllMenus(); onNewFolder(); }}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg hover:bg-accent/10 hover:text-accent font-medium transition-colors"
            role="menuitem"
          >
            <FolderPlus className="h-4 w-4 text-accent" /> New folder
          </button>
          <button
            onClick={() => { closeAllMenus(); onNewFile(); }}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg hover:bg-accent/10 hover:text-accent font-medium transition-colors"
            role="menuitem"
          >
            <FilePlus className="h-4 w-4 text-accent-secondary" /> New text file
          </button>
          <div className="h-px w-full bg-glass-border-soft my-1" />
          <button
            onClick={() => { closeAllMenus(); onUpload(); }}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg hover:bg-accent/10 hover:text-accent font-medium transition-colors"
            role="menuitem"
          >
            <Upload className="h-4 w-4 text-accent-tertiary" /> Upload files
          </button>
        </motion.div>,
        document.body,
      )}

      {filterOpen && createPortal(
        <motion.div
          ref={filterRef}
          initial={{ opacity: 0, scale: 0.95, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          style={{ top: filterPos.top, right: filterPos.right }}
          className="fixed z-50 w-48 menu-surface rounded-xl p-1.5 shadow-2xl"
          role="menu"
        >
          {filterOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setFilter(opt.value); closeAllMenus(); }}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors",
                filter === opt.value ? "text-accent-tertiary font-medium bg-accent-tertiary/10" : "hover:bg-glass-bg-subtle"
              )}
              role="menuitem"
            >
              {opt.label}
              {filter === opt.value && <ChevronDown className="h-4 w-4 ml-auto text-accent-tertiary" />}
            </button>
          ))}
        </motion.div>,
        document.body,
      )}

      {sortOpen && createPortal(
        <motion.div
          ref={sortRef}
          initial={{ opacity: 0, scale: 0.95, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          style={{ top: sortPos.top, right: sortPos.right }}
          className="fixed z-50 w-48 menu-surface rounded-xl p-1.5 shadow-2xl"
          role="menu"
        >
          {sortOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setSort(opt.value); closeAllMenus(); }}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors",
                sort === opt.value ? "text-accent-purple font-medium bg-accent-purple/10" : "hover:bg-glass-bg-subtle"
              )}
              role="menuitem"
            >
              {opt.label}
              {sort === opt.value && <ChevronDown className="h-4 w-4 ml-auto text-accent-purple" />}
            </button>
          ))}
        </motion.div>,
        document.body,
      )}
    </div>
  );
}
