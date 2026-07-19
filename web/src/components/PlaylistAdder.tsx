import { useRef, useState } from "react";
import { Plus, Music } from "lucide-react";
import { usePlaylists } from "../store/playlists";
import { useUI } from "../store";
import type { FileItem } from "../api/types";
import { thumbUrl } from "../lib/preview";
import { useClickOutside } from "./hooks/useClickOutside";

function audioOnly(items: FileItem[]): FileItem[] {
  return items.filter((i) => i.mime.startsWith("audio/"));
}

function MiniCover({ playlist }: { playlist: any }) {
  const [failed, setFailed] = useState(false);
  const hasCover = playlist.cover_root_id && playlist.cover_path;

  if (hasCover && !failed) {
    const item = { root_id: playlist.cover_root_id, path: playlist.cover_path, name: "", extension: "", mime: "image/jpeg", is_dir: false, size: 0, modified: "" };
    return (
      <img
        src={thumbUrl(item)}
        alt=""
        className="h-8 w-8 rounded-lg object-cover shrink-0"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="h-8 w-8 rounded-lg shrink-0 grid place-items-center bg-gradient-to-br from-accent/40 via-purple-500/30 to-pink-500/20">
      <Music className="h-4 w-4 text-white/80" />
    </div>
  );
}

export function PlaylistPickerList({ items, onClose }: { items: FileItem[]; onClose: () => void }) {
  const playlists = usePlaylists((s) => s.playlists);
  const create = usePlaylists((s) => s.create);
  const addItems = usePlaylists((s) => s.addItems);
  const pushToast = useUI((s) => s.pushToast);
  const audio = audioOnly(items);

  const add = async (id?: string) => {
    if (!audio.length) {
      pushToast("error", "No audio files selected");
      onClose();
      return;
    }
    if (id) {
      addItems(id, audio);
      const pl = playlists.find((p) => p.id === id);
      pushToast("success", `Added ${audio.length} to "${pl?.name ?? "playlist"}"`);
    } else {
      const name = window.prompt("New playlist name", `Playlist ${playlists.length + 1}`);
      if (name !== null) {
        const pl = await create(name.trim() || `Playlist ${playlists.length + 1}`, audio);
        pushToast("success", `Created "${pl.name}" with ${audio.length} track${audio.length === 1 ? "" : "s"}`);
      }
    }
    onClose();
  };

  if (!audio.length) {
    return <div className="px-3 py-3 text-xs text-content-muted">No audio files to add</div>;
  }

  return (
    <div className="py-1 text-sm max-h-80 overflow-auto">
      <p className="px-3 py-1 text-[11px] uppercase tracking-wide text-content-muted">
        Add {audio.length} track{audio.length === 1 ? "" : "s"} to…
      </p>
      {playlists.length === 0 && (
        <p className="px-3 py-2 text-xs text-content-muted">No playlists yet — create one below.</p>
      )}
      {playlists.map((pl) => (
        <button
          key={pl.id}
          onClick={() => add(pl.id)}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-left glass-hover"
        >
          <MiniCover playlist={pl} />
          <span className="truncate flex-1 text-left text-sm">{pl.name}</span>
          <span className="text-xs text-content-muted tabular-nums">{pl.items.length}</span>
        </button>
      ))}
      <button
        onClick={() => add(undefined)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left glass-hover border-t glass-divider mt-1"
      >
        <div className="h-8 w-8 rounded-lg grid place-items-center bg-accent/10 text-accent shrink-0">
          <Plus className="h-4 w-4" />
        </div>
        New playlist…
      </button>
    </div>
  );
}

export function AddToPlaylistMenu({
  items,
  className,
  children,
  align = "left",
}: {
  items: FileItem[];
  className?: string;
  children?: React.ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className={className} disabled={!audioOnly(items).length}>
        {children}
      </button>
      {open && (
        <div className={`absolute z-[80] mt-1 min-w-[240px] glass-strong rounded-lg ring-1 ring-white/10 shadow-xl ${align === "right" ? "right-0" : "left-0"}`}>
          <PlaylistPickerList items={items} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

export function PlaylistPickerPopover({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: FileItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onClose, true);
  const w = 240;
  const h = 340;
  let nx = x;
  let ny = y;
  if (x + w > window.innerWidth) nx = window.innerWidth - w - 8;
  if (y + h > window.innerHeight) ny = window.innerHeight - h - 8;
  return (
    <div
      className="fixed z-[80] min-w-[240px] glass-strong rounded-lg ring-1 ring-white/10 shadow-xl"
      style={{ left: nx, top: ny }}
      ref={ref}
    >
      <PlaylistPickerList items={items} onClose={onClose} />
    </div>
  );
}
