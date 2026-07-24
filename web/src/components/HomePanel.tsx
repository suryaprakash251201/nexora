import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Search, Clock, Sparkles, FileText, Music, Film, Plus, FilePlus, Upload, HardDrive, FolderPlus, Play, Sun, Moon, Star, FolderOpen, Share, TrendingUp } from "lucide-react";
import type { RecentItem, FileItem, HomeData } from "../api/types";
import { FileThumb } from "./FileThumb";
import { formatRelative } from "../lib/format";
import { Input } from "./ui/Input";
import { EmptyState } from "./ui/EmptyState";
import { staggerContainer, staggerItem, cardHover, slideUp } from "@/lib/animations";
import { cn } from "@/lib/utils";
import { formatBytes } from "../lib/format";
import { get } from "../api/client";
import { useQuery } from "@tanstack/react-query";

function extOf(name: string): string {
  return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
}

function mediaKind(item: RecentItem): "music" | "video" | "doc" | "file" {
  const ext = extOf(item.name);
  const music = ["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "wma", "alac"];
  const video = ["mp4", "mkv", "webm", "mov", "avi", "m4v", "ogv", "wmv", "flv", "ts"];
  if (music.includes(ext)) return "music";
  if (video.includes(ext)) return "video";
  if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "csv", "rtf", "odt", "ods", "odp", "tex", "pages", "key", "numbers"].includes(ext)) return "doc";
  return "file";
}

function StatsBar() {
  const usage = useQuery({ queryKey: ["storage-usage"], queryFn: () => get<{ total: number; used: number; available: number }>("/admin/usage"), staleTime: 60000 });
  const home = useQuery({ queryKey: ["home"], queryFn: () => get<HomeData>("/home"), staleTime: 30000 });
  
  const stats = [
    {
      label: "Storage Used",
      value: usage.data ? formatBytes(usage.data.used) : "—",
      sub: usage.data ? `of ${formatBytes(usage.data.total)}` : "",
      icon: HardDrive,
      color: "from-blue-500 to-indigo-500",
      glow: "shadow-blue-500/20",
    },
    {
      label: "Total Files",
      value: home.data ? `${(home.data.recent?.length ?? 0)}+` : "—",
      sub: "files tracked",
      icon: FolderOpen,
      color: "from-emerald-500 to-teal-500",
      glow: "shadow-emerald-500/20",
    },
    {
      label: "Recent Activity",
      value: home.data?.recent?.length?.toString() ?? "0",
      sub: "recent items",
      icon: TrendingUp,
      color: "from-purple-500 to-violet-500",
      glow: "shadow-purple-500/20",
    },
    {
      label: "Shared Items",
      value: home.data?.playlists?.length?.toString() ?? "0",
      sub: "active shares",
      icon: Share,
      color: "from-amber-500 to-orange-500",
      glow: "shadow-amber-500/20",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
      {stats.map((s, i) => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.08, duration: 0.4 }}
          className="glass-subtle border border-glass-border rounded-2xl p-4 relative overflow-hidden group hover:border-accent/40 transition-all duration-300"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />
          <div className="flex items-center gap-3 mb-2">
            <div className={cn("p-2 rounded-xl bg-gradient-to-br shadow-lg", s.color, s.glow)}>
              <s.icon className="h-4 w-4 text-white" />
            </div>
            <span className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{s.label}</span>
          </div>
          <div className="text-2xl font-bold text-text-primary">{s.value}</div>
          <div className="text-[11px] text-text-tertiary mt-0.5">{s.sub}</div>
        </motion.div>
      ))}
    </div>
  );
}

