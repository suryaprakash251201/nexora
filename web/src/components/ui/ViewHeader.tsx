import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * ViewHeader — the unified rounded-glass top bar for workspace views
 * (Photos, Search, Favourites, Recents, Shared, Playlists, Trash,
 * Storage Analytics…).
 *
 * Design language:
 * - Floating `rounded-2xl glass` card on an accent-tinted icon chip,
 *   bold truncated title, muted subtitle/stats line.
 * - `actions` slot right-aligned for buttons/menus/selects.
 * - `children` render as a second row (search rows, filter chips).
 * - `sticky` floats it above scrolling content instead of a hard border-b.
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
    <div className={cn(sticky ? "sticky top-0 z-20" : "relative", "px-3 pt-3 sm:px-5 sm:pt-4 pb-2", className)}>
      <div className="rounded-2xl glass border border-border/50 backdrop-blur-xl px-3 py-2.5 sm:px-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0">
          {Icon && (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent ring-1 ring-accent/25">
              <Icon className="h-[18px] w-[18px]" aria-hidden />
            </span>
          )}
          <div className="min-w-0 flex items-center gap-2">
            <h1 className="truncate text-base sm:text-lg font-bold tracking-tight text-content leading-tight">
              {title}
            </h1>
            {badge}
          </div>
          {subtitle && (
            <p className="hidden sm:block truncate text-xs text-content-muted order-3 w-full sm:order-none sm:w-auto sm:flex-1 mt-0.5 sm:mt-0">
              {subtitle}
            </p>
          )}
          <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
            {actions}
          </div>
        </div>
        {children != null && <div className="mt-2.5">{children}</div>}
      </div>
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
