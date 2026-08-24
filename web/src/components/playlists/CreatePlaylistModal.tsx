import { useEffect, useRef, useState } from "react";
import { ListMusic, ImagePlus } from "lucide-react";
import { Modal } from "../Modal";
import { Button } from "../ui/Button";
import CoverPickerModal from "../CoverPickerModal";
import { useUI } from "../../store";
import { thumbUrl } from "../../lib/preview";

const NAME_MAX = 200;
const DESC_MAX = 2000;

export interface CreatePlaylistResult {
  id: string;
  name: string;
}

/**
 * Redesigned "Create playlist" dialog.
 *
 * - Live preview of how the playlist card will look (cover + name)
 * - Optional description and cover image
 * - Explicit error surface: server failures show an inline banner instead of
 *   silently leaving the dialog open (the old behavior made the button look dead)
 * - Enter submits, Esc cancels via Modal, submit shows loading state
 */
export default function CreatePlaylistModal({
  onClose,
  onCreated,
  onCreate, // async (name, description, cover) => Promise<CreatePlaylistResult>
}: {
  onClose: () => void;
  onCreated?: (pl: CreatePlaylistResult) => void;
  onCreate: (payload: { name: string; description: string; coverRootId?: string; coverPath?: string }) => Promise<CreatePlaylistResult>;
}) {
  const pushToast = useUI((s) => s.pushToast);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cover, setCover] = useState<{ rootId: string; path: string } | null>(null);
  const [coverPicker, setCoverPicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const canSubmit = name.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const pl = await onCreate({
        name: name.trim(),
        description: description.trim(),
        coverRootId: cover?.rootId,
        coverPath: cover?.path,
      });
      pushToast("success", `Playlist "${pl.name}" created`);
      onCreated?.(pl);
      onClose();
    } catch (e: any) {
      // Surface the failure inside the dialog so the user can retry without losing their input.
      setError(e?.message || "Could not create the playlist. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Modal
        title="Create playlist"
        description="Group audio files from your workspace into a playable list."
        icon={<ListMusic className="h-5 w-5 text-accent" />}
        onClose={() => { if (!submitting) onClose(); }}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button variant="primary" size="md" onClick={submit} loading={submitting} disabled={!name.trim()}>
              Create Playlist
            </Button>
          </>
        }
      >
        <form
          className="space-y-4"
          onSubmit={(e) => { e.preventDefault(); submit(); }}
        >
          {/* Live card preview */}
          <div className="flex items-center gap-3.5 p-3 rounded-xl bg-surface-muted/40 border border-border/40">
            <button
              type="button"
              onClick={() => setCoverPicker(true)}
              className="relative h-16 w-16 shrink-0 rounded-lg overflow-hidden ring-1 ring-white/10 group/cover outline-none focus-visible:ring-2 focus-visible:ring-accent"
              title={cover ? "Change cover image" : "Choose a cover image"}
            >
              {cover ? (
                <img
                  src={thumbUrl({ root_id: cover.rootId, path: cover.path, name: "", extension: "", mime: "image/jpeg", is_dir: false, size: 0, modified: "" })}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="h-full w-full grid place-items-center bg-gradient-to-br from-accent/40 via-purple-500/30 to-pink-500/20">
                  <ListMusic className="h-6 w-6 text-white/80" />
                </span>
              )}
              <span className="absolute inset-0 grid place-items-center bg-black/50 opacity-0 group-hover/cover:opacity-100 transition-opacity">
                <ImagePlus className="h-5 w-5 text-white" />
              </span>
            </button>
            <div className="min-w-0">
              <p className={`font-semibold truncate ${name.trim() ? "" : "text-content-muted"}`}>
                {name.trim() || "Untitled playlist"}
              </p>
              <p className="text-xs text-content-muted truncate">
                {description.trim() ? description : "No description yet"}
              </p>
              <p className="text-[11px] text-content-muted/70 mt-1 flex items-center gap-1">
                <ImagePlus className="h-3 w-3" /> Click the artwork to pick a cover
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="playlist-name" className="text-xs font-bold text-content-muted uppercase tracking-wider">
              Name <span className="text-danger">*</span>
            </label>
            <input
              id="playlist-name"
              ref={nameRef}
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Late night coding"
              autoComplete="off"
              className="w-full rounded-lg glass-input px-3 py-2 outline-none text-sm"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
            />
            <div className="flex justify-between text-[11px] text-content-muted/70">
              <span>Required</span>
              <span className={name.length >= NAME_MAX ? "text-warning" : ""}>{name.length}/{NAME_MAX}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="playlist-desc" className="text-xs font-bold text-content-muted uppercase tracking-wider">
              Description
            </label>
            <textarea
              id="playlist-desc"
              value={description}
              maxLength={DESC_MAX}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this playlist for? (optional)"
              rows={3}
              className="w-full rounded-lg glass-input px-3 py-2 outline-none text-sm resize-none"
            />
            <div className="flex justify-end text-[11px] text-content-muted/70">
              <span>{description.length}/{DESC_MAX}</span>
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger animate-fade-in">
              {error}
            </div>
          )}
        </form>
      </Modal>
      {coverPicker && (
        <CoverPickerModal
          onClose={() => setCoverPicker(false)}
          onConfirm={(rootId, path) => {
            setCover({ rootId, path });
            setCoverPicker(false);
          }}
        />
      )}
    </>
  );
}
