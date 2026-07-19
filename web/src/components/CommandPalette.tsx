import { useEffect, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { Search, Keyboard, Command, X, FolderOpen, File, Download, Upload, Share2, Star, Trash2, Pencil, Move, Copy, Archive, Settings, HelpCircle, Palette, RefreshCw, ChevronRight, Clock, Music, Archive as ArchiveIcon, FolderPlus, FilePlus, LayoutGrid, List, CheckSquare } from "lucide-react";
import type { FileItem, Root, User } from "../api/types";
import type { SidebarView } from "./Sidebar";

interface Command {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  shortcut?: string;
  category: "navigation" | "file" | "view" | "settings" | "help";
  action: () => void;
  keywords: string[];
  disabled?: boolean;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  isAdmin: boolean;
  view: string;
  setView: (v: SidebarView) => void;
  rootId: string | null;
  path: string;
  canWrite: boolean;
  selection: Set<string>;
  items: FileItem[];
  activeRoot: Root | null;
  onNewFolder: () => void;
  onNewFile: () => void;
  onUpload: () => void;
  onRefresh: () => void;
  onLogout: () => void;
  onAdmin: () => void;
  clearSelection: () => void;
  toggleSelectMode: () => void;
  selectMode: boolean;
  viewMode: "list" | "grid";
  setViewMode: (v: "list" | "grid") => void;
  sort: string;
  setSort: (s: string) => void;
  order: string;
  setOrder: (s: string) => void;
}

export default function CommandPalette({
  isOpen,
  onClose,
  user,
  isAdmin,
  view,
  setView,
  rootId,
  path,
  canWrite,
  selection,
  items,
  activeRoot,
  onNewFolder,
  onNewFile,
  onUpload,
  onRefresh,
  onLogout,
  onAdmin,
  clearSelection,
  toggleSelectMode,
  selectMode,
  viewMode,
  setViewMode,
  sort,
  setSort,
  order,
  setOrder,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build command list
  const commands = useMemo((): Command[] => {
    const cmds: Command[] = [
      // Navigation
      { id: "go-home", label: "Go to Home", description: "Navigate to home dashboard", icon: <Command className="h-4 w-4" />, shortcut: "G H", category: "navigation", action: () => { setView("home"); onClose(); }, keywords: ["home", "dashboard", "go"] },
      { id: "go-files", label: "Go to Files", description: "Open file browser", icon: <FolderOpen className="h-4 w-4" />, shortcut: "G F", category: "navigation", action: () => { setView("files"); onClose(); }, keywords: ["files", "browser", "go"] },
      { id: "go-trash", label: "Go to Trash", description: "View deleted items", icon: <Trash2 className="h-4 w-4" />, shortcut: "G T", category: "navigation", action: () => { setView("trash"); onClose(); }, keywords: ["trash", "deleted", "recycle"] },
      { id: "go-favorites", label: "Go to Favorites", description: "View starred items", icon: <Star className="h-4 w-4" />, shortcut: "G S", category: "navigation", action: () => { setView("favorites"); onClose(); }, keywords: ["favorites", "starred", "bookmarks"] },
      { id: "go-recents", label: "Go to Recent", description: "View recently accessed files", icon: <Clock className="h-4 w-4" />, shortcut: "G R", category: "navigation", action: () => { setView("recents"); onClose(); }, keywords: ["recent", "history"] },
      { id: "go-shares", label: "Go to Shared", description: "View shared files", icon: <Share2 className="h-4 w-4" />, shortcut: "G W", category: "navigation", action: () => { setView("shares"); onClose(); }, keywords: ["shared", "shares"] },
      { id: "go-playlists", label: "Go to Playlists", description: "Manage audio playlists", icon: <Music className="h-4 w-4" />, shortcut: "G P", category: "navigation", action: () => { setView("playlists"); onClose(); }, keywords: ["playlists", "music", "audio"] },
      { id: "go-search", label: "Search", description: "Open global search", icon: <Search className="h-4 w-4" />, shortcut: "G /", category: "navigation", action: () => { setView("search"); onClose(); }, keywords: ["search", "find"] },

      // File operations
      { id: "new-folder", label: "New Folder", description: "Create a new folder", icon: <FolderPlus className="h-4 w-4" />, shortcut: "⌘N", category: "file", action: () => { onNewFolder(); onClose(); }, keywords: ["new", "folder", "create", "mkdir"] },
      { id: "new-file", label: "New Text File", description: "Create a new text file", icon: <FilePlus className="h-4 w-4" />, shortcut: "⌘⇧N", category: "file", action: () => { onNewFile(); onClose(); }, keywords: ["new", "file", "create", "text"] },
      { id: "upload", label: "Upload Files", description: "Upload files to current location", icon: <Upload className="h-4 w-4" />, shortcut: "⌘U", category: "file", action: () => { onUpload(); onClose(); }, keywords: ["upload", "add", "import"] },
      { id: "refresh", label: "Refresh", description: "Reload current view", icon: <RefreshCw className="h-4 w-4" />, shortcut: "F5", category: "file", action: () => { onRefresh(); onClose(); }, keywords: ["refresh", "reload", "update"] },
      { id: "download", label: "Download", description: "Download selected items", icon: <Download className="h-4 w-4" />, shortcut: "⌘D", category: "file", action: () => { onClose(); }, keywords: ["download", "save", "export"], disabled: selection.size === 0 },
      { id: "share", label: "Share", description: "Create share link for selection", icon: <Share2 className="h-4 w-4" />, shortcut: "⌘⇧S", category: "file", action: () => { onClose(); }, keywords: ["share", "link", "public"], disabled: selection.size === 0 },
      { id: "favorite", label: "Toggle Favorite", description: "Star or unstar selected items", icon: <Star className="h-4 w-4" />, shortcut: "⌘⇧F", category: "file", action: () => { onClose(); }, keywords: ["favorite", "star", "bookmark"], disabled: selection.size === 0 },
      { id: "rename", label: "Rename", description: "Rename selected item", icon: <Pencil className="h-4 w-4" />, shortcut: "F2", category: "file", action: () => { onClose(); }, keywords: ["rename", "edit"], disabled: selection.size !== 1 },
      { id: "move", label: "Move to…", description: "Move selected items to another folder", icon: <Move className="h-4 w-4" />, shortcut: "⌘⇧M", category: "file", action: () => { onClose(); }, keywords: ["move", "relocate"], disabled: selection.size === 0 },
      { id: "copy", label: "Copy to…", description: "Copy selected items to another folder", icon: <Copy className="h-4 w-4" />, shortcut: "⌘⇧C", category: "file", action: () => { onClose(); }, keywords: ["copy", "duplicate"], disabled: selection.size === 0 },
      { id: "archive", label: "Create Archive", description: "Create ZIP archive of selection", icon: <Archive className="h-4 w-4" />, shortcut: "⌘⇧A", category: "file", action: () => { onClose(); }, keywords: ["archive", "zip", "compress"], disabled: selection.size === 0 },
      { id: "delete", label: "Delete", description: "Move selected items to trash", icon: <Trash2 className="h-4 w-4" />, shortcut: "Delete", category: "file", action: () => { onClose(); }, keywords: ["delete", "remove", "trash"], disabled: selection.size === 0 },

      // View
      { id: "toggle-view", label: "Toggle View", description: "Switch between list and grid view", icon: viewMode === "grid" ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />, shortcut: "⌘⇧V", category: "view", action: () => { setViewMode(viewMode === "grid" ? "list" : "grid"); onClose(); }, keywords: ["view", "list", "grid", "layout"] },
      { id: "toggle-select", label: "Selection Mode", description: "Enter or exit selection mode", icon: <CheckSquare className="h-4 w-4" />, shortcut: "⌘⇧X", category: "view", action: () => { toggleSelectMode(); onClose(); }, keywords: ["select", "selection", "multi-select"] },
      { id: "sort-name", label: "Sort by Name", description: "Sort files by name", icon: <File className="h-4 w-4" />, category: "view", action: () => { setSort("name"); onClose(); }, keywords: ["sort", "name", "alphabetical"] },
      { id: "sort-date", label: "Sort by Date", description: "Sort files by modified date", icon: <Clock className="h-4 w-4" />, category: "view", action: () => { setSort("modified"); onClose(); }, keywords: ["sort", "date", "modified"] },
      { id: "sort-size", label: "Sort by Size", description: "Sort files by size", icon: <ArchiveIcon className="h-4 w-4" />, category: "view", action: () => { setSort("size"); onClose(); }, keywords: ["sort", "size"] },
      { id: "sort-type", label: "Sort by Type", description: "Sort files by type", icon: <File className="h-4 w-4" />, category: "view", action: () => { setSort("type"); onClose(); }, keywords: ["sort", "type", "extension"] },
      { id: "toggle-order", label: "Toggle Sort Order", description: "Switch between ascending and descending", icon: <ChevronRight className="h-4 w-4" />, category: "view", action: () => { setOrder(order === "asc" ? "desc" : "asc"); onClose(); }, keywords: ["sort", "order", "ascending", "descending"] },

      // Settings
      { id: "theme", label: "Toggle Theme", description: "Switch between light and dark mode", icon: <Palette className="h-4 w-4" />, shortcut: "⌘⇧L", category: "settings", action: () => { onClose(); }, keywords: ["theme", "dark", "light", "mode"] },
      { id: "settings", label: "Settings", description: "Open settings panel", icon: <Settings className="h-4 w-4" />, shortcut: "⌘,", category: "settings", action: () => { setView("admin"); onClose(); }, keywords: ["settings", "preferences", "config"] },

      // Help
      { id: "shortcuts", label: "Keyboard Shortcuts", description: "Show all keyboard shortcuts", icon: <Keyboard className="h-4 w-4" />, shortcut: "⌘/", category: "help", action: () => { setShortcutsOpen(true); onClose(); }, keywords: ["shortcuts", "keys", "help", "?"] },
      { id: "help", label: "Help & Documentation", description: "Open help documentation", icon: <HelpCircle className="h-4 w-4" />, category: "help", action: () => { window.open("https://github.com/nexora/nexora", "_blank"); onClose(); }, keywords: ["help", "docs", "documentation", "support"] },
    ];

    return cmds;
  }, [
    view, setView, rootId, path, canWrite, selection, items, activeRoot,
    onNewFolder, onNewFile, onUpload, onRefresh, onLogout, onAdmin,
    clearSelection, toggleSelectMode, selectMode, viewMode, setViewMode,
    sort, setSort, order, setOrder
  ]);

  // Filter commands based on query
  const filteredCommands = useMemo(() => {
    if (!query) return commands;
    const q = query.toLowerCase();
    return commands.filter(cmd => 
      cmd.label.toLowerCase().includes(q) ||
      cmd.description.toLowerCase().includes(q) ||
      cmd.keywords.some(k => k.toLowerCase().includes(q)) ||
      (cmd.shortcut && cmd.shortcut.toLowerCase().includes(q))
    );
  }, [commands, query]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const input = inputRef.current;
    input?.focus();
    
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex(i => Math.min(i + 1, filteredCommands.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex(i => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filteredCommands[selectedIndex] && !filteredCommands[selectedIndex].disabled) {
            filteredCommands[selectedIndex].action();
          }
          break;
        case "Tab":
          e.preventDefault();
          setSelectedIndex(i => (i + 1) % filteredCommands.length);
          break;
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filteredCommands, selectedIndex, onClose]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!isOpen) return null;

  const groupedCommands = useMemo(() => {
    const groups: Record<string, Command[]> = {};
    filteredCommands.forEach(cmd => {
      if (!groups[cmd.category]) groups[cmd.category] = [];
      groups[cmd.category].push(cmd);
    });
    return groups;
  }, [filteredCommands]);

  const categoryLabels: Record<string, string> = {
    navigation: "Navigation",
    file: "File Operations",
    view: "View Options",
    settings: "Settings",
    help: "Help",
  };

  // Collect all unique shortcuts from commands
  const shortcutsList = commands.filter((c) => c.shortcut);

  return (
    <>
      {shortcutsOpen && createPortal(
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShortcutsOpen(false)} aria-hidden="true" />
          <div className="relative w-full max-w-lg glass-strong rounded-2xl shadow-2xl border border-glass-border-soft overflow-hidden animate-scale-in max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-glass-border-soft">
              <h2 className="font-bold text-lg flex items-center gap-2">
                <Keyboard className="h-5 w-5 text-accent" />
                Keyboard Shortcuts
              </h2>
              <button onClick={() => setShortcutsOpen(false)} className="p-1.5 rounded-lg glass-hover text-content-muted hover:text-content">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-1">
              {shortcutsList.map((cmd) => (
                <div key={cmd.id} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-surface/30">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{cmd.label}</p>
                    <p className="text-xs text-content-muted truncate">{cmd.description}</p>
                  </div>
                  <kbd className="shrink-0 ml-4 px-2.5 py-1 text-xs font-mono bg-surface/50 rounded-lg border border-border/30">
                    {cmd.shortcut}
                  </kbd>
                </div>
              ))}
            </div>
            <div className="p-3 border-t border-glass-border-soft flex justify-between text-xs text-content-muted">
              <span>Press <kbd className="px-1.5 py-0.5 bg-surface/50 rounded font-mono">Esc</kbd> to close</span>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {isOpen && createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-20">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-2xl glass-strong rounded-2xl shadow-2xl border border-glass-border-soft overflow-hidden animate-scale-in">
        <div className="p-4 border-b border-glass-border-soft">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-content-muted" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a command or search…"
              className="w-full glass-input px-10 py-3 text-base outline-none bg-transparent"
              autoFocus
              aria-label="Command palette"
            />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-1 text-[10px] font-mono text-content-muted bg-surface/50 rounded">
              ⌘K
            </kbd>
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
          {filteredCommands.length === 0 ? (
            <div className="p-8 text-center text-content-muted">
              <X className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No commands found</p>
              <p className="text-sm mt-1">Try a different search term</p>
            </div>
          ) : (
            <div className="py-2">
              {Object.entries(groupedCommands).map(([category, cmds]) => (
                <div key={category} className="px-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-content-muted py-2 px-2">
                    {categoryLabels[category] || category}
                  </p>
                  {cmds.map((cmd, idx) => (
                    <button
                      key={cmd.id}
                      onClick={() => { if (!cmd.disabled) cmd.action(); }}
                      disabled={cmd.disabled}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-xl transition-colors ${
                        selectedIndex === cmds.findIndex(c => c.id === cmd.id) && filteredCommands.indexOf(cmd) === cmds.indexOf(cmd)
                          ? "bg-surface/50 text-content"
                          : "text-content-muted hover:bg-surface/50 hover:text-content"
                      } ${cmd.disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                      role="menuitem"
                      aria-disabled={cmd.disabled}
                    >
                      <span className="w-5 h-5 flex items-center justify-center shrink-0">
                        {cmd.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{cmd.label}</p>
                        <p className="text-xs truncate opacity-70">{cmd.description}</p>
                      </div>
                      {cmd.shortcut && (
                        <kbd className="px-2 py-0.5 text-[10px] font-mono text-content-muted/60 bg-surface/50 rounded">
                          {cmd.shortcut}
                        </kbd>
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="p-3 border-t border-glass-border-soft bg-surface/30">
          <div className="flex items-center justify-between text-xs text-content-muted">
            <span>⌘K to open • ↑↓ to navigate • Enter to execute • Esc to close</span>
            <span className="font-mono">{filteredCommands.length} of {commands.length} commands</span>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )}
    </>
  );
}