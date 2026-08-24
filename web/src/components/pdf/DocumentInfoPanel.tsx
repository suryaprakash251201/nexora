import { AnimatePresence, motion } from "framer-motion";
import { CalendarClock, FileText, FolderTree, Hash, X } from "lucide-react";
import { useViewer } from "./ctx";
import { formatBytes, formatDate } from "../../lib/format";

/**
 * Right-side document information drawer — grouped metadata cards instead
 * of a table: identity, timeline, location breadcrumb, and PDF internals.
 */
export function DocumentInfoPanel() {
  const viewer = useViewer();
  const { item, meta } = viewer;

  const pathParts = item.path ? item.path.split("/").filter(Boolean) : [];

  return (
    <AnimatePresence>
      {viewer.infoOpen && (
        <motion.aside
          initial={{ opacity: 0, x: 26 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 26 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="doc-glass absolute top-[72px] right-4 bottom-24 z-[55] flex w-[300px] flex-col overflow-hidden rounded-2xl sm:right-5"
          role="complementary"
          aria-label="Document information"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--doc-border)] px-4 py-3">
            <h2 className="text-[13px] font-semibold text-[var(--doc-text)]">Document info</h2>
            <button onClick={() => viewer.toggleInfo(false)} className="doc-btn size-7" aria-label="Close info panel">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="doc-scroll min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {/* Document */}
            <Section icon={<FileText className="h-3.5 w-3.5" />} title="Document">
              <p className="text-sm leading-snug font-medium break-all text-[var(--doc-text)]" title={item.name}>
                {item.name}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <Chip>PDF{meta?.version ? ` ${meta.version}` : ""}</Chip>
                <Chip>{viewer.numPages} {viewer.numPages === 1 ? "page" : "pages"}</Chip>
                <Chip>{formatBytes(item.size)}</Chip>
              </div>
              {meta?.title && meta.title !== item.name && (
                <Field label="Title" value={meta.title} />
              )}
            </Section>

            {/* Timeline */}
            {(item.modified || meta?.created) && (
              <Section icon={<CalendarClock className="h-3.5 w-3.5" />} title="Timeline">
                {item.modified && <Field label="Modified" value={formatDate(item.modified)} />}
                {meta?.created && <Field label="Created" value={meta.created} />}
              </Section>
            )}

            {/* Location */}
            {pathParts.length > 0 && (
              <Section icon={<FolderTree className="h-3.5 w-3.5" />} title="Location">
                <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
                  {pathParts.map((part, i) => (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && <span className="text-[var(--doc-faint)]">/</span>}
                      <span className={cnPart(i === pathParts.length - 1)}>{part}</span>
                    </span>
                  ))}
                </div>
              </Section>
            )}

            {/* PDF metadata (only when present — no empty rows) */}
            {(meta?.author || meta?.creator || meta?.producer || meta?.subject || meta?.keywords) && (
              <Section icon={<Hash className="h-3.5 w-3.5" />} title="PDF details">
                {meta?.author && <Field label="Author" value={meta.author} />}
                {meta?.subject && <Field label="Subject" value={meta.subject} />}
                {meta?.keywords && <Field label="Keywords" value={meta.keywords} />}
                {meta?.creator && <Field label="Created with" value={meta.creator} />}
                {meta?.producer && <Field label="Producer" value={meta.producer} />}
              </Section>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function cnPart(isLast: boolean): string {
  return isLast
    ? "font-medium text-[var(--doc-text)]"
    : "text-[var(--doc-muted)]";
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--doc-border)] bg-white/[0.03] p-3.5">
      <h3 className="mb-2.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.14em] text-[var(--doc-faint)] uppercase">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2 first:mt-0">
      <p className="text-[10px] tracking-wide text-[var(--doc-faint)] uppercase">{label}</p>
      <p className="text-[12.5px] leading-snug break-words text-[var(--doc-muted)]">{value}</p>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-white/[0.06] px-2 py-1 font-mono text-[10.5px] tabular-nums text-[var(--doc-muted)]">
      {children}
    </span>
  );
}