function StorageBreakdown() {
  const home = useQuery({ queryKey: ["home"], queryFn: () => get<HomeData>("/home"), staleTime: 30000 });
  const usage = useQuery({ queryKey: ["storage-usage"], queryFn: () => get<{ total: number; used: number; available: number }>("/admin/usage"), staleTime: 60000 });

  if (!usage.data || usage.data.total === 0) return null;

  const usedPercent = Math.min(100, Math.round((usage.data.used / usage.data.total) * 100));
  const docsCount = home.data?.documents?.length ?? 0;
  const musicCount = home.data?.music?.length ?? 0;
  const videoCount = home.data?.video?.length ?? 0;
  const recentCount = home.data?.recent?.length ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
      className="glass-strong border border-glass-border rounded-2xl p-5 mb-8 min-w-0 overflow-hidden"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <HardDrive className="h-4 w-4 text-accent" />
          <h3 className="font-semibold text-sm truncate">Storage Distribution</h3>
        </div>
        <span className="max-w-full truncate text-xs font-mono text-content-muted">
          {formatBytes(usage.data.used)} / {formatBytes(usage.data.total)} ({usedPercent}%)
        </span>
      </div>

      <div className="h-3 w-full bg-surface-muted rounded-full overflow-hidden flex gap-0.5 p-0.5 border border-glass-border-soft">
        <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-l-full transition-all duration-500" style={{ width: `${Math.max(5, usedPercent * 0.4)}%` }} title="Documents" />
        <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-500" style={{ width: `${Math.max(5, usedPercent * 0.3)}%` }} title="Music" />
        <div className="h-full bg-gradient-to-r from-purple-500 to-violet-500 transition-all duration-500" style={{ width: `${Math.max(5, usedPercent * 0.2)}%` }} title="Video" />
        <div className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-r-full flex-1 transition-all duration-500" title="Free Space" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
          <span className="text-content-muted">Documents ({docsCount})</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          <span className="text-content-muted">Music ({musicCount})</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-purple-500" />
          <span className="text-content-muted">Video ({videoCount})</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
          <span className="text-content-muted">Other Files ({recentCount})</span>
        </div>
      </div>
    </motion.div>
  );
}

