import { useState, useEffect } from "react";
import { Search, Clock, Sparkles, FileText, Music, Film, Plus, FilePlus, Upload, HardDrive, FolderPlus, Play } from "lucide-react";
import type { RecentItem, FileItem, HomeData } from "../api/types";
import { FileThumb } from "./FileThumb";
import { formatRelative } from "../lib/format";
import { Input } from "./ui/Input";
import { EmptyState } from "./ui/EmptyState";

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
    <button 
      onClick={onOpen} 
      className="group w-full text-left outline-none flex items-center gap-4 p-3 rounded-2xl glass-strong border border-border/50 hover:border-accent/40 focus-visible:ring-2 focus-visible:ring-accent hover:shadow-lg hover:bg-surface/50 transition-all duration-300"
    >
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
        <div className="flex items-center gap-2 mt-1">
          <p className="truncate text-xs font-medium text-content-muted">{item.root_name}</p>
          <span className="h-1 w-1 rounded-full bg-border/80" />
          <p className="truncate text-xs font-medium text-content-muted/70 uppercase tracking-wider">{formatRelative(item.accessed_at)}</p>
        </div>
      </div>
    </button>
  );
}

function Section({
  title,
  icon,
  items,
  onOpen,
  action,
}: {
  title: string;
  icon: React.ReactNode;
  items: RecentItem[];
  onOpen: (item: RecentItem) => void;
  action?: React.ReactNode;
}) {
  if (!items.length) return null;
  return (
    <section className="animate-slide-up">
      <div className="flex items-center gap-3 mb-4 px-1">
        <div className="p-1.5 rounded-lg bg-accent/10 text-accent">
          {icon}
        </div>
        <h2 className="font-bold text-lg">{title}</h2>
        <span className="px-2 py-0.5 rounded-full bg-surface-muted text-xs font-bold text-content-muted">{items.length}</span>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
        {items.map((it) => (
          <HomeCard key={it.root_id + it.path} item={it} onOpen={() => onOpen(it)} />
        ))}
      </div>
    </section>
  );
}

function AddTile({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group w-full text-left outline-none">
      <div className="flex items-center gap-4 p-4 rounded-2xl glass-strong border border-border/50 hover:border-accent/40 focus-visible:ring-2 focus-visible:ring-accent hover:shadow-lg transition-all duration-300 group-hover:bg-surface-muted/30 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-accent/0 to-accent/5 group-hover:opacity-100 opacity-0 transition-opacity" />
        <div className="relative z-10 grid place-items-center h-12 w-12 rounded-xl bg-accent/10 text-accent transition-transform duration-300 group-hover:scale-110">
          {icon}
        </div>
        <p className="relative z-10 text-[15px] font-semibold text-content group-hover:text-accent transition-colors">{label}</p>
      </div>
    </button>
  );
}

export default function HomePanel({
  data,
  isLoading,
  isAdmin,
  onSearch,
  onOpenRecent,
  onUpload,
  onNewFolder,
  onNewFile,
  onNewRoot,
  onOpenPlaylist,
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
  
  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setGreeting("Good morning");
    else if (hour < 18) setGreeting("Good afternoon");
    else setGreeting("Good evening");
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
    <div className="flex-1 overflow-auto custom-scrollbar bg-background">
      {/* Hero Banner */}
      <div className="relative overflow-hidden border-b border-border/50 bg-surface/30">
        <div className="absolute inset-0 bg-gradient-to-r from-accent/10 via-transparent to-transparent opacity-50" />
        <div className="max-w-6xl mx-auto px-6 py-10 md:py-14 relative z-10 animate-fade-in">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-2">
            {greeting}
          </h1>
          <p className="text-content-muted text-base md:text-lg max-w-2xl">
            Pick up where you left off or discover new files.
          </p>

          <form onSubmit={submit} className="relative mt-8 max-w-2xl group animate-slide-up" style={{ animationDelay: '0.1s' }}>
            <Input
              variant="search"
              icon={<Search className="h-5 w-5" />}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search your files, folders, and documents…"
              className="h-14 text-lg bg-surface/80 backdrop-blur-md shadow-lg border-border/50 focus:border-accent/50 focus:ring-accent/20"
            />
          </form>
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
          <div className="py-10 animate-fade-in">
            <EmptyState
              title="Nothing here yet"
              description="Files you view, play, or add will automatically show up on your home dashboard."
              icon={<Sparkles className="h-10 w-10 text-accent opacity-80" />}
            />
          </div>
        )}

        {!isLoading && hasContent && (
          <div className="stagger-children space-y-12">
            {playlists.length > 0 && (
              <section className="animate-slide-up">
                <div className="flex items-center gap-3 mb-6 px-1">
                  <div className="p-1.5 rounded-lg bg-accent/10 text-accent">
                    <Music className="h-5 w-5" />
                  </div>
                  <h2 className="font-bold text-lg">Public Playlists</h2>
                </div>
                <div className="flex overflow-x-auto gap-4 pb-4 custom-scrollbar snap-x">
                  {playlists.map((pl) => (
                    <button
                      key={pl.id}
                      onClick={onOpenPlaylist}
                      className="snap-start group relative w-40 sm:w-48 text-left outline-none shrink-0"
                    >
                      <div className="aspect-square rounded-2xl overflow-hidden mb-3 shadow-md border border-border/50 group-hover:border-accent/40 group-focus-visible:ring-2 group-focus-visible:ring-accent transition-all duration-300 relative bg-surface-muted/30">
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
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className="animate-slide-up">
              <div className="flex items-center gap-3 mb-6 px-1">
                <div className="p-1.5 rounded-lg bg-accent/10 text-accent">
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
            </section>

            {recent.length > 0 && (
              <Section
                title="Recently Opened"
                icon={<Clock className="h-5 w-5" />}
                items={recent}
                onOpen={onOpenRecent}
              />
            )}

            {documents.length > 0 && (
              <Section
                title="Recent Documents"
                icon={<FileText className="h-5 w-5" />}
                items={documents}
                onOpen={onOpenRecent}
              />
            )}

            {music.length > 0 && (
              <Section
                title="Recent Music"
                icon={<Music className="h-5 w-5" />}
                items={music}
                onOpen={onOpenRecent}
              />
            )}

            {video.length > 0 && (
              <Section
                title="Recent Videos"
                icon={<Film className="h-5 w-5" />}
                items={video}
                onOpen={onOpenRecent}
              />
            )}

            {added.length > 0 && (
              <Section
                title="Newly Added"
                icon={<Sparkles className="h-5 w-5" />}
                items={added}
                onOpen={onOpenRecent}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
