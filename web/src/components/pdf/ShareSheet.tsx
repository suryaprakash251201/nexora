import { useState } from "react";
import { Check, Copy, ExternalLink, Link2, Share2, Smartphone, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "../../lib/toast";
import { useViewer } from "./ctx";

/**
 * Floating share sheet — a calm, minimal surface that plugs into Nexora's
 * existing sharing flow (manage access) plus quick actions: copy the
 * private link, native device share, or opening elsewhere.
 */
export function ShareSheet() {
  const viewer = useViewer();
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(new URL(viewer.url, window.location.origin).href);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — fall back.
      try {
        const ta = document.createElement("textarea");
        ta.value = new URL(viewer.url, window.location.origin).href;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      } catch {
        toast.error("Couldn't copy the link");
      }
    }
  };

  const nativeShare = async () => {
    try {
      await navigator.share({
        title: viewer.item.name,
        url: new URL(viewer.url, window.location.origin).href,
      });
    } catch {
      /* user cancelled */
    }
  };

  const hasNativeShare = typeof navigator !== "undefined" && !!navigator.share;

  return (
    <AnimatePresence>
      {viewer.shareOpen && (
        <motion.div
          initial={{ opacity: 0, y: -10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.98 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          role="dialog"
          aria-label="Share document"
          className="doc-glass absolute top-[72px] right-4 z-[60] w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-2xl p-4 sm:right-5"
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--doc-accent)]/12 text-[var(--doc-accent)]">
                <Share2 className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm leading-tight font-semibold">Share</p>
                <p className="truncate text-[11px] text-[var(--doc-faint)]" title={viewer.item.name}>
                  {viewer.item.name}
                </p>
              </div>
            </div>
            <button onClick={() => viewer.toggleShare(false)} className="doc-btn size-7" aria-label="Close share sheet">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-1">
            {viewer.hasShareFlow && (
              <ShareRow
                icon={<Link2 className="h-4 w-4" />}
                title="Manage sharing"
                desc="Create links & control access"
                onClick={() => {
                  viewer.toggleShare(false);
                  viewer.requestShare();
                }}
              />
            )}
            <ShareRow
              icon={copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              title={copied ? "Copied" : "Copy private link"}
              desc="Requires signing in to Nexora"
              onClick={copyLink}
            />
            {hasNativeShare && (
              <ShareRow
                icon={<Smartphone className="h-4 w-4" />}
                title="Share via device…"
                onClick={nativeShare}
              />
            )}
            <ShareRow
              icon={<ExternalLink className="h-4 w-4" />}
              title="Open in new tab"
              onClick={() => {
                viewer.toggleShare(false);
                viewer.openInNewTab();
              }}
            />
          </div>

          <p className="mt-3 border-t border-[var(--doc-border)] pt-3 text-[11px] leading-relaxed text-[var(--doc-faint)]">
            This stays inside your workspace — only people with access to your Nexora can open it.
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ShareRow({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left outline-none transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-[var(--doc-accent)]/50"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-[var(--doc-muted)]">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-[var(--doc-text)]">{title}</span>
        {desc && <span className="block truncate text-[11px] text-[var(--doc-faint)]">{desc}</span>}
      </span>
    </button>
  );
}
