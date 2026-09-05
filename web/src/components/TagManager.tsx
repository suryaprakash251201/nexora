import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Plus, Tag as TagIcon, Check, Pencil, Trash2, Save, Search } from "lucide-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { tagsApi } from "../api/endpoints";
import type { Tag } from "../api/types";
import { cn } from "@/lib/utils";
import { toast } from "../lib/toast";
import { ConfirmDialog } from "./ui/ConfirmDialog";

export const TAG_COLORS = [
  { name: "Red", value: "#EF4444" },
  { name: "Orange", value: "#F97316" },
  { name: "Amber", value: "#F59E0B" },
  { name: "Yellow", value: "#EAB308" },
  { name: "Green", value: "#22C55E" },
  { name: "Emerald", value: "#10B981" },
  { name: "Blue", value: "#3B82F6" },
  { name: "Indigo", value: "#6366F1" },
  { name: "Purple", value: "#A855F7" },
  { name: "Pink", value: "#EC4899" },
  { name: "Rose", value: "#F43F5E" },
  { name: "Slate", value: "#64748B" },
];

/** Compact rounded pill. Color carries identity; a glowing dot + gradient
 *  fill make the tag read clearly on both dark and light surfaces. */
export function TagChip({ tag, onRemove, small }: { tag: Tag; onRemove?: () => void; small?: boolean }) {
  const md = !small;
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-semibold transition-all duration-200 select-none",
        md ? "px-3 py-1 text-xs" : "px-2 py-0.5 text-[10px]"
      )}
      style={{
        background: `linear-gradient(135deg, ${tag.color}26, ${tag.color}12)`,
        color: tag.color,
        border: `1px solid ${tag.color}40`,
        boxShadow: `inset 0 1px 0 ${tag.color}22`,
      }}
    >
      <span
        className={cn("rounded-full shrink-0", md ? "h-2 w-2" : "h-1.5 w-1.5")}
        style={{ background: tag.color, boxShadow: `0 0 6px ${tag.color}99` }}
      />
      <span className="truncate max-w-[180px]">{tag.name}</span>
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="ml-0.5 -mr-0.5 rounded-full p-0.5 hover:bg-black/25 hover:text-white transition-colors"
          aria-label={`Remove ${tag.name}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </motion.span>
  );
}

export function TagDot({ color, size = "sm" }: { color: string; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-2.5 w-2.5" : "h-3.5 w-3.5";
  return (
    <span
      className={cn("rounded-full inline-block shrink-0", dim)}
      style={{ background: color, boxShadow: `0 0 8px ${color}66` }}
    />
  );
}

function ColorSwatch({
  value,
  active,
  onClick,
  size = "md",
}: {
  value: string;
  active: boolean;
  onClick: () => void;
  size?: "sm" | "md";
}) {
  const dim = size === "md" ? "h-5 w-5" : "h-4 w-4";
  return (
    <button
      type="button"
      onClick={onClick}
      title={value}
      aria-label={`Use color ${value}`}
      className={cn(
        "rounded-full transition-all duration-200",
        dim,
        active ? "ring-2 ring-offset-2 ring-offset-transparent scale-110" : "hover:scale-110"
      )}
      style={{
        background: value,
        boxShadow: active ? `0 0 10px ${value}` : "none",
        // @ts-expect-error custom prop for ring color
        "--tw-ring-color": value,
      }}
    />
  );
}

/**
 * TagManager — global CRUD surface for the user's tags: search, inline
 * create at the top, per-row rename/recolor and delete.
 */
export function TagManager({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Tag | null>(null);
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(TAG_COLORS[6].value);

  const tags = useQuery({
    queryKey: ["tags"],
    queryFn: () => tagsApi.listRaw().then((d) => d.tags || []),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tags"] });
    qc.invalidateQueries({ queryKey: ["file-tags"] });
  };

  const createMutation = useMutation({
    mutationFn: (data: { name: string; color: string }) => tagsApi.create(data as any),
    onSuccess: () => {
      invalidate();
      setNewName("");
      toast.success("Tag created");
    },
    onError: (e: any) => toast.error(e.message || "Failed to create tag"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, name, color }: { id: string; name?: string; color?: string }) =>
      tagsApi.update(id, { name, color }),
    onSuccess: () => {
      invalidate();
      toast.success("Tag updated");
      setEditingId(null);
      setEditName("");
      setEditColor(null);
    },
    onError: (e: any) => toast.error(e.message || "Failed to update tag"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => tagsApi.remove(id),
    onSuccess: () => {
      invalidate();
      toast.success("Tag deleted");
      setPendingDelete(null);
    },
    onError: (e: any) => toast.error(e.message || "Failed to delete tag"),
  });

  const list = (tags.data || []).filter((t) => t.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.96 }}
      className="w-[340px] glass-strong rounded-2xl shadow-2xl shadow-black/30 overflow-hidden border border-white/[0.06]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-amber-500/10 border border-amber-500/15 grid place-items-center">
            <TagIcon className="h-4 w-4 text-amber-400" />
          </div>
          <div>
            <span className="text-sm font-semibold block leading-none">Manage tags</span>
            <span className="text-[11px] text-content-muted">{(tags.data || []).length} tag{(tags.data || []).length === 1 ? "" : "s"}</span>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-glass-bg transition-colors" aria-label="Close">
          <X className="h-4 w-4 text-text-tertiary" />
        </button>
      </div>

      {/* create row */}
      <div className="p-3 border-b border-white/[0.06] space-y-2 bg-surface/30">
        <div className="flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New tag name…"
            className="flex-1 min-w-0 rounded-lg glass-input px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent/50"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) createMutation.mutate({ name: newName.trim(), color: newColor });
            }}
          />
          <button
            onClick={() => newName.trim() && createMutation.mutate({ name: newName.trim(), color: newColor })}
            disabled={!newName.trim() || createMutation.isPending}
            className="px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-40 transition-colors"
          >
            {createMutation.isPending ? "…" : "Add"}
          </button>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {TAG_COLORS.map((c) => (
            <ColorSwatch key={c.value} value={c.value} active={newColor === c.value} size="sm" onClick={() => setNewColor(c.value)} />
          ))}
        </div>
      </div>

      {/* search */}
      <div className="px-3 pt-3">
        <div className="flex items-center gap-2 rounded-lg glass-input px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-content-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tags…"
            className="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder:text-content-muted"
          />
        </div>
      </div>

      <div className="p-3 max-h-[46vh] overflow-y-auto space-y-1.5">
        {tags.isLoading && <p className="text-center text-content-muted text-xs py-4">Loading…</p>}
        {!tags.isLoading && list.length === 0 && (
          <p className="text-center text-content-muted text-xs py-4">
            {query ? "No tags match your search." : "No tags yet — add one above."}
          </p>
        )}
        <AnimatePresence initial={false}>
          {list.map((tag) => {
            const editing = editingId === tag.id;
            const currentColor = editColor ?? tag.color;
            return (
              <motion.div
                key={tag.id}
                layout
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={cn("rounded-xl border p-2.5 space-y-2 transition-colors", editing ? "border-accent/25 bg-accent/5" : "border-white/[0.05] bg-surface/40")}
              >
                {editing ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full shrink-0" style={{ background: currentColor, boxShadow: `0 0 6px ${currentColor}` }} />
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Tag name…"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") updateMutation.mutate({ id: tag.id, name: editName.trim() || undefined, color: currentColor });
                        }}
                        className="flex-1 min-w-0 rounded-lg glass-input px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent/50"
                      />
                      <button
                        onClick={() => updateMutation.mutate({ id: tag.id, name: editName.trim() || undefined, color: currentColor })}
                        disabled={!editName.trim()}
                        className="p-1.5 rounded-lg hover:bg-accent/10 hover:text-accent transition-colors disabled:opacity-40"
                        title="Save"
                      >
                        <Save className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {TAG_COLORS.map((c) => (
                        <ColorSwatch key={c.value} value={c.value} active={currentColor === c.value} size="sm" onClick={() => setEditColor(c.value)} />
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <TagDot color={tag.color} />
                    <span className="flex-1 min-w-0 truncate text-sm font-medium">{tag.name}</span>
                    <span className="text-[10px] text-content-muted shrink-0 px-1.5 py-0.5 rounded-full bg-surface-muted border border-border/40">
                      {tag.count ?? 0}
                    </span>
                    <button
                      onClick={() => { setEditingId(tag.id); setEditName(tag.name); setEditColor(null); }}
                      className="p-1.5 rounded-lg hover:bg-accent/10 hover:text-accent transition-colors"
                      title="Rename / recolor"
                      aria-label={`Edit tag ${tag.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setPendingDelete(tag)}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 hover:text-red-400 transition-colors"
                      title="Delete tag"
                      aria-label={`Delete tag ${tag.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete this tag?"
        description={
          pendingDelete
            ? `"${pendingDelete.name}" will be removed from ${pendingDelete.count ?? 0} file(s). The files themselves are not touched.`
            : ""
        }
        confirmLabel="Delete"
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => { if (pendingDelete) deleteMutation.mutate(pendingDelete.id); }}
        onCancel={() => setPendingDelete(null)}
      />
    </motion.div>
  );
}

/**
 * TagPicker — per-item assignment popover. Toggles tags on/off, supports
 * search and inline creation.
 */
export function TagPicker({
  rootId,
  paths,
  existingTags,
  onClose,
}: {
  rootId: string;
  paths: string[];
  existingTags?: Tag[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[6].value);
  const tags = useQuery({
    queryKey: ["tags"],
    queryFn: () => tagsApi.listRaw().then((d) => d.tags || []),
  });
  const createTag = useMutation({
    mutationFn: (data: { name: string; color: string }) => tagsApi.create(data as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tags"] });
      setNewTagName("");
      setShowCreate(false);
    },
  });
  const applyTag = useMutation({
    mutationFn: (tagId: string) => tagsApi.tagFile({ tag_id: tagId, root_id: rootId, paths }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["file-tags"] });
      qc.invalidateQueries({ queryKey: ["tags"] });
    },
  });
  const removeTag = useMutation({
    mutationFn: (tagId: string) => tagsApi.untagFile({ tag_id: tagId, root_id: rootId, paths: paths.join(",") }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["file-tags"] });
      qc.invalidateQueries({ queryKey: ["tags"] });
    },
  });
  const appliedIds = new Set(existingTags?.map((t) => t.id) || []);
  const list = (tags.data || []).filter((t) => t.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.96 }}
      className="w-80 glass-strong rounded-2xl shadow-2xl shadow-black/30 overflow-hidden border border-white/[0.06]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-amber-500/10 border border-amber-500/15 grid place-items-center">
            <TagIcon className="h-4 w-4 text-amber-400" />
          </div>
          <div>
            <span className="text-sm font-semibold block leading-none">Tag {paths.length > 1 ? `${paths.length} items` : "item"}</span>
            <span className="text-[11px] text-content-muted">{appliedIds.size} applied</span>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-glass-bg transition-colors" aria-label="Close">
          <X className="h-4 w-4 text-text-tertiary" />
        </button>
      </div>

      <div className="px-3 pt-3">
        <div className="flex items-center gap-2 rounded-lg glass-input px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-content-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tags…"
            className="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder:text-content-muted"
          />
        </div>
      </div>

      <div className="p-3 max-h-64 overflow-y-auto space-y-1">
        {list.map((tag) => {
          const applied = appliedIds.has(tag.id);
          return (
            <button
              key={tag.id}
              onClick={() => (applied ? removeTag.mutate(tag.id) : applyTag.mutate(tag.id))}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 border",
                applied
                  ? "bg-amber-500/10 border-amber-500/25 text-amber-300"
                  : "border-transparent text-content-secondary hover:bg-white/[0.04]"
              )}
            >
              <TagDot color={tag.color} />
              <span className="flex-1 text-left truncate">{tag.name}</span>
              {tag.count !== undefined && <span className="text-[10px] text-content-muted">{tag.count}</span>}
              <span className={cn("grid place-items-center h-4 w-4 rounded-full", applied ? "bg-amber-400 text-white" : "border border-border/60 text-content-muted")}>
                {applied ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
              </span>
            </button>
          );
        })}
        {tags.data?.length === 0 && !showCreate && (
          <p className="text-center text-content-muted text-xs py-4">No tags yet. Create one below.</p>
        )}
      </div>

      <div className="border-t border-white/[0.06] p-3">
        <AnimatePresence>
          {showCreate ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="space-y-3 overflow-hidden"
            >
              <input
                type="text"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="Tag name..."
                className="w-full px-3 py-2 rounded-lg glass-input text-sm outline-none focus:ring-1 focus:ring-accent/50"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTagName.trim()) createTag.mutate({ name: newTagName.trim(), color: newTagColor });
                }}
              />
              <div className="flex flex-wrap gap-1.5">
                {TAG_COLORS.map((c) => (
                  <ColorSwatch key={c.value} value={c.value} active={newTagColor === c.value} size="sm" onClick={() => setNewTagColor(c.value)} />
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCreate(false)}
                  className="flex-1 px-3 py-1.5 rounded-lg glass-subtle text-sm text-content-muted hover:text-content-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => newTagName.trim() && createTag.mutate({ name: newTagName.trim(), color: newTagColor })}
                  disabled={!newTagName.trim()}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-40 transition-colors"
                >
                  Create
                </button>
              </div>
            </motion.div>
          ) : (
            <button
              onClick={() => setShowCreate(true)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-content-muted hover:text-content-secondary hover:bg-white/[0.04] transition-all"
            >
              <Plus className="h-4 w-4" />
              <span>Create new tag</span>
            </button>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/**
 * TagFilterBar — folder-level AND filter chips. Active tags are filled with
 * their color; inactive are subtle. Lives above the file list.
 */
export function TagFilterBar({
  activeTags,
  onToggle,
  onClear,
}: {
  activeTags: string[];
  onToggle: (tagId: string) => void;
  onClear: () => void;
}) {
  const tags = useQuery({
    queryKey: ["tags"],
    queryFn: () => tagsApi.listRaw().then((d) => d.tags || []),
  });
  if (!tags.data?.length) return null;
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className="flex items-center gap-2 px-4 py-2 overflow-x-auto no-scrollbar mask-edges"
    >
      <span className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
        <TagIcon className="h-3.5 w-3.5" /> Filter
      </span>
      {tags.data.map((tag) => {
        const active = activeTags.includes(tag.id);
        return (
          <button
            key={tag.id}
            onClick={() => onToggle(tag.id)}
            className={cn(
              "shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all duration-200 border",
              active ? "border-current" : "border-transparent hover:border-white/10"
            )}
            style={{
              color: active ? tag.color : undefined,
              backgroundColor: active ? `${tag.color}18` : "rgba(255,255,255,0.04)",
              borderColor: active ? `${tag.color}55` : undefined,
            }}
            aria-pressed={active}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: tag.color, boxShadow: active ? `0 0 6px ${tag.color}` : "none" }} />
            {tag.name}
            {active && <Check className="h-3 w-3" />}
          </button>
        );
      })}
      {activeTags.length > 0 && (
        <button
          onClick={onClear}
          className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-content-muted hover:text-content-secondary px-2 py-1 rounded-md hover:bg-white/[0.04] transition-colors"
        >
          Clear
        </button>
      )}
    </motion.div>
  );
}
