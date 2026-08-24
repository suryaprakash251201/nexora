import { useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Info,
  Maximize,
  Minimize,
  MoreHorizontal,
  Printer,
  RotateCw,
  Search,
  Share2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useViewer } from "./ctx";
import { formatBytes } from "../../lib/format";
import { padPage } from "./utils";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

/**
 * Floating translucent header — [back · identity] — [page counter] —
 * [search share download more]. Fades away in focus mode / on idle.
 */
export function FloatingHeader() {
  const viewer = useViewer();
  const [gotoOpen, setGotoOpen] = useState(false);
  const [gotoValue, setGotoValue] = useState("");

  const metaLine = [
    viewer.numPages > 0 ? `${viewer.numPages} ${viewer.numPages === 1 ? "page" : "pages"}` : null,
    "PDF",
    formatBytes(viewer.item.size),
  ]
    .filter(Boolean)
    .join(" • ");

  const submitGoto = () => {
    const n = parseInt(gotoValue, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= viewer.numPages) {
      viewer.goToPage(n);
      setGotoOpen(false);
    }
    setGotoValue("");
  };

  return (
    <header
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center px-3 pt-3 transition-all duration-300 sm:px-5 sm:pt-4",
        viewer.chromeVisible
          ? "translate-y-0 opacity-100"
          : "-translate-y-3 opacity-0 [&_*]:pointer-events-none"
      )}
    >
      <div className="doc-glass pointer-events-auto flex h-[52px] w-full max-w-4xl items-center gap-1 rounded-2xl pr-1.5 pl-1.5">
        {/* Identity */}
        <Tooltip>
          <TooltipTrigger
            render={<button type="button" onClick={viewer.closeViewer} aria-label="Back to files (Escape)" className="doc-btn shrink-0" />}
          >
            <ArrowLeft className="h-[18px] w-[18px]" />
          </TooltipTrigger>
          <TooltipContent side="bottom" container={viewer.shellEl}>Back to files</TooltipContent>
        </Tooltip>

        <div className="mx-1 flex min-w-0 flex-1 items-center gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-danger/10">
            <img src="/pdf.svg" alt="" className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm leading-tight font-medium" title={viewer.item.name}>
              {viewer.item.name}
            </p>
            <p className="truncate text-[11px] leading-tight text-[var(--doc-muted)]">{metaLine}</p>
          </div>
        </div>

        {/* Signature page counter */}
        <button
          onClick={() => setGotoOpen((v) => !v)}
          className="group hidden h-9 shrink-0 items-center gap-1.5 rounded-xl border border-transparent px-3 transition-colors hover:border-white/10 hover:bg-white/5 md:flex"
          aria-label={`Page ${viewer.page} of ${viewer.numPages}. Click to jump to a page.`}
        >
          <span className="text-[10px] font-semibold tracking-[0.14em] text-[var(--doc-faint)] uppercase">
            Page
          </span>
          <span className="font-mono text-[13px] tabular-nums text-[var(--doc-text)]">
            {padPage(viewer.page)}
            <span className="mx-1 text-[var(--doc-faint)]">—</span>
            <span className="text-[var(--doc-muted)]">{padPage(Math.max(viewer.numPages, 1))}</span>
          </span>
          <ChevronRight className="h-3 w-3 text-[var(--doc-faint)] transition-transform group-hover:translate-x-0.5" />
        </button>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-0.5">
          <HeaderBtn label="Search document (Ctrl+F)" onClick={() => viewer.openSearch()}>
            <Search className="h-[17px] w-[17px]" />
          </HeaderBtn>
          <HeaderBtn
            label="Share"
            onClick={() => viewer.toggleShare()}
            active={viewer.shareOpen}
            className="hidden sm:grid"
          >
            <Share2 className="h-[17px] w-[17px]" />
          </HeaderBtn>
          <HeaderBtn label="Download" onClick={() => viewer.download()} className="hidden sm:grid">
            <Download className="h-[17px] w-[17px]" />
          </HeaderBtn>
          <HeaderBtn label="Print (Ctrl+P)" onClick={() => viewer.print()} className="hidden sm:grid">
            <Printer className="h-[17px] w-[17px]" />
          </HeaderBtn>
          <DropdownMenu>
            <DropdownMenuTrigger className="doc-btn" aria-label="More actions">
              <MoreHorizontal className="h-[18px] w-[18px]" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} className="w-52" container={viewer.shellEl}>
              <MenuItem onClick={() => viewer.rotate(1)} icon={<RotateCw />} label="Rotate clockwise" />
              <MenuItem onClick={() => viewer.toggleInfo()} icon={<Info />} label="Document info" shortcut="I" />
              <MenuItem onClick={() => viewer.toggleFocus()} icon={<Maximize />} label="Focus mode" shortcut="F" />
              <MenuItem
                onClick={() => viewer.toggleFullscreen()}
                icon={viewer.isFullscreen ? <Minimize /> : <Maximize />}
                label={viewer.isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              />
              <DropdownMenuSeparator />
              <MenuItem onClick={() => viewer.print()} icon={<Printer />} label="Print…" shortcut="Ctrl P" />
              <DropdownMenuSeparator />
              <MenuItem onClick={() => viewer.closeViewer()} icon={<ArrowLeft />} label="Close viewer" shortcut="Esc" />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Go-to-page popover under the counter */}
      <AnimatePresence>
        {gotoOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="doc-glass pointer-events-auto absolute top-[64px] w-56 rounded-xl p-2"
            style={{ x: "-50%", left: "50%" }}
          >
            <label className="mb-1 block px-1 text-[10px] font-semibold tracking-wider text-[var(--doc-faint)] uppercase">
              Go to page
            </label>
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={gotoValue}
                inputMode="numeric"
                placeholder={`1–${viewer.numPages}`}
                onChange={(e) => setGotoValue(e.target.value.replace(/[^0-9]/g, ""))}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") submitGoto();
                  if (e.key === "Escape") setGotoOpen(false);
                }}
                className="glass-input h-8 min-w-0 flex-1 rounded-lg px-2.5 font-mono text-sm"
              />
              <div className="flex items-center">
                <button
                  onClick={() => viewer.goToPage(viewer.page - 1)}
                  disabled={viewer.page <= 1}
                  className="doc-btn size-7"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => viewer.goToPage(viewer.page + 1)}
                  disabled={viewer.page >= viewer.numPages}
                  className="doc-btn size-7"
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

function HeaderBtn({
  children,
  onClick,
  label,
  active,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  active?: boolean;
  className?: string;
}) {
  const viewer = useViewer();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button type="button" onClick={onClick} aria-label={label} className={cn("doc-btn", active && "is-active", className)} />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom" container={viewer.shellEl}>{label}</TooltipContent>
    </Tooltip>
  );
}

function MenuItem({
  onClick,
  icon,
  label,
  shortcut,
  disabled,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  disabled?: boolean;
}) {
  return (
    <DropdownMenuItem onClick={onClick} disabled={disabled} className="gap-2.5 py-1.5 pl-2">
      <span className="text-[var(--doc-muted)]">{icon}</span>
      <span>{label}</span>
      {shortcut && <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>}
    </DropdownMenuItem>
  );
}
