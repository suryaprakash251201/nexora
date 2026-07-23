import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Plus, Tag as TagIcon, Check } from "lucide-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { get, post, del } from "../api/client";
import type { Tag } from "../api/types";
import { cn } from "@/lib/utils";

const TAG_COLORS = [
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

export function TagChip({ tag, onRemove, small }: { tag: Tag; onRemove?: () => void; small?: boolean }) {
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium transition-all duration-200",
        small ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs"
      )}
      style={{
        backgroundColor: `${tag.color}20`,
        color: tag.color,
        border: `1px solid ${tag.color}30`,
      }}
    >
      <span
        className={cn("rounded-full", small ? "h-1.5 w-1.5" : "h-2 w-2")}
        style={{ backgroundColor: tag.color }}
      />
      {tag.name}
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="ml-0.5 rounded-full p-0.5 hover:bg-white/20 transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </motion.span>
  );
}

export function TagDot({ color, size = "sm" }: { color: string; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-2 w-2" : "h-3 w-3";
  return (
    <span
      className={cn("rounded-full inline-block shadow-sm", dim)}
      style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}40` }}
    />
  );
}

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
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[6].value);
  const [showCreate, setShowCreate] = useState(false);

  const tags = useQuery({
    queryKey: ["tags"],
    queryFn: () => get<{ tags: Tag[] }>("/tags").then((d) => d.tags || []),
  });

  const createTag = useMutation({
    mutationFn: (data: { name: string; color: string }) =>
      post<Tag>("/tags", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tags"] });
      setNewTagName("");
      setShowCreate(false);
    },
  });

  const applyTag = useMutation({
    mutationFn: (tagId: string) =>
      post("/files/tag", { tag_id: tagId, root_id: rootId, paths }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["file-tags"] });
      qc.invalidateQueries({ queryKey: ["tags"] });
    },
  });

  const removeTag = useMutation({
    mutationFn: (tagId: string) =>
      del("/files/tag", { tag_id: tagId, root_id: rootId, paths: paths.join(",") }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["file-tags"] });
      qc.invalidateQueries({ queryKey: ["tags"] });
    },
  });

  const appliedIds = new Set(existingTags?.map((t) => t.id) || []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.96 }}
      className="w-72 glass-strong rounded-xl shadow-2xl shadow-black/30 overflow-hidden border border-white/[0.06]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TagIcon className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold">Tags</span>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 transition-colors">
          <X className="h-4 w-4 text-text-tertiary" />
        </button>
      </div>

      <div className="p-3 max-h-64 overflow-y-auto space-y-1">
        {(tags.data || []).map((tag) => {
          const applied = appliedIds.has(tag.id);
          return (
            <button
              key={tag.id}
              onClick={() => applied ? removeTag.mutate(tag.id) : applyTag.mutate(tag.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                applied
                  ? "bg-accent/10 text-accent"
                  : "text-text-secondary hover:bg-white/[0.04]"
              )}
            >
              <span
                className="h-3 w-3 rounded-full shrink-0"
                style={{ backgroundColor: tag.color }}
              />
              <span className="flex-1 text-left truncate">{tag.name}</span>
              {applied && <Check className="h-4 w-4 shrink-0" />}
              {tag.count !== undefined && (
                <span className="text-[10px] text-text-tertiary">{tag.count}</span>
              )}
            </button>
          );
        })}

        {tags.data?.length === 0 && !showCreate && (
          <p className="text-center text-text-tertiary text-xs py-4">
            No tags yet. Create one below.
          </p>
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
                  if (e.key === "Enter" && newTagName.trim()) {
                    createTag.mutate({ name: newTagName.trim(), color: newTagColor });
                  }
                }}
              />
              <div className="flex flex-wrap gap-1.5">
                {TAG_COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setNewTagColor(c.value)}
                    className={cn(
                      "h-6 w-6 rounded-full transition-all duration-200",
                      newTagColor === c.value
                        ? "ring-2 ring-offset-2 ring-offset-transparent scale-110"
                        : "hover:scale-110"
                    )}
                    style={{ 
                        backgroundColor: `${c.value}15`, 
                        color: c.value, 
                        border: newTagColor === c.value ? `2px solid ${c.value}` : "1px solid transparent"
                      }}
                    title={c.name}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCreate(false)}
                  className="flex-1 px-3 py-1.5 rounded-lg glass-subtle text-sm text-text-tertiary hover:text-text-secondary transition-colors"
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
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-text-tertiary hover:text-text-secondary hover:bg-white/[0.04] transition-all"
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
    queryFn: () => get<{ tags: Tag[] }>("/tags").then((d) => d.tags || []),
  });

  if (!tags.data?.length) return null;

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className="flex items-center gap-2 px-4 py-2 overflow-x-auto no-scrollbar"
    >
      <TagIcon className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
      {tags.data.map((tag) => {
        const active = activeTags.includes(tag.id);
        return (
          <button
            key={tag.id}
            onClick={() => onToggle(tag.id)}
            className={cn(
              "shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-200 border",
              active
                ? "border-current"
                : "border-transparent hover:border-white/10"
            )}
            style={{
              color: active ? tag.color : undefined,
              backgroundColor: active ? `${tag.color}15` : "rgba(255,255,255,0.04)",
            }}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: tag.color }}
            />
            {tag.name}
          </button>
        );
      })}
      {activeTags.length > 0 && (
        <button
          onClick={onClear}
          className="shrink-0 text-[10px] text-text-tertiary hover:text-text-secondary px-2 py-1 rounded-md hover:bg-white/[0.04] transition-colors"
        >
          Clear filters
        </button>
      )}
    </motion.div>
  );
}
