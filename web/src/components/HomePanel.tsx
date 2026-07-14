import { useState } from "react";
import { Search, Clock, Sparkles } from "lucide-react";
import type { RecentItem, FileItem } from "../api/types";
import { FileThumb } from "./FileThumb";
import { formatRelative } from "../lib/format";

function extOf(name: string): string {
  return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
}

function HomeCard({ item, onClick }: { item: RecentItem; onClick: () => void }) {
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
  return (
    <button onClick={onClick} className="group w-40 shrink-0 text-left">
      <div className="aspect-square rounded-2xl glass-strong ring-1 ring-white/10 mb-2 group-hover:ring-accent/50 group-hover:-translate-y-0.5 transition overflow-hidden">
        <FileThumb it={fi} fill />
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
}: {
  title: string;
  icon: React.ReactNode;
  items: RecentItem[];
  onOpen: (item: RecentItem) => void;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h2 className="font-semibold">{title}</h2>
        <span className="text-xs text-content-muted">{items.length}</span>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1">
        {items.map((it) => (
          <HomeCard key={it.root_id + it.path} item={it} onClick={() => onOpen(it)} />
        ))}
      </div>
    </section>
  );
}

export default function HomePanel({
  recent,
  added,
  isLoading,
  onSearch,
  onOpen,
}: {
  recent?: RecentItem[];
  added?: RecentItem[];
  isLoading: boolean;
  onSearch: (q: string) => void;
  onOpen: (item: RecentItem) => void;
}) {
  const [q, setQ] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = q.trim();
    if (t) onSearch(t);
  };
  const hasContent = (recent && recent.length > 0) || (added && added.length > 0);

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

        {recent && recent.length > 0 && (
          <Section
            title="Recently played & viewed"
            icon={<Clock className="h-4 w-4 text-accent" />}
            items={recent}
            onOpen={onOpen}
          />
        )}

        {added && added.length > 0 && (
          <Section
            title="Newly added"
            icon={<Sparkles className="h-4 w-4 text-accent" />}
            items={added}
            onOpen={onOpen}
          />
        )}
      </div>
    </div>
  );
}
