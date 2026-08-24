import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * ViewHeader — unified top header for workspace views (Photos, Search,
 * Favourites, Recents, Shared, Playlists, Trash, Storage Analytics…).
 *
 * Design language (plain / modern):
 * - No card, no glass box — title sits directly on the page background.
 * - Bare accent icon at title size, bold tracking-tight title, muted
 *   subtitle underneath; actions right-aligned on the same line.
 * - When sticky, a soft background veil lets content scroll beneath
 *   without introducing a visible bar.
 * - `children` render as a second row (search fields, filter chips).
 */
export function ViewHeader({
  icon: Icon,
  title,
  subtitle,
  badge,
  actions,
  children,
  sticky = true,
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Small pill after the title (counts, status). */
  badge?: ReactNode;
  /** Right-aligned action cluster. */
  actions?: ReactNode;
  /** Optional second row — search fields, filter chips. */
  children?: ReactNode;
  sticky?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        sticky ? "sticky top-0 z-20 bg-background/85 backdrop-blur-md" : "relative",
        "px-3 pt-4 sm:px-6 sm:pt-5 pb-3",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0">
        <div className="flex min-w-0 items-center gap-2.5">
          {Icon && <Icon className="h-5 w-5 shrink-0 text-accent" aria-hidden />}
          <h1 className="truncate text-lg sm:text-xl font-bold tracking-tight text-content leading-tight">
            {title}
          </h1>
          {badge}
        </div>
        {subtitle && (
          <p className="hidden md:block truncate text-sm text-content-muted ml-1">
            {subtitle}
          </p>
        )}
        <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
          {actions}
        </div>
      </div>
      {/* Subtitle moves below the title line on small screens. */}
      {subtitle && (
        <p className="md:hidden mt-1 truncate text-sm text-content-muted">{subtitle}</p>
      )}
      {children != null && <div className="mt-3">{children}</div>}
    </div>
  );
}

/** Segmented-control pill used inside ViewHeader actions (density, view mode…). */
export function HeaderSegment<T extends string>({
  options,
  value,
  onChange,
  ariaPrefix,
}: {
  options: { value: T; label?: string; icon?: LucideIcon; labelHidden?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  ariaPrefix?: string;
}) {
  return (
    <div className="flex items-center rounded-lg border border-border/40 p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            aria-label={ariaPrefix ? `${ariaPrefix} ${o.label ?? o.value}` : o.label}
            title={o.label}
            className={cn(
              "rounded-md transition-colors",
              o.label && !o.labelHidden ? "px-2.5 py-1 text-xs" : "p-1.5",
              active ? "bg-accent/15 text-accent" : "text-content-muted hover:text-content",
            )}
          >
            {Icon ? <Icon className="h-4 w-4" /> : o.label}
          </button>
        );
      })}
    </div>
  );
}
