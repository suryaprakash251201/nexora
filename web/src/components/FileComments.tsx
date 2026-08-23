import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Send, Trash2, Loader2 } from "lucide-react";
import { filesApi } from "../api/endpoints";
import { useUI } from "../store";
import { formatRelative } from "../lib/format";
/**
 * Discussion thread attached to a file/folder path (root-scoped).
 * Anyone with read access can comment; authors and admins can delete.
 */
export function FileComments({ rootId, path, currentUserId, isAdmin }: { rootId: string; path: string; currentUserId?: string; isAdmin?: boolean }) {
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);

  const comments = useQuery({
    queryKey: ["comments", rootId, path],
    queryFn: () => filesApi.comments.list(rootId, path),
    select: (d) => d.items,
  });

  const post = async () => {
    const body = text.trim();
    if (!body) return;
    setPosting(true);
    try {
      await filesApi.comments.add(rootId, path, body);
      setText("");
      await qc.invalidateQueries({ queryKey: ["comments", rootId, path] });
    } catch (e: any) {
      pushToast("error", e.message || "Could not post comment");
    } finally {
      setPosting(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await filesApi.comments.remove(id);
      await qc.invalidateQueries({ queryKey: ["comments", rootId, path] });
    } catch (e: any) {
      pushToast("error", e.message || "Delete failed");
    }
  };

  return (
    <div className="p-4 space-y-3">
      {/* Composer */}
      <div className="flex items-start gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void post();
          }}
          placeholder="Add a note… (Ctrl+Enter to post)"
          rows={2}
          maxLength={2000}
          className="glass-input w-full rounded-xl px-3 py-2 text-sm resize-none"
        />
        <button
          onClick={() => void post()}
          disabled={!text.trim() || posting}
          aria-label="Post comment"
          className="shrink-0 p-2 rounded-xl bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 disabled:opacity-40 transition-colors"
        >
          {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>

      {/* Thread */}
      {!comments.data?.length ? (
        <div className="flex flex-col items-center py-6 text-content-muted">
          <MessageSquare className="h-5 w-5 mb-1.5 opacity-60" />
          <p className="text-xs">No comments yet.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {comments.data.map((c) => (
            <li key={c.id} className="rounded-xl border border-glass-border bg-glass-bg-subtle px-3 py-2.5">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-text-secondary">{c.username || "user"}</span>
                <span className="text-[10px] text-content-muted/70">{formatRelative(c.created_at) || c.created_at}</span>
                {(isAdmin || (currentUserId && c.user_id === currentUserId)) && (
                  <button
                    onClick={() => void remove(c.id)}
                    aria-label="Delete comment"
                    className="ml-auto p-1 rounded-md text-content-muted hover:text-danger hover:bg-danger/10 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <p className="text-sm text-content whitespace-pre-wrap break-words">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
