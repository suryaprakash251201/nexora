import { forwardRef, useState, useEffect, useId, type ReactNode, type HTMLAttributes } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface AccordionProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  icon?: ReactNode;
  color?: "accent" | "blue" | "amber" | "emerald" | "violet" | "slate";
  defaultOpen?: boolean;
  children: ReactNode;
  action?: ReactNode;
  persistKey?: string; // localStorage key to remember open state
}

const COLOR_MAP = {
  accent: "bg-accent/10 border-accent/15 text-accent",
  blue: "bg-blue-500/10 border-blue-500/15 text-blue-500",
  amber: "bg-amber-500/10 border-amber-500/15 text-amber-500",
  emerald: "bg-emerald-500/10 border-emerald-500/15 text-emerald-500",
  violet: "bg-violet-500/10 border-violet-500/15 text-violet-400",
  slate: "bg-white/[0.05] border-white/[0.08] text-content-muted",
} as const;

export const Accordion = forwardRef<HTMLDivElement, AccordionProps>(
  ({ title, icon, color = "slate", defaultOpen = true, children, action, persistKey, className, ...props }, ref) => {
    const [isOpen, setIsOpen] = useState(() => {
      if (persistKey && typeof window !== "undefined") {
        const stored = localStorage.getItem(`accordion:${persistKey}`);
        if (stored !== null) return stored === "true";
      }
      return defaultOpen;
    });
    const panelId = useId();

    useEffect(() => {
      if (persistKey && typeof window !== "undefined") {
        localStorage.setItem(`accordion:${persistKey}`, String(isOpen));
      }
    }, [isOpen, persistKey]);

    return (
      <div ref={ref} className={cn("rounded-2xl border border-border/40 bg-surface/60 backdrop-blur-sm overflow-hidden shadow-sm", className)} {...props}>
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className="w-full flex items-center justify-between px-3.5 py-2.5 border-b border-border/30 bg-surface-muted/30 hover:bg-surface-muted/50 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-expanded={isOpen}
          aria-controls={panelId}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={cn("h-7 w-7 rounded-lg border grid place-items-center shrink-0", COLOR_MAP[color])}>
              {icon}
            </div>
            <span className="text-xs font-bold tracking-wide uppercase text-content truncate">{title}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Nested interactive content (e.g. "View all →") must not toggle
                the accordion when clicked — stop the event at the wrapper. */}
            <div onClick={(e) => e.stopPropagation()}>{action}</div>
            <motion.div
              animate={{ rotate: isOpen ? 180 : 0 }}
              transition={{ duration: 180, ease: [0.22, 1, 0.36, 1] }}
              className="text-content-muted"
            >
              <ChevronDown className="h-4 w-4 shrink-0" />
            </motion.div>
          </div>
        </button>
        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              id={panelId}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 180, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="p-3.5 pt-2.5">{children}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }
);
Accordion.displayName = "Accordion";

/** Lightweight meta row for key/value display inside accordions */
export function MetaRow({ icon, label, value, sub, action, mono = false, copyText }: {
  icon?: ReactNode;
  label: string;
  value: string;
  sub?: string;
  action?: ReactNode;
  mono?: boolean;
  copyText?: string;
}) {
  const [copied, setCopied] = useState(false);
  // Timer cleanup: a fast unmount (user closes the drawer mid-toast) would
  // otherwise fire setState on an unmounted component.
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  const doCopy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* clipboard blocked — non-fatal */ }
  };

  return (
    <div className="flex items-start gap-3 py-2">
      {icon && <div className="h-8 w-8 rounded-lg bg-white/[0.03] border border-white/[0.05] grid place-items-center shrink-0 mt-0.5">{icon}</div>}
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wider text-content-muted">{label}</p>
        <p className={cn("text-sm font-medium leading-tight truncate", mono && "font-mono text-xs")} title={value}>{value}</p>
        {sub && <p className="text-[11px] text-content-muted truncate mt-0.5 font-mono" title={sub}>{sub}</p>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {copyText && (
          <button
            onClick={() => doCopy(copyText)}
            className="h-7 w-7 rounded-lg bg-surface-muted border border-border/40 grid place-items-center text-content-muted hover:text-accent hover:border-accent/30 transition-colors"
            title={copied ? "Copied!" : "Copy to clipboard"}
            aria-label={copied ? "Copied!" : `Copy ${label.toLowerCase()}`}
          >
            {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          </button>
        )}
        {action}
      </div>
    </div>
  );
}

/** Divider for inside accordion content */
export function AccordionDivider() {
  return <div className="my-2 border-t border-border/30" />;
}