function HomeCard({ item, onOpen }: { item: RecentItem; onOpen: () => void }) {
  const fi: FileItem = {
    name: item.name,
    path: item.path,
    size: 0,
    is_dir: false,
    modified: "",
    mime: "",
    root_id: item.root_id,
    extension: extOf(item.name),
  };
  const kind = mediaKind(item);
  return (
    <motion.button
      variants={staggerItem}
      {...cardHover}
      onClick={onOpen}
      className="group w-full min-w-0 text-left outline-none flex items-center gap-4 p-3 rounded-2xl glass-strong border border-glass-border hover:border-accent/40 focus-visible:ring-2 focus-visible:ring-accent transition-all duration-300 overflow-hidden relative"
    >
      {/* Inner card glow */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] via-transparent to-transparent pointer-events-none rounded-2xl" />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/8 to-transparent" />
      <div className="relative h-16 w-16 shrink-0 rounded-xl overflow-hidden shadow-sm">
        <FileThumb it={fi} fill />
        <div className="absolute inset-0 bg-black/10 group-hover:bg-black/20 transition-colors duration-300" />
        {kind === "music" && (
          <span className="absolute bottom-1 right-1 grid place-items-center h-6 w-6 rounded-full bg-surface/90 backdrop-blur-md shadow-sm border border-border/50 text-content group-hover:text-accent transition-colors">
            <Music className="h-3 w-3" />
          </span>
        )}
        {kind === "video" && (
          <span className="absolute bottom-1 right-1 grid place-items-center h-6 w-6 rounded-full bg-surface/90 backdrop-blur-md shadow-sm border border-border/50 text-content group-hover:text-accent transition-colors">
            <Film className="h-3 w-3" />
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="truncate text-[15px] font-semibold text-content group-hover:text-accent transition-colors">{item.name}</p>
        <div className="flex min-w-0 items-center gap-2 mt-1">
          <p className="min-w-0 truncate text-xs font-medium text-content-muted">{item.root_name}</p>
          <span className="h-1 w-1 shrink-0 rounded-full bg-border/80" />
          <p className="min-w-0 truncate text-xs font-medium text-content-muted/70 uppercase tracking-wider">{formatRelative(item.accessed_at)}</p>
        </div>
      </div>
    </motion.button>
  );
}

function Section({ title, icon, items, onOpen, action, color = "accent" }: {
  title: string;
  icon: React.ReactNode;
  items: RecentItem[];
  onOpen: (item: RecentItem) => void;
  action?: React.ReactNode;
  color?: string;
}) {
  if (!items.length) return null;
  return (
    <motion.section variants={staggerContainer} initial="initial" animate="animate">
      <motion.div variants={slideUp} className="flex items-center gap-3 mb-4 px-1">
        <div className="p-1.5 rounded-lg" style={{ backgroundColor: `${color}18`, color }}>
          {icon}
        </div>
        <h2 className="font-bold text-lg">{title}</h2>
        <span className="px-2 py-0.5 rounded-full bg-surface-muted text-xs font-bold text-content-muted">{items.length}</span>
        {action && <span className="ml-auto">{action}</span>}
      </motion.div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
        {items.map((it) => (
          <HomeCard key={it.root_id + it.path} item={it} onOpen={() => onOpen(it)} />
        ))}
      </div>
    </motion.section>
  );
}

function AddTile({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <motion.button
      variants={staggerItem}
      {...cardHover}
      onClick={onClick}
      className="group w-full text-left outline-none"
    >
      <div className="flex min-w-0 items-center gap-4 p-4 rounded-2xl glass-strong border border-glass-border hover:border-accent/40 focus-visible:ring-2 focus-visible:ring-accent transition-all duration-300 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-accent/0 to-accent/5 group-hover:opacity-100 opacity-0 transition-opacity" />
        <div className="relative z-10 grid place-items-center h-12 w-12 rounded-xl bg-accent/10 text-accent transition-transform duration-300 group-hover:scale-110">
          {icon}
        </div>
        <p className="relative z-10 min-w-0 truncate text-[15px] font-semibold text-content group-hover:text-accent transition-colors">{label}</p>
      </div>
    </motion.button>
  );
}

export default function HomePanel({
  data, isLoading, isAdmin, onSearch, onOpenRecent, onUpload, onNewFolder, onNewFile, onNewRoot, onOpenPlaylist,
}: {
  data?: HomeData;
  isLoading: boolean;
  isAdmin: boolean;
  onSearch: (q: string) => void;
  onOpenRecent: (item: RecentItem) => void;
  onUpload: () => void;
  onNewFolder: () => void;
  onNewFile: () => void;
  onNewRoot: () => void;
  onOpenPlaylist: () => void;
}) {
  const [q, setQ] = useState("");
  const [greeting, setGreeting] = useState("Good day");
  const [greetingIcon, setGreetingIcon] = useState<React.ReactNode>(<Star className="h-8 w-8" />);

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 5) { setGreeting("Late night"); setGreetingIcon(<Moon className="h-8 w-8" />); }
    else if (hour < 12) { setGreeting("Good morning"); setGreetingIcon(<Sun className="h-8 w-8" />); }
    else if (hour < 18) { setGreeting("Good afternoon"); setGreetingIcon(<Sun className="h-8 w-8" />); }
    else if (hour < 22) { setGreeting("Good evening"); setGreetingIcon(<Moon className="h-8 w-8" />); }
    else { setGreeting("Late night"); setGreetingIcon(<Moon className="h-8 w-8" />); }
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = q.trim();
    if (t) onSearch(t);
  };

  const recent = data?.recent ?? [];
  const added = data?.added ?? [];
  const documents = data?.documents ?? [];
  const music = data?.music ?? [];
  const video = data?.video ?? [];
  const playlists = data?.playlists ?? [];
  const hasContent =
    recent.length > 0 || added.length > 0 || documents.length > 0 || music.length > 0 || video.length > 0 || playlists.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="flex-1 overflow-auto custom-scrollbar bg-background"
    >
      {/* Hero Banner */}
      <div className="relative overflow-hidden border-b border-glass-border bg-surface/20">
        <div className="absolute inset-0 bg-gradient-to-r from-accent/10 via-transparent to-transparent opacity-50" />
        <div className="max-w-6xl mx-auto px-6 py-10 md:py-14 relative z-10">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}>
            <div className="flex items-center gap-4 mb-2">
              <div className="p-3 rounded-2xl bg-accent/10 text-accent">
                {greetingIcon}
              </div>
              <div>
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-text-primary via-accent to-accent-secondary">
                  {greeting}
                </h1>
                <p className="text-content-muted text-base md:text-lg max-w-2xl">
                  Pick up where you left off or discover new files.
                </p>
              </div>
            </div>
          </motion.div>

          <motion.form
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
            onSubmit={submit}
            className="relative mt-8 max-w-2xl group"
          >
            <Input
              variant="search"
              icon={<Search className="h-5 w-5" />}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search your files, folders, and documents…"
              className="h-14 text-lg bg-surface/60 shadow-lg shadow-black/10 border-glass-border focus:border-accent/50 focus:ring-accent/20"
            />
          </motion.form>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-10 space-y-12 pb-20">
        {isLoading && (
          <div className="space-y-8 animate-pulse">
            <div>
              <div className="skeleton h-6 w-48 rounded-lg mb-4" />
              <div className="flex gap-4 overflow-hidden">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="w-36 sm:w-44 shrink-0">
                    <div className="skeleton aspect-square rounded-2xl mb-3" />
                    <div className="skeleton h-4 w-3/4 rounded mb-1" />
                    <div className="skeleton h-3 w-1/2 rounded" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {!isLoading && !hasContent && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-10">
            <EmptyState
              title="Nothing here yet"
              description="Files you view, play, or add will automatically show up on your home dashboard."
              icon={<Sparkles className="h-10 w-10 text-accent opacity-80" />}
            />
          </motion.div>
        )}

        {!isLoading && hasContent && (
          <motion.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
            className="space-y-12"
          >
            <StatsBar />
            <StorageBreakdown />
            {playlists.length > 0 && (
              <motion.section variants={staggerItem}>
                <div className="flex items-center gap-3 mb-6 px-1">
                  <div className="p-1.5 rounded-lg" style={{ backgroundColor: "#F472B618", color: "#F472B6" }}>
                    <Music className="h-5 w-5" />
                  </div>
                  <h2 className="font-bold text-lg">Public Playlists</h2>
                </div>
                <div className="flex overflow-x-auto gap-4 pb-4 custom-scrollbar snap-x">
                  {playlists.map((pl) => (
                    <motion.button
                      key={pl.id}
                      whileHover={{ scale: 1.02, y: -4 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                      onClick={onOpenPlaylist}
                      className="snap-start group relative w-40 sm:w-48 text-left outline-none shrink-0"
                    >
                      <div className="aspect-square rounded-2xl overflow-hidden mb-3 shadow-lg shadow-black/10 border border-glass-border group-hover:border-accent/40 group-focus-visible:ring-2 group-focus-visible:ring-accent transition-all duration-300 relative bg-surface-muted/30">
                        {pl.cover_root_id && pl.cover_path ? (
                          <img
                            src={`/api/v1/files/thumbnail?root=${pl.cover_root_id}&path=${encodeURIComponent(pl.cover_path)}`}
                            alt={pl.name}
                            className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                        ) : (
                          <div className="h-full w-full grid place-items-center bg-gradient-to-br from-accent/40 via-purple-500/30 to-pink-500/20 group-hover:scale-105 transition-transform duration-500">
                            <Music className="h-8 w-8 text-white/80" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/10 group-hover:bg-black/30 transition-colors duration-300" />
                        <div className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 scale-90 group-hover:scale-100">
                          <div className="h-12 w-12 rounded-full bg-accent/90 text-white grid place-items-center shadow-lg backdrop-blur-md">
                            <Play className="h-6 w-6 ml-1" />
                          </div>
                        </div>
                      </div>
                      <p className="font-semibold text-[15px] truncate group-hover:text-accent transition-colors">{pl.name}</p>
                      <p className="text-xs text-content-muted mt-0.5">{pl.items?.length || 0} tracks</p>
                    </motion.button>
                  ))}
                </div>
              </motion.section>
            )}

            <motion.section variants={staggerItem}>
              <div className="flex items-center gap-3 mb-6 px-1">
                <div className="p-1.5 rounded-lg" style={{ backgroundColor: "#5B8CFF18", color: "#5B8CFF" }}>
                  <Plus className="h-5 w-5" />
                </div>
                <h2 className="font-bold text-lg">Quick Actions</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <AddTile icon={<Upload className="h-6 w-6" />} label="Upload Files" onClick={onUpload} />
                <AddTile icon={<FolderPlus className="h-6 w-6" />} label="New Folder" onClick={onNewFolder} />
                <AddTile icon={<FilePlus className="h-6 w-6" />} label="New Text File" onClick={onNewFile} />
                {isAdmin && (
                  <AddTile icon={<HardDrive className="h-6 w-6" />} label="New Storage Root" onClick={onNewRoot} />
                )}
              </div>
            </motion.section>

            {recent.length > 0 && (
              <Section title="Recently Opened" icon={<Clock className="h-5 w-5" />} items={recent} onOpen={onOpenRecent} color="#A78BFA" />
            )}
            {documents.length > 0 && (
              <Section title="Recent Documents" icon={<FileText className="h-5 w-5" />} items={documents} onOpen={onOpenRecent} color="#FBBF24" />
            )}
            {music.length > 0 && (
              <Section title="Recent Music" icon={<Music className="h-5 w-5" />} items={music} onOpen={onOpenRecent} color="#F472B6" />
            )}
            {video.length > 0 && (
              <Section title="Recent Videos" icon={<Film className="h-5 w-5" />} items={video} onOpen={onOpenRecent} color="#2DD4BF" />
            )}
            {added.length > 0 && (
              <Section title="Newly Added" icon={<Sparkles className="h-5 w-5" />} items={added} onOpen={onOpenRecent} color="#34D399" />
            )}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
