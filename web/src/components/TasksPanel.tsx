import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckSquare, Plus, Trash2, RefreshCw, Link2, Unlink,
  Settings2, ChevronDown, CalendarDays, TriangleAlert,
} from "lucide-react";
import { ViewHeader } from "./ui/ViewHeader";
import { Button } from "./ui/Button";
import { useUI } from "../store";
import {
  type TaskItem, type TaskList, connectGoogle, disconnectGoogle,
  isGoogleConnected, getGoogleClientId, setGoogleClientId, getStoredToken,
  preloadGis, describeGoogleError,
  listGoogleTaskLists, listGoogleTasks, createGoogleTask,
  updateGoogleTask, deleteGoogleTask, localTasksStore, newId,
} from "../lib/google";
import { GoogleSettingsModal } from "./GoogleSettingsModal";
import { cn } from "../lib/utils";

const LOCAL_LIST: TaskList = { id: "local", title: "Local tasks", source: "local" };

type Filter = "all" | "active" | "done";

export default function TasksPanel() {
  const pushToast = useUI((s) => s.pushToast);
  const [tasks, setTasks] = useState<TaskItem[]>(() => localTasksStore.load());
  const [lists, setLists] = useState<TaskList[]>([LOCAL_LIST]);
  const [activeList, setActiveList] = useState("local");
  const [filter, setFilter] = useState<Filter>("all");
  const [connected, setConnected] = useState(() => isGoogleConnected());
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [clientId, setClientIdState] = useState(() => getGoogleClientId());
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [listsOpen, setListsOpen] = useState(false);
  const [lastError, setLastError] = useState<{ title: string; detail: string } | null>(null);

  useEffect(() => {
    const onChange = () => setConnected(isGoogleConnected());
    window.addEventListener("nexora-google-changed", onChange);
    return () => window.removeEventListener("nexora-google-changed", onChange);
  }, []);

  // Warm the Google sign-in library so the OAuth popup opens inside the
  // click's user activation instead of being blocked as an unsolicited popup.
  useEffect(() => {
    preloadGis();
  }, []);

  useEffect(() => {
    localTasksStore.save(tasks.filter((t) => t.source === "local"));
  }, [tasks]);

  const syncFromGoogle = useCallback(async (quiet = false) => {
    const tok = getStoredToken();
    if (!tok) return;
    setSyncing(true);
    try {
      const remoteLists = await listGoogleTaskLists(tok.access_token);
      const all: TaskItem[] = [];
      for (const l of remoteLists) {
        try {
          const items = await listGoogleTasks(tok.access_token, l.id);
          all.push(...items);
        } catch {
          // One failing list shouldn't block the rest.
        }
      }
      setLists([LOCAL_LIST, ...remoteLists]);
      setTasks((prev) => [...prev.filter((t) => t.source === "local"), ...all]);
      setActiveList((cur) => (cur === "local" ? remoteLists[0]?.id ?? "local" : cur));
      if (!quiet) pushToast("success", `Synced ${all.length} tasks from Google`);
    } catch (e) {
      const info = describeGoogleError(e);
      if (!quiet || (e instanceof Error && e.message === "google-unauthorized")) setLastError(info);
      if (!quiet) pushToast("error", info.title);
    } finally {
      setSyncing(false);
    }
  }, [pushToast]);

  useEffect(() => {
    if (connected) void syncFromGoogle(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const onConnect = async () => {
    if (!getGoogleClientId()) {
      setShowSettings(true);
      pushToast("error", "Set your Google OAuth client ID first");
      return;
    }
    setConnecting(true);
    setLastError(null);
    try {
      await connectGoogle();
      pushToast("success", "Google Tasks connected");
      void syncFromGoogle(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "auth-failed";
      if (msg === "missing-client-id" || msg === "invalid-client-id") {
        setShowSettings(true);
      } else if (msg !== "auth-cancelled") {
        const info = describeGoogleError(e);
        setLastError(info);
        pushToast("error", info.title);
      }
    } finally {
      setConnecting(false);
    }
  };

  const visible = useMemo(() => {
    let items = tasks.filter((t) => (t.listId ?? "local") === activeList || (activeList === "local" && t.source === "local" && !t.listId));
    if (filter === "active") items = items.filter((t) => !t.completed);
    if (filter === "done") items = items.filter((t) => t.completed);
    return [...items].sort((a, b) => Number(a.completed) - Number(b.completed) || (a.due ?? "").localeCompare(b.due ?? "") || b.updatedAt - a.updatedAt);
  }, [tasks, activeList, filter]);

  const doneCount = tasks.filter((t) => t.completed).length;
  const activeListTitle = lists.find((l) => l.id === activeList)?.title ?? "Tasks";

  const addTask = async () => {
    const name = title.trim();
    if (!name) return;
    const tok = getStoredToken();
    const targetList = lists.find((l) => l.id === activeList);
    if (tok && targetList?.source === "google") {
      try {
        const g = await createGoogleTask(tok.access_token, targetList.id, { title: name, due: due || undefined });
        setTasks((p) => [...p, {
          id: `g-${g.id}`, title: name, due: due || undefined, completed: false,
          googleId: g.id, listId: targetList.id, source: "google", updatedAt: Date.now(),
        }]);
      } catch {
        pushToast("error", "Google task create failed");
        return;
      }
    } else {
      setTasks((p) => [...p, {
        id: newId("task"), title: name, due: due || undefined,
        completed: false, listId: "local", source: "local", updatedAt: Date.now(),
      }]);
    }
    setTitle("");
    setDue("");
  };

  const toggleTask = async (t: TaskItem) => {
    const tok = getStoredToken();
    const next = !t.completed;
    if (t.googleId && t.listId && tok && t.source === "google") {
      try {
        await updateGoogleTask(tok.access_token, t.listId, t.googleId, { completed: next });
      } catch {
        pushToast("error", "Google task update failed");
        return;
      }
    }
    setTasks((p) => p.map((x) => (x.id === t.id ? { ...x, completed: next, updatedAt: Date.now() } : x)));
  };

  const removeTask = async (t: TaskItem) => {
    const tok = getStoredToken();
    if (t.googleId && t.listId && tok && t.source === "google") {
      try {
        await deleteGoogleTask(tok.access_token, t.listId, t.googleId);
      } catch {
        pushToast("error", "Google task delete failed");
        return;
      }
    }
    setTasks((p) => p.filter((x) => x.id !== t.id));
  };

  const overdue = (t: TaskItem) => !!t.due && !t.completed && t.due < new Date().toISOString().slice(0, 10);

  return (
    <div className="flex-1 min-h-0 flex flex-col px-3 sm:px-6 pt-4 pb-6 max-w-3xl w-full mx-auto">
      <ViewHeader
        icon={CheckSquare}
        title="Tasks"
        subtitle={connected ? "Synced with Google Tasks" : "Local tasks — connect Google to sync"}
        badge={
          tasks.length > 0 ? (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border border-border bg-background text-content-muted">
              {tasks.length - doneCount} open · {doneCount} done
            </span>
          ) : undefined
        }
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)} title="Google settings">
              <Settings2 className="h-4 w-4" />
            </Button>
            {connected ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => void syncFromGoogle()} disabled={syncing}>
                  <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
                  <span className="hidden sm:inline">Sync</span>
                </Button>
                <Button
                  variant="ghost" size="sm"
                  onClick={() => {
                    disconnectGoogle();
                    setLists([LOCAL_LIST]);
                    setActiveList("local");
                    setTasks((p) => p.filter((t) => t.source === "local"));
                    setLastError(null);
                  }}
                >
                  <Unlink className="h-4 w-4" />
                  <span className="hidden sm:inline">Disconnect</span>
                </Button>
              </>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => void onConnect()} disabled={connecting}>
                <Link2 className="h-4 w-4" />
                {connecting ? "Connecting…" : "Connect Google"}
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2 w-full pt-1">
          <div className="relative">
            <button
              onClick={() => setListsOpen((o) => !o)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-card text-sm font-medium hover:border-accent/40"
            >
              {activeListTitle}
              <ChevronDown className="h-3.5 w-3.5 text-content-muted" />
            </button>
            {listsOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setListsOpen(false)} />
                <div className="absolute z-40 mt-1 min-w-48 rounded-xl border border-border bg-card shadow-xl p-1">
                  {lists.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => { setActiveList(l.id); setListsOpen(false); }}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-accent/10",
                        l.id === activeList && "bg-accent/10 text-accent font-semibold",
                      )}
                    >
                      {l.title}
                      <span className="ml-2 text-[10px] text-content-muted">{l.source === "google" ? "Google" : "Local"}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="flex rounded-xl border border-border overflow-hidden" role="tablist" aria-label="Task filter">
            {(["all", "active", "done"] as Filter[]).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold capitalize transition-colors",
                  filter === f ? "bg-accent text-primary-foreground" : "text-content-muted hover:text-content",
                )}
              >
                {f === "done" ? "Completed" : f}
              </button>
            ))}
          </div>
        </div>
      </ViewHeader>

      {lastError && (
        <div className="mt-4 rounded-xl border border-danger/40 bg-danger/10 p-3 flex gap-2.5 items-start" role="alert">
          <TriangleAlert className="h-4 w-4 text-danger shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{lastError.title}</p>
            <p className="text-xs text-content-muted mt-0.5">{lastError.detail}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)}>Diagnose</Button>
        </div>
      )}

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => { e.preventDefault(); void addTask(); }}
      >
        <input
          aria-label="New task title"
          className="flex-1 px-3.5 py-2.5 rounded-xl bg-card border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder={`Add a task to ${activeListTitle}…`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          type="date"
          aria-label="Due date"
          title="Due date (optional)"
          className="px-3 py-2.5 rounded-xl bg-card border border-border text-sm text-content-muted focus:outline-none focus:ring-2 focus:ring-accent"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
        <Button type="submit" disabled={!title.trim()} aria-label="Add task" title="Add task">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Add</span>
        </Button>
      </form>

      <div className="mt-3 space-y-2">
        {visible.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border py-10 text-center">
            <CheckSquare className="h-8 w-8 mx-auto text-content-muted/50" />
            <p className="mt-2 text-sm font-semibold">No tasks here</p>
            <p className="text-xs text-content-muted mt-1">
              {filter === "all" ? "Add your first task above." : `Nothing ${filter === "done" ? "completed yet" : "open"} in this list.`}
            </p>
          </div>
        )}
        {visible.map((t) => (
          <div
            key={t.id}
            className={cn(
              "flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 transition-colors",
              t.completed && "opacity-60",
            )}
          >
            <button
              onClick={() => void toggleTask(t)}
              role="checkbox"
              aria-checked={t.completed}
              aria-label={t.completed ? `Mark "${t.title}" as not done` : `Mark "${t.title}" as done`}
              className={cn(
                "grid place-items-center h-5 w-5 rounded-md border-2 shrink-0 transition-colors",
                t.completed ? "bg-emerald-500 border-emerald-500 text-white" : "border-content-muted/40 hover:border-accent",
              )}
            >
              {t.completed && (
                <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path d="M2 6.5 4.8 9 10 3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm font-medium truncate", t.completed && "line-through")}>{t.title}</p>
              <div className="flex items-center gap-2 mt-0.5">
                {t.due && (
                  <span className={cn(
                    "inline-flex items-center gap-1 text-[11px]",
                    overdue(t) ? "text-danger font-semibold" : "text-content-muted",
                  )}>
                    <CalendarDays className="h-3 w-3" />
                    {new Date(`${t.due}T12:00`).toLocaleDateString([], { month: "short", day: "numeric" })}
                    {overdue(t) && " · overdue"}
                  </span>
                )}
                {t.source === "google" && <span className="text-[10px] text-content-muted">Google</span>}
              </div>
            </div>
            <button
              onClick={() => void removeTask(t)}
              className="p-2 rounded-lg text-content-muted hover:text-danger hover:bg-danger/10 shrink-0"
              title="Delete task"
              aria-label={`Delete "${t.title}"`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      {showSettings && (
        <GoogleSettingsModal
          onClose={() => setShowSettings(false)}
          clientId={clientId}
          lastError={lastError}
          onSaved={(v) => {
            setClientIdState(v);
            setGoogleClientId(v);
            setShowSettings(false);
            setLastError(null);
            preloadGis();
            pushToast("success", "Google client ID saved");
          }}
        />
      )}
    </div>
  );
}
