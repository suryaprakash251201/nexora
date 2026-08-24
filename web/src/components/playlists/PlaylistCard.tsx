import { useState } from "react";
import { ListMusic, Play, Users, Globe, Lock, Music2 } from "lucide-react";
import type { Playlist as StorePlaylist } from "../../hooks/usePlaylists";
import { thumbUrl } from "../../lib/preview";

/** Playlist artwork with graceful fallback gradient when no cover is set. */
export function PlaylistArtwork({ playlist, className = "" }: { playlist: any; className?: string }) {
  const [failed, setFailed] = useState(false);
  const hasCover = playlist.cover_root_id && playlist.cover_path;
  if (hasCover && !failed) {
    const item = { root_id: playlist.cover_root_id, path: playlist.cover_path, name: "", extension: "", mime: "image/jpeg", is_dir: false, size: 0, modified: "" };
    return (
      <img
        src={thumbUrl(item)}
        alt=""
        loading="lazy"
        className={`h-full w-full object-cover ${className}`}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className={`h-full w-full grid place-items-center bg-gradient-to-br from-accent/40 via-purple-500/30 to-pink-500/20 ${className}`}>
      <ListMusic className="h-8 w-8 text-white/80" />
    </div>
  );
}

function Badges({ pl }: { pl: StorePlaylist }) {
  return (
    <>
      {!pl.is_owner && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-surface border border-border/50 text-[9px] font-bold uppercase tracking-wide text-content-muted">
          <Users className="h-2.5 w-2.5" /> Shared
        </span>
      )}
      {pl.is_public ? (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-accent/10 text-accent text-[9px] font-bold uppercase tracking-wide">
          <Globe className="h-2.5 w-2.5" /> Public
        </span>
      ) : (
        !pl.is_owner && null
      )}
      {!pl.is_public && pl.is_owner && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-surface-muted/60 text-[9px] font-bold uppercase tracking-wide text-content-muted/80">
          <Lock className="h-2.5 w-2.5" /> Private
        </span>
      )}
    </>
  );
}

export function trackCountLabel(n: number) {
  return `${n} track${n === 1 ? "" : "s"}`;
}

/**
 * Playlist card, two variants:
 *  - grid: large artwork-dominant card for the default view
 *  - list: compact horizontal row for users with many playlists
 */
export default function PlaylistCard({
  playlist: pl,
  variant = "grid",
  context = "library",
  onOpen,
  onPlay,
}: {
  playlist: StorePlaylist;
  variant?: "grid" | "list";
  /** "library" shows shared/private badges; "public" lists other users' public playlists where those badges mislead. */
  context?: "library" | "public";
  onOpen: () => void;
  onPlay?: () => void;
}) {
  const showBadges = context === "library";
  if (variant === "list") {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
        className="group flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors duration-150 hover:bg-accent/[0.06] focus-visible:ring-2 focus-visible:ring-accent outline-none"
      >
        <div className="h-11 w-11 shrink-0 rounded-lg overflow-hidden ring-1 ring-white/10 shadow-sm">
          <PlaylistArtwork playlist={pl} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate group-hover:text-accent transition-colors">{pl.name}</p>
          <p className="text-xs text-content-muted truncate">
            {trackCountLabel(pl.items.length)}
            {pl.description ? ` · ${pl.description}` : ""}
            {!pl.is_owner && pl.owner_username ? ` · by ${pl.owner_username}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {showBadges && <Badges pl={pl} />}
          {onPlay && (
            <button
              onClick={(e) => { e.stopPropagation(); onPlay(); }}
              disabled={!pl.items.length}
              aria-label={`Play ${pl.name}`}
              className="p-2 rounded-lg text-content-muted hover:text-accent hover:bg-accent/10 transition-colors disabled:opacity-30"
            >
              <Play className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
      className="group text-left outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-transparent rounded-xl"
      aria-label={`Open playlist ${pl.name}`}
    >
      <div className="relative aspect-square rounded-xl overflow-hidden mb-2.5 shadow-md ring-1 ring-white/10 transition-all duration-200 group-hover:ring-accent/40 group-hover:shadow-lg bg-surface-muted/30">
        <PlaylistArtwork playlist={pl} className="transition-transform duration-300 group-hover:scale-[1.04]" />
        {/* subtle bottom scrim so badges stay readable */}
        <div className="absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-black/25 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
        {onPlay && (
          <button
            onClick={(e) => { e.stopPropagation(); onPlay(); }}
            disabled={!pl.items.length}
            aria-label={`Play ${pl.name}`}
            className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-all duration-200 scale-90 group-hover:scale-100 disabled:cursor-default"
          >
            <span className="h-11 w-11 rounded-full bg-accent text-white grid place-items-center shadow-lg">
              <Play className="h-5 w-5 ml-0.5" />
            </span>
          </button>
        )}
        {!pl.is_owner && showBadges && (
          <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-black/50 backdrop-blur-sm text-[9px] font-bold uppercase tracking-wide text-white/90 flex items-center gap-1">
            <Users className="h-2.5 w-2.5" /> Shared
          </span>
        )}
        {pl.is_public && pl.is_owner && (
          <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-black/50 backdrop-blur-sm text-[9px] font-bold uppercase tracking-wide text-white/90 flex items-center gap-1">
            <Globe className="h-2.5 w-2.5" /> Public
          </span>
        )}
      </div>
      <p className="font-semibold text-sm truncate group-hover:text-accent transition-colors">{pl.name}</p>
      <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
        <Music2 className="h-3 w-3 text-content-muted/60 shrink-0" />
        <span className="text-xs text-content-muted truncate">{trackCountLabel(pl.items.length)}</span>
        {!pl.is_owner && pl.owner_username && (
          <span className="text-[10px] text-content-muted/60 truncate">· {pl.owner_username}</span>
        )}
      </div>
      {pl.description && (
        <p className="text-[11px] text-content-muted/70 truncate mt-0.5">{pl.description}</p>
      )}
    </div>
  );
}

/** Skeleton placeholder matching the grid card footprint. */
export function PlaylistCardSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="aspect-square rounded-xl skeleton mb-2.5" />
      <div className="skeleton h-4 w-3/4 rounded-md mb-1.5" />
      <div className="skeleton h-3 w-1/3 rounded-md" />
    </div>
  );
}
