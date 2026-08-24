import {
  Maximize,
  Minimize,
  MoveHorizontal,
  PanelLeft,
  Plus,
  Minus,
  RotateCw,
  Search,
  Download,
  Share2,
  Info,
  Printer,
  MoreHorizontal,
} from "lucide-react";
import { motion } from "framer-motion";
import { useViewer } from "./ctx";
import { padPage } from "./utils";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

/**
 * Floating bottom-center reading controls. Desktop: zoom / fit / rotate /
 * pages dock with the signature PAGE counter. Mobile: compact [Pages ·
 * Search · More] bar. Fades out when idle; stays reachable in focus mode.
 */
export function FloatingControls() {
  const viewer = useViewer();

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-3 transition-all duration-300 sm:pb-5",
        viewer.chromeVisible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0 [&_*]:pointer-events-none"
      )}
    >
      {/* Desktop dock */}
      <motion.div
        layout={false}
        className="doc-glass pointer-events-auto hidden h-11 items-center gap-1 rounded-2xl px-1.5 md:flex"
        aria-label="Reading controls"
      >
        <DockBtn label="Zoom out" onClick={() => viewer.zoomBy(1 / 1.2)} disabled={!viewer.numPages}>
          <Minus className="h-[17px] w-[17px]" />
        </DockBtn>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={() => viewer.resetZoom()}
                className="h-8 min-w-[3.25rem] rounded-lg font-mono text-xs tabular-nums text-[var(--doc-muted)] outline-none transition-colors hover:bg-white/5 hover:text-[var(--doc-text)] focus-visible:ring-2 focus-visible:ring-[var(--doc-accent)]/50"
                title="Actual size (Ctrl+0)"
              />
            }
          >
            {Math.round(viewer.effectiveScale * 100)}%
          </TooltipTrigger>
          <TooltipContent container={viewer.shellEl}>Actual size (Ctrl+0)</TooltipContent>
        </Tooltip>
        <DockBtn label="Zoom in" onClick={() => viewer.zoomBy(1.2)} disabled={!viewer.numPages}>
          <Plus className="h-[17px] w-[17px]" />
        </DockBtn>

        <DockDivider />

        {/* Fit segmented control */}
        <div className="flex items-center gap-0.5 rounded-xl bg-white/[0.04] p-0.5">
          <FitBtn active={viewer.fit === "width"} onClick={() => viewer.setFit("width")} label="Fit width">
            <MoveHorizontal className="h-[15px] w-[15px]" />
            <span className="hidden lg:inline">Width</span>
          </FitBtn>
          <FitBtn active={viewer.fit === "page"} onClick={() => viewer.setFit("page")} label="Fit page">
            <Maximize className="h-[15px] w-[15px]" />
            <span className="hidden lg:inline">Page</span>
          </FitBtn>
        </div>

        <DockDivider />

        <DockBtn label="Rotate clockwise" onClick={() => viewer.rotate(1)}>
          <RotateCw className="h-[16px] w-[16px]" />
        </DockBtn>
        <DockBtn
          label="Pages panel (P)"
          onClick={() => viewer.togglePages()}
          active={viewer.pagesOpen}
        >
          <PanelLeft className="h-[17px] w-[17px]" />
        </DockBtn>
        <DockBtn
          label={viewer.isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          onClick={() => viewer.toggleFullscreen()}
        >
          {viewer.isFullscreen ? <Minimize className="h-[17px] w-[17px]" /> : <Maximize className="h-[17px] w-[17px]" />}
        </DockBtn>
      </motion.div>

      {/* Mobile bar */}
      <motion.div
        layout={false}
        className="doc-glass pointer-events-auto flex h-11 items-center rounded-2xl px-1.5 md:hidden"
        aria-label="Document controls"
      >
        <button
          onClick={() => viewer.togglePages(true)}
          className="flex h-9 items-center gap-2 rounded-xl px-3 outline-none transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-[var(--doc-accent)]/50"
          aria-label="Browse pages"
        >
          <span className="text-sm font-medium">Page</span>
          <span className="font-mono text-xs tabular-nums text-[var(--doc-muted)]">
            {padPage(viewer.page)}/{padPage(Math.max(viewer.numPages, 0))}
          </span>
        </button>
        <DockDivider />
        <DockBtn label="Search document" onClick={() => viewer.openSearch()}>
          <Search className="h-[17px] w-[17px]" />
        </DockBtn>
        <DropdownMenu>
          <DropdownMenuTrigger className="doc-btn" aria-label="More actions">
            <MoreHorizontal className="h-[18px] w-[18px]" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" sideOffset={10} className="w-52" container={viewer.shellEl}>
            <MobileActions />
          </DropdownMenuContent>
        </DropdownMenu>
      </motion.div>
    </div>
  );
}

function MobileActions() {
  const viewer = useViewer();
  return (
    <>
      <MItem icon={<MoveHorizontal />} label={viewer.fit === "width" ? "Fit page" : "Fit width"} onClick={() => viewer.setFit(viewer.fit === "width" ? "page" : "width")} />
      <MItem icon={<RotateCw />} label="Rotate" onClick={() => viewer.rotate(1)} />
      <MItem icon={viewer.isFullscreen ? <Minimize /> : <Maximize />} label={viewer.isFullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={() => viewer.toggleFullscreen()} />
      <DropdownMenuSeparator />
      <MItem icon={<Download className="h-4 w-4" />} label="Download" onClick={() => viewer.download()} />
      <MItem icon={<Printer className="h-4 w-4" />} label="Print…" onClick={() => viewer.print()} />
      <MItem icon={<Share2 className="h-4 w-4" />} label="Share" onClick={() => viewer.toggleShare(true)} />
      <MItem icon={<Info className="h-4 w-4" />} label="Info" onClick={() => viewer.toggleInfo(true)} />
    </>
  );
}

function DockBtn({
  children,
  onClick,
  label,
  active,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  active?: boolean;
  disabled?: boolean;
}) {
  const viewer = useViewer();
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={active} className={cn("doc-btn", active && "is-active")} />}
        closeOnClick={false}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top" container={viewer.shellEl}>{label}</TooltipContent>
    </Tooltip>
  );
}

function DockDivider() {
  return <div className="mx-1 h-5 w-px bg-white/10" aria-hidden />;
}

function FitBtn({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-[var(--doc-accent)]/50",
        active
          ? "bg-[var(--doc-accent)] text-white shadow-sm"
          : "text-[var(--doc-muted)] hover:text-[var(--doc-text)]"
      )}
    >
      {children}
    </button>
  );
}

function MItem({
  onClick,
  icon,
  label,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <DropdownMenuItem onClick={onClick} className="gap-2.5 py-1.5 pl-2">
      <span className="text-[var(--doc-muted)]">{icon}</span>
      <span>{label}</span>
    </DropdownMenuItem>
  );
}
