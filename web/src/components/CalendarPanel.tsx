import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus,
  MapPin, RefreshCw, Link2, Unlink, Settings2, Trash2, Pencil, TriangleAlert,
} from "lucide-react";
import { ViewHeader } from "./ui/ViewHeader";
import { Button } from "./ui/Button";
import { Modal } from "./Modal";
import { GoogleSettingsModal } from "./GoogleSettingsModal";
import { useUI } from "../store";
import {
  type CalEvent, connectGoogle, disconnectGoogle, isGoogleConnected,
  getGoogleClientId, setGoogleClientId, getStoredToken, preloadGis,
  describeGoogleError,
  listGoogleEvents, createGoogleEvent, updateGoogleEvent, deleteGoogleEvent,
  localEventsStore, newId,
} from "../lib/google";
import { cn } from "../lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function eventDay(ev: CalEvent): string {
  return ev.start.slice(0, 10);
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** First visible Monday of the month grid + all 42 cells. */
function monthCells(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-first
  const start = new Date(year, month, 1 - lead);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

interface Draft {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location: string;
  description: string;
}

const emptyDraft = (date: string): Draft => ({
  title: "", date, startTime: "09:00", endTime: "10:00",
  allDay: false, location: "", description: "",
});

export default function CalendarPanel() {
  const pushToast = useUI((s) => s.pushToast);
  const [events, setEvents] = useState<CalEvent[]>(() => localEventsStore.load());
  const [connected, setConnected] = useState(() => isGoogleConnected());
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [clientId, setClientIdState] = useState(() => getGoogleClientId());
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });
  const [selected, setSelected] = useState(() => dayKey(new Date()));
  const [editing, setEditing] = useState<{ draft: Draft; id?: string } | null>(null);
  const [saving, setSaving] = useState(false);
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
    localEventsStore.save(events.filter((e) => e.source === "local"));
  }, [events]);

  const syncFromGoogle = useCallback(async (quiet = false) => {
    const tok = getStoredToken();
    if (!tok) return;
    setSyncing(true);
    try {
      const first = new Date(cursor.y, cursor.m, 1);
      const timeMin = new Date(first.getFullYear(), first.getMonth() - 1, 1).toISOString();
      const timeMax = new Date(first.getFullYear(), first.getMonth() + 2, 0).toISOString();
      const remote = await listGoogleEvents(tok.access_token, timeMin, timeMax);
      setEvents((prev) => {
        const local = prev.filter((e) => e.source === "local");
        // Merge: remote wins for ids it owns; keep locals outside window too.
        const remoteIds = new Set(remote.map((e) => e.googleId));
        const staleLocal = prev.filter((e) => e.source === "google" && !remoteIds.has(e.googleId));
        void staleLocal;
        return [...local, ...remote];
      });
      if (!quiet) pushToast("success", `Synced ${remote.length} events from Google`);
    } catch (e) {
      const info = describeGoogleError(e);
      if (!quiet || (e instanceof Error && e.message === "google-unauthorized")) setLastError(info);
      if (!quiet) pushToast("error", info.title);
    } finally {
      setSyncing(false);
    }
  }, [cursor.y, cursor.m, pushToast]);

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
      pushToast("success", "Google Calendar connected");
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

  const cells = useMemo(() => monthCells(cursor.y, cursor.m), [cursor.y, cursor.m]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const ev of events) {
      const k = eventDay(ev);
      if (!k) continue;
      const arr = m.get(k) ?? [];
      arr.push(ev);
      m.set(k, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.start.localeCompare(b.start));
    return m;
  }, [events]);

  const selectedEvents = byDay.get(selected) ?? [];
  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleDateString([], { month: "long", year: "numeric" });
  const today = dayKey(new Date());

  const openNew = () => setEditing({ draft: emptyDraft(selected) });
  const openEdit = (ev: CalEvent) => {
    const date = eventDay(ev);
    setEditing({
      id: ev.id,
      draft: {
        title: ev.title,
        date,
        startTime: ev.dateOnly ? "09:00" : ev.start.slice(11, 16) || "09:00",
        endTime: ev.dateOnly ? "10:00" : ev.end.slice(11, 16) || "10:00",
        allDay: !!ev.dateOnly,
        location: ev.location ?? "",
        description: ev.description ?? "",
      },
    });
  };

  const saveEvent = async () => {
    if (!editing || saving) return;
    const d = editing.draft;
    if (!d.title.trim() || !d.date) {
      pushToast("error", "Title and date are required");
      return;
    }
    setSaving(true);
    try {
      const start = d.allDay ? `${d.date}T00:00` : `${d.date}T${d.startTime}`;
      const end = d.allDay ? `${d.date}T00:00` : `${d.date}T${d.endTime || d.startTime}`;
      const tok = getStoredToken();
      if (editing.id) {
        const prev = events.find((e) => e.id === editing.id);
        if (!prev) return;
        const next: CalEvent = {
          ...prev, title: d.title.trim(), start, end,
          dateOnly: d.allDay, location: d.location.trim() || undefined,
          description: d.description.trim() || undefined, updatedAt: Date.now(),
        };
        if (prev.googleId && tok) {
          const g = await updateGoogleEvent(tok.access_token, prev.googleId, next);
          next.googleId = g.id;
          next.source = "google";
        }
        setEvents((evts) => evts.map((e) => (e.id === prev.id ? next : e)));
        pushToast("success", "Event updated");
      } else {
        let ev: CalEvent = {
          id: newId("ev"), title: d.title.trim(), start, end,
          dateOnly: d.allDay, location: d.location.trim() || undefined,
          description: d.description.trim() || undefined,
          source: "local", updatedAt: Date.now(),
        };
        if (tok) {
          try {
            const g = await createGoogleEvent(tok.access_token, ev);
            ev = { ...ev, googleId: g.id, source: "google" };
          } catch {
            pushToast("error", "Saved locally — Google write failed");
          }
        }
        setEvents((evts) => [...evts, ev]);
        pushToast("success", "Event created");
      }
      setEditing(null);
    } catch {
      pushToast("error", "Could not save event");
    } finally {
      setSaving(false);
    }
  };

  const removeEvent = async (ev: CalEvent) => {
    const tok = getStoredToken();
    if (ev.googleId && tok) {
      try {
        await deleteGoogleEvent(tok.access_token, ev.googleId);
      } catch {
        pushToast("error", "Google delete failed");
        return;
      }
    }
    setEvents((evts) => evts.filter((e) => e.id !== ev.id));
    pushToast("success", "Event deleted");
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col px-3 sm:px-6 pt-4 pb-6 max-w-6xl w-full mx-auto">
      <ViewHeader
        icon={CalendarIcon}
        title="Calendar"
        subtitle={connected ? "Synced with Google Calendar" : "Local calendar — connect Google to sync"}
        badge={
          <span className={cn(
            "text-[11px] font-semibold px-2 py-0.5 rounded-full border",
            connected ? "text-emerald-600 border-emerald-500/30 bg-emerald-500/10"
              : "text-content-muted border-border bg-background",
          )}>
            {connected ? "Google connected" : "Local only"}
          </span>
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
                <Button variant="ghost" size="sm" onClick={() => { disconnectGoogle(); setEvents((p) => p.filter((e) => e.source === "local")); setLastError(null); }}>
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
            <Button size="sm" onClick={openNew}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New event</span>
            </Button>
          </>
        }
      />

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

      <div className="flex items-center gap-2 mt-4 mb-3">
        <Button variant="ghost" size="sm" onClick={() => setCursor((c) => ({ y: c.m === 0 ? c.y - 1 : c.y, m: (c.m + 11) % 12 }))} aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-base font-bold tracking-tight min-w-40 text-center">{monthLabel}</h2>
        <Button variant="ghost" size="sm" onClick={() => setCursor((c) => ({ y: c.m === 11 ? c.y + 1 : c.y, m: (c.m + 1) % 12 }))} aria-label="Next month">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost" size="sm" className="ml-1"
          onClick={() => { const n = new Date(); setCursor({ y: n.getFullYear(), m: n.getMonth() }); setSelected(dayKey(n)); }}
        >
          Today
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-border">
            {WEEKDAYS.map((w) => (
              <div key={w} className="py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-content-muted">{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d, i) => {
              const k = dayKey(d);
              const inMonth = d.getMonth() === cursor.m;
              const list = byDay.get(k) ?? [];
              const isSel = k === selected;
              const isToday = k === today;
              return (
                <button
                  key={i}
                  onClick={() => setSelected(k)}
                  className={cn(
                    "min-h-[76px] sm:min-h-[92px] p-1.5 text-left border-b border-r border-border/60 align-top transition-colors",
                    "nth-[7n]:border-r-0",
                    !inMonth && "opacity-40",
                    isSel ? "bg-accent/10" : "hover:bg-accent/5",
                  )}
                >
                  <span className={cn(
                    "inline-grid place-items-center h-6 w-6 rounded-full text-xs font-semibold",
                    isToday ? "bg-accent text-primary-foreground" : "text-content",
                  )}>
                    {d.getDate()}
                  </span>
                  <span className="mt-1 hidden sm:flex flex-col gap-0.5">
                    {list.slice(0, 3).map((ev) => (
                      <span key={ev.id} className="truncate rounded px-1.5 py-0.5 text-[11px] font-medium bg-accent/15 text-accent">
                        {ev.dateOnly ? ev.title : `${fmtTime(ev.start)} ${ev.title}`}
                      </span>
                    ))}
                    {list.length > 3 && <span className="text-[10px] text-content-muted px-1">+{list.length - 3} more</span>}
                  </span>
                  {list.length > 0 && (
                    <span className="mt-1 flex gap-1 sm:hidden">
                      {list.slice(0, 3).map((ev) => (
                        <span key={ev.id} className="h-1.5 w-1.5 rounded-full bg-accent" />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 h-fit">
          <h3 className="font-bold text-sm">
            {new Date(`${selected}T12:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
          </h3>
          <p className="text-xs text-content-muted mt-0.5">{selectedEvents.length} event{selectedEvents.length === 1 ? "" : "s"}</p>
          <div className="mt-3 space-y-2">
            {selectedEvents.length === 0 && (
              <p className="text-sm text-content-muted py-4 text-center">No events — enjoy the empty day.</p>
            )}
            {selectedEvents.map((ev) => (
              <div key={ev.id} className="rounded-xl border border-border p-3 group">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm truncate">{ev.title}</p>
                    <p className="text-xs text-content-muted mt-0.5">
                      {ev.dateOnly ? "All day" : `${fmtTime(ev.start)} – ${fmtTime(ev.end)}`}
                      {ev.source === "google" ? " · Google" : " · Local"}
                    </p>
                    {ev.location && (
                      <p className="text-xs text-content-muted mt-1 flex items-center gap-1 truncate">
                        <MapPin className="h-3 w-3 shrink-0" /> {ev.location}
                      </p>
                    )}
                    {ev.description && <p className="text-xs text-content-muted mt-1 line-clamp-2">{ev.description}</p>}
                  </div>
                  <div className="flex shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(ev)} className="p-1.5 rounded-lg hover:bg-accent/10" title="Edit" aria-label="Edit event">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => void removeEvent(ev)} className="p-1.5 rounded-lg hover:bg-danger/10 hover:text-danger" title="Delete" aria-label="Delete event">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <Button variant="secondary" size="sm" className="w-full" onClick={openNew}>
              <Plus className="h-4 w-4" /> Add event
            </Button>
          </div>
        </div>
      </div>

      {editing && (
        <Modal onClose={() => setEditing(null)} title={editing.id ? "Edit event" : "New event"}>
          <div className="space-y-3 min-w-[min(420px,80vw)]">
            <input
              autoFocus
              className="w-full px-3 py-2 rounded-xl bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="Event title"
              value={editing.draft.title}
              onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, title: e.target.value } })}
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-content-muted">Date
                <input
                  type="date"
                  className="mt-1 w-full px-3 py-2 rounded-xl bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  value={editing.draft.date}
                  onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, date: e.target.value } })}
                />
              </label>
              <label className="text-xs text-content-muted flex items-end gap-2 pb-2">
                <input
                  type="checkbox"
                  checked={editing.draft.allDay}
                  onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, allDay: e.target.checked } })}
                />
                All day
              </label>
            </div>
            {!editing.draft.allDay && (
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-content-muted">Start
                  <input
                    type="time"
                    className="mt-1 w-full px-3 py-2 rounded-xl bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    value={editing.draft.startTime}
                    onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, startTime: e.target.value } })}
                  />
                </label>
                <label className="text-xs text-content-muted">End
                  <input
                    type="time"
                    className="mt-1 w-full px-3 py-2 rounded-xl bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    value={editing.draft.endTime}
                    onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, endTime: e.target.value } })}
                  />
                </label>
              </div>
            )}
            <input
              className="w-full px-3 py-2 rounded-xl bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="Location (optional)"
              value={editing.draft.location}
              onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, location: e.target.value } })}
            />
            <textarea
              rows={3}
              className="w-full px-3 py-2 rounded-xl bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent resize-none"
              placeholder="Description (optional)"
              value={editing.draft.description}
              onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, description: e.target.value } })}
            />
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
              <Button size="sm" onClick={() => void saveEvent()} disabled={saving}>
                {saving ? "Saving…" : editing.id ? "Save changes" : "Create event"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

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
