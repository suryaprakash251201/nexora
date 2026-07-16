import { useState } from "react";
import { Search, Clock, Sparkles, FileText, Music, Film, Plus, FilePlus, Upload, HardDrive, FolderPlus } from "lucide-react";
import type { RecentItem, FileItem, HomeData } from "../api/types";
import { FileThumb } from "./FileThumb";
import { formatRelative } from "../lib/format";

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
  const ring = "ring-1 ring-white/10 group-hover:ring-accent/50 group-hover:-translate-y-0.5 transition";
  return (
    <button onClick={onOpen} className="group w-40 shrink-0 text-left">
      <div className={`relative aspect-square rounded-2xl glass-strong ${ring} mb-2 overflow-hidden`}>
        <FileThumb it={fi} fill />
        {kind === "music" && (
          <span className="absolute bottom-2 right-2 grid place-items-center h-8 w-8 rounded-full accent-glass">
            <Music className="h-4 w-4" />
          </span>
        )}
        {kind === "video" && (
          <span className="absolute bottom-2 right-2 grid place-items-center h-8 w-8 rounded-full accent-glass">
            <Film className="h-4 w-4" />
          </span>
        )}
      </div>
      <p className="truncate text-sm font-medium">{item.name}</p>
      <p className="truncate text-xs text-content-muted">{item.root_name}</p>
      <p className="truncate text-[11px] text-content-muted/70">{formatRelative(item.accessed_at)}</p>
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
    <section>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h2 className="font-semibold">{title}</h2>
        <span className="text-xs text-content-muted">{items.length}</span>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1">
        {items.map((it) => (
          <HomeCard key={it.root_id + it.path} item={it} onOpen={() => onOpen(it)} />
        ))}
      </div>
    </section>
  );
}

function AddTile({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group w-40 shrink-0 text-left">
      <div className="aspect-square rounded-2xl glass-strong ring-1 ring-white/10 group-hover:ring-accent/50 group-hover:-translate-y-0.5 transition grid place-items-center text-content-muted group-hover:text-accent">
        {icon}
      </div>
      <p className="mt-2 text-sm font-medium">{label}</p>
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
}) {
  const [q, setQ] = useState("");
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
  const hasContent =
    recent.length > 0 || added.length > 0 || documents.length > 0 || music.length > 0 || video.length > 0;

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Home</h1>
          <p className="text-content-muted text-sm">Pick up where you left off.</p>
        </div>

        <form onSubmit={submit} className="relative">
          <Search className="h-5 w-5 absolute left-4 top-1/2 -translate-y-1/2 text-content-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your files…"
            className="w-full pl-12 pr-4 py-3.5 rounded-2xl glass-strong ring-1 ring-white/10 outline-none focus:ring-accent/40 text-base"
          />
        </form>

        {isLoading && <p className="text-content-muted text-sm py-8">Loading…</p>}

        {!isLoading && !hasContent && (
          <div className="text-center text-content-muted py-16">
            <p>Nothing here yet.</p>
            <p className="text-xs mt-1">Files you view, play, or add will show up on your home.</p>
          </div>
        )}

        {!isLoading && hasContent && (
          <>
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Plus className="h-4 w-4 text-accent" />
                <h2 className="font-semibold">Add more</h2>
              </div>
              <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1">
                <AddTile icon={<Upload className="h-8 w-8" />} label="Upload files" onClick={onUpload} />
                <AddTile icon={<FolderPlus className="h-8 w-8" />} label="New folder" onClick={onNewFolder} />
                <AddTile icon={<FilePlus className="h-8 w-8" />} label="New text file" onClick={onNewFile} />
                {isAdmin && (
                  <AddTile icon={<HardDrive className="h-8 w-8" />} label="New storage root" onClick={onNewRoot} />
                )}
              </div>
            </section>

            {recent.length > 0 && (
              <Section
                title="Recently opened"
                icon={<Clock className="h-4 w-4 text-accent" />}
                items={recent}
                onOpen={onOpenRecent}
              />
            )}

            {documents.length > 0 && (
              <Section
                title="Recent documents"
                icon={<FileText className="h-4 w-4 text-accent" />}
                items={documents}
                onOpen={onOpenRecent}
              />
            )}

            {music.length > 0 && (
              <Section
                title="Recent music"
                icon={<Music className="h-4 w-4 text-accent" />}
                items={music}
                onOpen={onOpenRecent}
              />
            )}

            {video.length > 0 && (
              <Section
                title="Recent videos"
                icon={<Film className="h-4 w-4 text-accent" />}
                items={video}
                onOpen={onOpenRecent}
              />
            )}

            {added.length > 0 && (
              <Section
                title="Newly added"
                icon={<Sparkles className="h-4 w-4 text-accent" />}
                items={added}
                onOpen={onOpenRecent}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
