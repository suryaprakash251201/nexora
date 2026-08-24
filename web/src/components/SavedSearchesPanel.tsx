import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Search,
  Plus,
  Filter,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
;
import { savedSearchesApi } from "../api/endpoints";
import { SavedSearch, SavedSearchInput } from "../api/types";
import { cn } from "@/lib/utils";
import { Button } from "./ui/Button";
import { Modal } from "./Modal";
import { Input } from "./ui/Input";
import { toast } from "../lib/toast";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { QueryError } from "./ui/QueryError";
interface SavedSearchesPanelProps {
  roots: { id: string; name: string }[];
  onSearch?: (query: string, rootId?: string) => void;
  onClose?: () => void;
}
const defaultFilters = {
  kind: "",
  modifiedAfter: "",
  modifiedBefore: "",
  minSize: "",
  maxSize: "",
};
export default function SavedSearchesPanel({ roots, onSearch, onClose }: SavedSearchesPanelProps) {
  const qc = useQueryClient();
  const [editingSearch, setEditingSearch] = useState<SavedSearch | null>(null);
  const [creating, setCreating] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState(defaultFilters);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["saved-searches"],
    queryFn: () => savedSearchesApi.list(),
  });
  const createMutation = useMutation({
    mutationFn: (input: SavedSearchInput) => savedSearchesApi.create(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-searches"] });
      toast.success("Saved search created");
      setCreating(false);
    },
    onError: (err: any) => toast.error(err.message || "Failed to create saved search"),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: SavedSearchInput }) => savedSearchesApi.update(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-searches"] });
      toast.success("Saved search updated");
      setEditingSearch(null);
    },
    onError: (err: any) => toast.error(err.message || "Failed to update saved search"),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => savedSearchesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-searches"] });
      toast.success("Saved search deleted");
    },
    onError: (err: any) => toast.error(err.message || "Failed to delete saved search"),
  });
  const executeMutation = useMutation({
    mutationFn: ({ id, q }: { id: string; q?: any }) => savedSearchesApi.execute(id, q),
    onSuccess: (data) => {
      if (onSearch) {
        onSearch(data.saved_search.query, data.saved_search.root_id);
      }
      if (onClose) onClose();
    },
    onError: (err: any) => toast.error(err.message || "Failed to execute search"),
  });
  const handleCreate = (input: SavedSearchInput) => {
    createMutation.mutate(input);
  };
  const handleUpdate = (id: string, input: SavedSearchInput) => {
    updateMutation.mutate({ id, input });
  };
  const [pendingDelete, setPendingDelete] = useState<SavedSearch | null>(null);
  const handleDelete = (search: SavedSearch) => {
    setPendingDelete(search);
  };
  const handleExecute = (search: SavedSearch) => {
    const q = {
      limit: 200,
      offset: 0,
      root: search.root_id,
    };
    executeMutation.mutate({ id: search.id, q });
  };
  const handlePin = (search: SavedSearch) => {
    handleUpdate(search.id, { ...search, is_pinned: !search.is_pinned });
  };
  const [draft, setDraft] = useState<SavedSearchInput | null>(null);
  const openCreate = () => {
    setEditingSearch(null);
    setDraft({ name: "", query: "", filters: "{}", sort: "name", sort_order: "asc", root_id: "", icon: "", color: "", is_pinned: false });
    setCreating(true);
  };
  const openEdit = (search: SavedSearch) => {
    setEditingSearch(search);
    setCreating(false);
  };
  const formData: SavedSearchInput = editingSearch
    ? { name: editingSearch.name, query: editingSearch.query, filters: editingSearch.filters, sort: editingSearch.sort, sort_order: editingSearch.sort_order, root_id: editingSearch.root_id, icon: editingSearch.icon, color: editingSearch.color, is_pinned: editingSearch.is_pinned }
    : draft ?? { name: "", query: "", filters: "{}", sort: "name", sort_order: "asc", root_id: "", icon: "", color: "", is_pinned: false };
  const updateField = (patch: Partial<SavedSearchInput>) => {
    if (editingSearch) setEditingSearch({ ...editingSearch, ...patch });
    else setDraft((d) => (d ? { ...d, ...patch } : d));
  };
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingSearch) {
      handleUpdate(editingSearch.id, formData);
    } else {
      handleCreate(formData);
    }
  };
  if (isError) {
    return <div className="p-4"><QueryError message="Could not load saved searches." onRetry={() => refetch()} /></div>;
  }
  if (isLoading) {
    return <div className="p-4"><div className="animate-pulse space-y-3"><div className="h-12 bg-surface/50 rounded-xl" /><div className="h-12 bg-surface/50 rounded-xl" /></div></div>;
  }
  const searches = data?.items || [];
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <motion.div
            whileHover={{ scale: 1.05 }}
            className="h-8 w-8 rounded-xl bg-gradient-to-br from-accent via-accent-secondary to-accent-tertiary grid place-items-center text-white font-bold shadow-lg shadow-accent-glow shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 002 2v2.945M8 3.935V3.5a2.5 2.5 0 012.5-2.5h.5a2 2 0 012 2 2 2 0 002 2h.5a2.5 2.5 0 012.5 2.5v.435" />
            </svg>
          </motion.div>
          <h2 className="font-semibold">Smart Folders</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setFilterOpen(!filterOpen)} icon={<Filter className="h-4 w-4" />}>
            Filters
          </Button>
          <Button size="sm" onClick={openCreate} icon={<Plus className="h-4 w-4" />}>
            New
          </Button>
        </div>
      </div>
      {/* Filters */}
      <AnimatePresence>
        {filterOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="p-4 border-b border-white/5 bg-surface/30"
          >
            <div className="grid grid-cols-2 gap-3 mb-3">
              <select
                value={filters.kind}
                onChange={(e) => setFilters({ ...filters, kind: e.target.value })}
                className="w-full rounded-lg glass-input px-3 py-2 outline-none"
              >
                <option value="">All</option>
                <option value="folders">Folders</option>
                <option value="documents">Documents</option>
                <option value="images">Images</option>
                <option value="videos">Videos</option>
                <option value="audio">Audio</option>
                <option value="archives">Archives</option>
              </select>
              <select
                value={filters.modifiedAfter ? "week" : filters.modifiedBefore ? "month" : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setFilters({
                    ...filters,
                    modifiedAfter: v === "week" ? new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0] : "",
                    modifiedBefore: v === "month" ? new Date().toISOString().split("T")[0] : "",
                  });
                }}
                className="w-full rounded-lg glass-input px-3 py-2 outline-none"
              >
                <option value="">Any time</option>
                <option value="week">Past week</option>
                <option value="month">Past month</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setFilters(defaultFilters)}>
                Clear filters
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Search List */}
      <div className="flex-1 overflow-y-auto p-2">
        {searches.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-content-muted p-8">
            <Search className="h-10 w-10 opacity-30 mb-3" />
            <p className="font-medium">No saved searches yet</p>
            <p className="text-sm opacity-70 mt-1">Create a smart folder to quickly access filtered results</p>
            <Button size="sm" className="mt-4" onClick={openCreate} icon={<Plus className="h-4 w-4" />}>
              Create your first
            </Button>
          </div>
        ) : (
          <ul className="space-y-1" role="list">
            {searches.map((search) => (
              <SavedSearchItem
                key={search.id}
                search={search}
                roots={roots}
                onExecute={handleExecute}
                onEdit={openEdit}
                onDelete={handleDelete}
                onPin={handlePin}
                isPinned={search.is_pinned}
              />
            ))}
          </ul>
        )}
      </div>
      {/* Create/Edit Modal */}
      {(creating || editingSearch) && (
        <Modal
          title={editingSearch ? "Edit Smart Folder" : "New Smart Folder"}
          onClose={() => { setCreating(false); setEditingSearch(null); setDraft(null); }}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setCreating(false); setEditingSearch(null); setDraft(null); }}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={!formData.name.trim()}>
                {editingSearch ? "Save" : "Create"}
              </Button>
            </div>
          }
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm mb-1 opacity-80">Name</label>
              <Input
                value={formData.name}
                onChange={(e) => updateField({ name: e.target.value })}
                placeholder="My smart folder"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm mb-1 opacity-80">Search Query</label>
              <Input
                value={formData.query}
                onChange={(e) => updateField({ query: e.target.value })}
                placeholder="e.g. vacation photos"
              />
            </div>
            <div>
              <label className="block text-sm mb-1 opacity-80">Root (optional)</label>
              <select
                value={formData.root_id}
                onChange={(e) => updateField({ root_id: e.target.value })}
                className="w-full rounded-lg glass-input px-3 py-2 outline-none"
              >
                <option value="">All roots</option>
                {roots.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1 opacity-80">Sort</label>
                <select
                  value={formData.sort}
                  onChange={(e) => updateField({ sort: e.target.value })}
                  className="w-full rounded-lg glass-input px-3 py-2 outline-none"
                >
                  <option value="name">Name</option>
                  <option value="modified">Modified</option>
                  <option value="size">Size</option>
                  <option value="type">Type</option>
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1 opacity-80">Order</label>
                <select
                  value={formData.sort_order}
                  onChange={(e) => updateField({ sort_order: e.target.value })}
                  className="w-full rounded-lg glass-input px-3 py-2 outline-none"
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="pinned"
                checked={formData.is_pinned}
                onChange={(e) => updateField({ is_pinned: e.target.checked })}
                className="w-4 h-4 rounded border-surface/50 bg-surface text-accent focus:ring-accent"
              />
              <label htmlFor="pinned" className="text-sm">Pin to top</label>
            </div>
          </form>
        </Modal>
      )}
      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete smart folder?"
        description={pendingDelete ? `"${pendingDelete.name}" will be permanently deleted.` : ""}
        confirmLabel="Delete"
        danger
        onConfirm={() => { if (pendingDelete) deleteMutation.mutate(pendingDelete.id); setPendingDelete(null); }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
function SavedSearchItem({
  search,
  roots,
  onExecute,
  onEdit,
  onDelete,
  onPin,
  isPinned,
}: {
  search: SavedSearch;
  roots: { id: string; name: string }[];
  onExecute: (s: SavedSearch) => void;
  onEdit: (s: SavedSearch) => void;
  onDelete: (s: SavedSearch) => void;
  onPin: (s: SavedSearch) => void;
  isPinned: boolean;
}) {
  return (
    <motion.li
      whileHover={{ x: 4 }}
      className={cn(
        "group relative flex items-center gap-3 p-3 rounded-xl transition-all",
        "bg-surface/50 border border-white/[0.03]",
        isPinned && "ring-1 ring-accent/30 bg-accent/5"
      )}
      layout
      onClick={() => onExecute(search)}
    >
      <div
        className="flex-1 flex items-center gap-3 text-left p-2 rounded-lg hover:bg-accent/5 transition-colors"
        aria-label="Execute search"
      >
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-accent/10 text-accent shrink-0">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{search.name}</span>
            {isPinned && <svg className="h-3.5 w-3.5 text-amber-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>}
            {search.root_id && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-content-muted">
                {roots.find((r) => r.id === search.root_id)?.name || search.root_id}
              </span>
            )}
          </div>
          <p className="text-xs text-content-muted truncate flex items-center gap-1">
            <svg className="h-3 w-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {search.query || "All files"}
            {search.filters && search.filters !== "{}" && (
              <>
                <span className="text-white/30">|</span>
                <svg className="h-3 w-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                <span>Filtered</span>
              </>
            )}
          </p>
        </div>
      </div>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
        <button onClick={(e) => { e.stopPropagation(); onPin(search); }} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors" title={isPinned ? "Unpin" : "Pin"}>
          {isPinned ? (
            <svg className="h-4 w-4 text-amber-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
          ) : (
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
          )}
        </button>
        <button onClick={(e) => { e.stopPropagation(); onEdit(search); }} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors" title="Edit">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(search); }} className="p-1.5 rounded-lg hover:bg-red-500/10 hover:text-red-400 transition-colors" title="Delete" aria-label={`Delete ${search.name}`}>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
        </button>
      </div>
    </motion.li>
  );
}