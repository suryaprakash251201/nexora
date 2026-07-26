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
  onSelectionAction: (action: "move" | "copy" | "delete" | "download" | "share" | "archive" | "favorite" | "tag") => void;
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
  const [searchExpanded, setSearchExpanded] = useState(false);
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

  const clampMenuPos = (r: DOMRect) => {
    let top = r.bottom + 6;
    let right = window.innerWidth - r.right;
    const menuHeight = 280;
    if (top + menuHeight > window.innerHeight - 16) {
      top = Math.max(8, r.top - menuHeight - 6);
    }
    if (right < 8) right = 8;
    if (right + 224 > window.innerWidth - 8) right = window.innerWidth - 224 - 8;
    return { top, right };
  };

  const toggleMenu = () => {
    const r = newBtnRef.current?.getBoundingClientRect();
    if (r) setMenuPos(clampMenuPos(r));
    setMenuOpen((o) => !o);
    setFilterOpen(false);
    setSortOpen(false);
  };

  const toggleFilter = () => {
    const r = filterBtnRef.current?.getBoundingClientRect();
    if (r) setFilterPos(clampMenuPos(r));
    setFilterOpen((o) => !o);
    setMenuOpen(false);
    setSortOpen(false);
  };

  const toggleSort = () => {
    const r = sortBtnRef.current?.getBoundingClientRect();
    if (r) setSortPos(clampMenuPos(r));
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
      <div className="glass rounded-2xl flex items-center gap-1.5 sm:gap-3 px-2.5 sm:px-5 h-13 sm:h-16">
        {/* Left: Breadcrumbs + Search */}
        <div className="min-w-0 flex-1 flex items-center gap-2 sm:gap-3">
          <Breadcrumbs rootName={rootName} path={path} onNavigate={onNavigate} />

          {/* Search — icon-only when collapsed, expands on click */}
          <div className="relative">
            <AnimatePresence mode="wait">
              {!searchExpanded && !search ? (
                <motion.button
                  key="search-icon"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  onClick={() => { setSearchExpanded(true); setTimeout(() => searchRef.current?.focus(), 100); }}
                  className="p-2 rounded-xl glass-hover text-text-secondary hover:text-foreground transition-colors"
                  title="Search"
                  aria-label="Open search"
                >
                  <Search className="h-4 w-4" />
                </motion.button>
              ) : (
                <motion.div
                  key="search-input"
                  initial={{ width: 40, opacity: 0 }}
                  animate={{ width: "auto", opacity: 1 }}
                  exit={{ width: 40, opacity: 0 }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  className="relative sm:w-72"
                >
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary pointer-events-none" />
                  <input
                    ref={searchRef}
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={(e) => {
                      setSearchFocused(false);
                      if (!search && !e.relatedTarget?.closest?.('.search-close-btn')) {
                        setSearchExpanded(false);
                      }
                    }}
                    placeholder="Search files…"
                    className={cn(
                      "w-full glass-input rounded-xl pl-9 pr-8 py-2 text-sm transition-all duration-200",
                      searchFocused && "ring-2 ring-accent/30 border-accent/50"
                    )}
                  />
                  <button
                    className="search-close-btn absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-text-tertiary hover:text-foreground"
                    onClick={() => { setSearch(""); setSearchExpanded(false); }}
                    title="Close search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
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
                  <Button variant="ghost" size="xs" onClick={() => onSelectionAction("tag")}>Tags...</Button>
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
      </div>

      {/* Mobile filter & sort chips */}
      <div className="sm:hidden flex items-center gap-1.5 mt-2 overflow-x-auto pb-1 no-scrollbar">
        {filterOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={cn(
              "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 border",
              filter === opt.value
                ? "bg-accent/20 border-accent/30 text-accent"
                : "glass-chip border-glass-border-soft text-text-tertiary"
            )}
          >
            {opt.label}
          </button>
        ))}
        <span className="w-px h-5 bg-glass-border-soft shrink-0 mx-1" />
        {sortOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => {
              if (sort === opt.value) {
                setOrder(order === "asc" ? "desc" : "asc");
              } else {
                setSort(opt.value);
                setOrder("asc");
              }
            }}
            className={cn(
              "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 border",
              sort === opt.value
                ? "bg-accent-purple/20 border-accent-purple/30 text-accent-purple"
                : "glass-chip border-glass-border-soft text-text-tertiary"
            )}
          >
            {opt.label}
            {sort === opt.value && (
              <ChevronDown className={cn("inline h-3 w-3 ml-1 transition-transform", order === "desc" && "rotate-180")} />
            )}
          </button>
        ))}
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

      {/* Filter Menu */}
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

      {/* Sort Menu */}
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