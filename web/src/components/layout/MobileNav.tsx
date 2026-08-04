import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Home, Search, Folder, Star, Clock, ListMusic,
  Shield, LogOut, X, Ellipsis, Upload, FolderUp, FolderPlus, Trash2
} from "lucide-react";
import type { SidebarView } from "../Sidebar";
import type { Root } from "../../api/types";
import { rootIcon } from "../../lib/rootIcons";
import { cn } from "@/lib/utils";

interface MobileNavProps {
  view: SidebarView;
  roots: Root[];
  activeRoot: string | null;
  canWrite: boolean;
  isAdmin: boolean;
  onSelectView: (v: SidebarView) => void;
  onSelectRoot: (id: string) => void;
  onSearch: () => void;
  onUpload: () => void;
  onUploadFolder?: () => void;
  onNewFolder: () => void;
  onLogout: () => void;
}

const primaryTabs: { id: SidebarView; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "files", label: "Files", icon: Folder },
  { id: "search", label: "Search", icon: Search },
  { id: "favorites", label: "Stars", icon: Star },
];

export function MobileNav({
  view, roots, activeRoot, canWrite, isAdmin,
  onSelectView, onSelectRoot, onSearch, onUpload, onUploadFolder, onNewFolder, onLogout,
}: MobileNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const isFilesView = view === "files";

  return (
    <>
      {/* Bottom Navigation Bar */}
      <div className="md:hidden fixed bottom-4 left-0 right-0 z-40 pb-safe flex justify-center px-4 pointer-events-none">
        <nav className="glass-strong border border-white/[0.1] backdrop-blur-2xl rounded-full shadow-2xl pointer-events-auto w-full max-w-[380px]">
          <div className="flex items-center justify-around px-2 py-1">
            {primaryTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = tab.id === "search" ? view === "search" : tab.id === "files" ? view === "files" : view === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    if (tab.id === "search") onSearch();
                    else if (tab.id === "files" && activeRoot) onSelectRoot(activeRoot);
                    else onSelectView(tab.id);
                  }}
                  className={cn(
                    "relative flex flex-col items-center justify-center gap-0.5 min-w-[50px] h-12 rounded-full transition-all duration-200",
                    isActive ? "text-accent" : "text-text-tertiary"
                  )}
                  aria-label={tab.label}
                >
                  {isActive && (
                    <motion.div
                      layoutId="mobile-nav-indicator"
                      className="absolute -top-1 left-1/2 -translate-x-1/2 w-8 h-[3px] rounded-full bg-accent"
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />
                  )}
                  <motion.div
                    animate={{ scale: isActive ? 1.15 : 1, y: isActive ? -2 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Icon className="h-[20px] w-[20px]" strokeWidth={isActive ? 2.5 : 2} />
                  </motion.div>
                  <span className={cn(
                    "text-[10px] font-semibold transition-all duration-200",
                    isActive ? "opacity-100" : "opacity-70"
                  )}>
                    {tab.label}
                  </span>
                </button>
              );
            })}

            {/* Upload FAB (only in files view with write access) */}
            {isFilesView && canWrite && (
              <button
                onClick={onUpload}
                className="relative flex flex-col items-center justify-center gap-0.5 min-w-[50px] h-12 rounded-full transition-all duration-200 text-text-tertiary active:scale-95"
                aria-label="Upload"
              >
                <div className="h-[38px] w-[38px] rounded-full bg-accent text-white grid place-items-center shadow-lg shadow-accent/30 -mt-3">
                  <Upload className="h-[18px] w-[18px]" />
                </div>
                <span className="text-[9px] font-semibold opacity-70">Upload</span>
              </button>
            )}

            {/* More menu button */}
            <button
              onClick={() => setMoreOpen(true)}
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5 min-w-[50px] h-12 rounded-full transition-all duration-200",
                moreOpen ? "text-accent" : "text-text-tertiary"
              )}
              aria-label="More"
            >
              <div className="h-[38px] w-[38px] rounded-full grid place-items-center">
                <Ellipsis className="h-[20px] w-[20px]" />
              </div>
              <span className="text-[10px] font-semibold opacity-70">More</span>
            </button>
          </div>
        </nav>
      </div>

      {/* More Panel (slide-up) */}
      <AnimatePresence>
        {moreOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
              onClick={() => setMoreOpen(false)}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="md:hidden fixed bottom-0 left-0 right-0 z-50 glass-strong rounded-t-3xl border-t border-white/[0.06] max-h-[70vh] overflow-y-auto pb-safe"
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-white/20" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3">
                <h3 className="font-bold text-lg">Menu</h3>
                <button onClick={() => setMoreOpen(false)} className="p-2 rounded-xl hover:bg-white/5 transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Storage Roots */}
              {roots.length > 0 && (
                <div className="px-4 mb-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary px-2 mb-2">Storage</p>
                  <div className="grid grid-cols-2 gap-2">
                    {roots.map((r) => {
                      const Icon = rootIcon(r.icon);
                      const isActive = view === "files" && activeRoot === r.id;
                      return (
                        <button
                          key={r.id}
                          onClick={() => { onSelectRoot(r.id); setMoreOpen(false); }}
                          className={cn(
                            "flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all duration-200 border min-h-[52px]",
                            isActive
                              ? "bg-accent/10 border-accent/30 text-accent"
                              : "border-white/[0.04] hover:border-white/[0.08] hover:bg-white/[0.02]"
                          )}
                        >
                          <Icon className="h-5 w-5 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate">{r.name}</p>
                            {r.read_only && <p className="text-[10px] text-text-tertiary">Read-only</p>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Quick Actions */}
              {isFilesView && canWrite && (
                <div className="px-4 mb-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary px-2 mb-2">Quick Actions</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => { onUpload(); setMoreOpen(false); }}
                      className="flex items-center gap-3 px-3 py-3 rounded-xl border border-white/[0.04] hover:border-white/[0.08] hover:bg-white/[0.02] transition-all min-h-[52px]"
                    >
                      <Upload className="h-5 w-5 text-accent shrink-0" />
                      <span className="text-sm font-semibold">Upload Files</span>
                    </button>
                    {onUploadFolder && (
                      <button
                        onClick={() => { onUploadFolder(); setMoreOpen(false); }}
                        className="flex items-center gap-3 px-3 py-3 rounded-xl border border-white/[0.04] hover:border-white/[0.08] hover:bg-white/[0.02] transition-all min-h-[52px]"
                      >
                        <FolderUp className="h-5 w-5 text-purple-400 shrink-0" />
                        <span className="text-sm font-semibold">Upload Folder</span>
                      </button>
                    )}
                    <button
                      onClick={() => { onNewFolder(); setMoreOpen(false); }}
                      className="flex items-center gap-3 px-3 py-3 rounded-xl border border-white/[0.04] hover:border-white/[0.08] hover:bg-white/[0.02] transition-all min-h-[52px]"
                    >
                      <FolderPlus className="h-5 w-5 text-accent-secondary shrink-0" />
                      <span className="text-sm font-semibold">New Folder</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Navigation Links */}
              <div className="px-4 mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary px-2 mb-2">Navigate</p>
                <div className="space-y-1">
                  {[
                    { id: "recents" as SidebarView, label: "Recent", icon: Clock },
                    { id: "playlists" as SidebarView, label: "Playlists", icon: ListMusic },
                    { id: "trash" as SidebarView, label: "Trash", icon: Trash2 },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={() => { onSelectView(item.id); setMoreOpen(false); }}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium hover:bg-white/[0.03] transition-all min-h-[48px]"
                      >
                        <Icon className="h-5 w-5 text-text-tertiary" />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Admin + Logout */}
              <div className="px-4 mb-6 space-y-1">
                {isAdmin && (
                  <button
                    onClick={() => { onSelectView("admin"); setMoreOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium hover:bg-white/[0.03] transition-all min-h-[48px]"
                  >
                    <Shield className="h-5 w-5 text-amber-400" />
                    <span>Administration</span>
                  </button>
                )}
                <button
                  onClick={() => { onLogout(); setMoreOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-rose-400/80 hover:bg-rose-500/10 transition-all min-h-[48px]"
                >
                  <LogOut className="h-5 w-5" />
                  <span>Log out</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
