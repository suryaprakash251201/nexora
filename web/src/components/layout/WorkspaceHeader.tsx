import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * WorkspaceHeader — the blended workspace chrome that sits above every
 * non-files view. Designed to disappear into the page background:
 *
 * - `ws-header` ambient glow (CSS): soft blue/violet light emitted behind
 *   the surface, as if the workspace itself is generating the navigation.
 * - `ws-surface` translucent sheet (~56px, 16px radius, hairline border,
 *   backdrop blur). Strengthens subtly while content is scrolled.
 * - Tiny glowing dot marks the active location (replaces the old heavy
 *   vertical accent bar).
 * - Optional breadcrumbs for deep navigation (`Files › Music › …`).
 *
 * Pure CSS visuals — no animation loops, GPU-friendly transitions only,
 * and `prefers-reduced-motion` collapses them via the global rule.
 */
export function WorkspaceHeader({
  title,
  icon: Icon,
  breadcrumbs,
  actions,
  scrolled = false,
  className,
}: {
  title: ReactNode;
  icon?: LucideIcon;
  /** Deeper navigation trail; last item is the current location. */
  breadcrumbs?: { label: string; onClick?: () => void }[];
  /** Right-aligned cluster (user menu, view controls…). */
  actions?: ReactNode;
  /** True when page content is scrolled — strengthens the glass surface. */
  scrolled?: boolean;
  className?: string;
}) {
  return (
    <header className={cn("ws-header z-20 mx-3 mt-3 sm:mx-5 sm:mt-4", className)}>
      <div className="ws-surface" data-scrolled={scrolled || undefined}>
        <nav aria-label="Workspace location" className="flex min-w-0 items-center gap-2.5">
          <span className="ws-dot" aria-hidden="true" />
          {Icon && <Icon className="h-4 w-4 shrink-0 text-content-muted" aria-hidden="true" />}
          <h1 className="truncate text-[15px] font-semibold tracking-tight text-content">
            {title}
          </h1>
          {breadcrumbs && breadcrumbs.length > 0 && (
            <ol className="hidden min-w-0 items-center gap-1.5 sm:flex" aria-label="Breadcrumb">
              {breadcrumbs.map((b, i) => {
                const last = i === breadcrumbs.length - 1;
                return (
                  <li key={`${b.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-content-muted/50" aria-hidden="true" />
                    {b.onClick && !last ? (
                      <button
                        onClick={b.onClick}
                        className="max-w-[16ch] truncate rounded text-[13px] text-content-muted transition-colors duration-150 hover:text-content focus-visible:outline focus-visible:outline-accent"
                      >
                        {b.label}
                      </button>
                    ) : (
                      <span
                        aria-current={last ? "page" : undefined}
                        className={cn(
                          "truncate text-[13px]",
                          last ? "font-medium text-content/90" : "text-content-muted",
                        )}
                      >
                        {b.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </nav>
        <div className="ml-auto flex flex-shrink-0 items-center gap-1.5">{actions}</div>
      </div>
    </header>
  );
}
