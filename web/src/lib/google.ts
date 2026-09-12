/**
 * Google integration — Calendar + Tasks sync for Nexora.
 *
 * Design: frontend-direct OAuth via Google Identity Services (token flow,
 * no client secret — suitable for a self-hosted app). The OAuth access
 * token lives in memory + sessionStorage; the Google OAuth *client ID* is
 * resolved from `VITE_GOOGLE_CLIENT_ID` with a per-browser localStorage
 * override set in the Calendar/Tasks settings UI.
 *
 * When not connected, Calendar/Tasks work as local-only lists persisted
 * in localStorage. When connected, reads/writes go to the Google REST
 * APIs and local items are kept as an offline cache.
 */

export interface CalEvent {
  id: string;
  title: string;
  description?: string;
  location?: string;
  /** Local datetime string "YYYY-MM-DDTHH:mm" (all-day when dateOnly). */
  start: string;
  end: string;
  dateOnly?: boolean;
  /** Google event id when synced. */
  googleId?: string;
  source: "local" | "google";
  updatedAt: number;
}

export interface TaskItem {
  id: string;
  title: string;
  notes?: string;
  due?: string; // "YYYY-MM-DD"
  completed: boolean;
  googleId?: string;
  listId?: string;
  source: "local" | "google";
  updatedAt: number;
}

export interface TaskList {
  id: string;
  title: string;
  source: "local" | "google";
}

export const GOOGLE_SCOPES =
  "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks";

const CLIENT_ID_KEY = "nexora-google-client-id";
const TOKEN_KEY = "nexora-google-token";
const LOCAL_EVENTS_KEY = "nexora-local-events";
const LOCAL_TASKS_KEY = "nexora-local-tasks";

interface StoredToken {
  access_token: string;
  expires_at: number;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: {
            client_id: string;
            scope: string;
            callback: (resp: { access_token?: string; expires_in?: number; error?: string }) => void;
          }) => { requestAccessToken: (opts?: { prompt?: string }) => void };
        };
      };
    };
  }
  interface ImportMetaEnv {
    readonly VITE_GOOGLE_CLIENT_ID?: string;
  }
}

// ── Client ID ─────────────────────────────────────────────────────────────

export function getGoogleClientId(): string {
  try {
    const override = localStorage.getItem(CLIENT_ID_KEY);
    if (override?.trim()) return override.trim();
  } catch { /* ignore */ }
  try {
    return import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";
  } catch {
    return "";
  }
}

export function setGoogleClientId(id: string) {
  try {
    if (id.trim()) localStorage.setItem(CLIENT_ID_KEY, id.trim());
    else localStorage.removeItem(CLIENT_ID_KEY);
  } catch { /* ignore */ }
}

// ── Token store ───────────────────────────────────────────────────────────

export function getStoredToken(): StoredToken | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as StoredToken;
    if (!t.access_token || t.expires_at < Date.now() + 60_000) return null;
    return t;
  } catch {
    return null;
  }
}

export function isGoogleConnected(): boolean {
  return getStoredToken() !== null;
}

export function disconnectGoogle() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent("nexora-google-changed"));
}

function storeToken(accessToken: string, expiresInSec: number, remember: boolean) {
  const payload: StoredToken = {
    access_token: accessToken,
    expires_at: Date.now() + expiresInSec * 1000,
  };
  try {
    (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, JSON.stringify(payload));
    // Clear the other store so a stale token can't shadow the fresh one.
    (remember ? sessionStorage : localStorage).removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent("nexora-google-changed"));
}

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-nexora-gis]');
    if (existing) {
      // A previous attempt may have left a dead tag behind (e.g. blocked
      // by CSP/ad-blocker — script has no window.google but will never
      // fire load/error again). Drop it and inject a fresh one so a
      // retry after fixing the cause can succeed.
      if (existing.dataset.nexoraGisFailed === "1") existing.remove();
      else {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => {
          existing.dataset.nexoraGisFailed = "1";
          reject(new Error("gis-blocked"));
        }, { once: true });
        // If the tag already finished without producing window.google
        // (blocked silently by CSP), fail fast instead of hanging.
        if (existing.dataset.nexoraGisDone === "1" && !window.google?.accounts?.oauth2) {
          reject(new Error("gis-blocked"));
        }
        return;
      }
    }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.dataset.nexoraGis = "1";
    s.onload = () => {
      s.dataset.nexoraGisDone = "1";
      // CSP-blocked scripts can fire load without initializing.
      if (window.google?.accounts?.oauth2) resolve();
      else {
        s.dataset.nexoraGisFailed = "1";
        reject(new Error("gis-blocked"));
      }
    };
    s.onerror = () => {
      s.dataset.nexoraGisFailed = "1";
      reject(new Error("gis-blocked"));
    };
    document.head.appendChild(s);
  });
}

/**
 * Warm-load the Google sign-in library ahead of the click. The OAuth popup
 * must open inside the click's user activation, so the script has to be
 * already cached — otherwise the download delay expires the activation and
 * the browser silently blocks the popup. Safe to call repeatedly.
 */
export function preloadGis(): void {
  loadGis().catch(() => {});
}

/** Loose client-ID shape check: `<digits>-<id>.apps.googleusercontent.com`. */
export function isClientIdFormatValid(id: string): boolean {
  return /^\d+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(id.trim());
}

/** Short diagnostic snapshot for the settings UI. */
export function getGoogleDiagnostics() {
  const clientId = getGoogleClientId();
  return {
    origin: window.location.origin,
    clientIdSet: clientId.length > 0,
    clientIdValid: clientId.length > 0 && isClientIdFormatValid(clientId),
    clientIdSuffix: clientId.length > 12 ? `…${clientId.slice(-12)}` : clientId || "(none)",
    gisLoaded: !!window.google?.accounts?.oauth2,
    connected: isGoogleConnected(),
  };
}

export async function connectGoogle(opts?: { remember?: boolean }): Promise<string> {
  const clientId = getGoogleClientId();
  if (!clientId) throw new Error("missing-client-id");
  if (!isClientIdFormatValid(clientId)) throw new Error("invalid-client-id");
  await loadGis();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new Error("gis-unavailable");
  return new Promise((resolve, reject) => {
    let settled = false;
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPES,
      callback: (resp) => {
        if (settled) return;
        settled = true;
        if (resp.error || !resp.access_token) {
          // Preserve the raw GIS code (popup_closed_by_user,
          // access_denied, …) so the UI can explain the exact cause.
          reject(new Error(resp.error ? `google-${resp.error}` : "auth-failed"));
          return;
        }
        storeToken(resp.access_token, resp.expires_in ?? 3600, opts?.remember ?? true);
        resolve(resp.access_token);
      },
    });
    try {
      client.requestAccessToken({ prompt: "consent" });
    } catch (e) {
      settled = true;
      reject(e instanceof Error ? e : new Error("auth-failed"));
    }
    // If the popup is dismissed, GIS never calls back — time out instead
    // of hanging the UI forever.
    setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("auth-cancelled"));
      }
    }, 120_000);
  });
}

/**
 * Maps a connect/sync failure to a title + actionable detail. Every code
 * the UI can produce is covered so users never see a bare "sign-in failed".
 */
export function describeGoogleError(err: unknown): { title: string; detail: string } {
  const code = err instanceof Error ? err.message : String(err);
  const origin = typeof window !== "undefined" ? window.location.origin : "(unknown origin)";
  switch (true) {
    case code === "missing-client-id":
      return {
        title: "No Google client ID",
        detail: "Paste your OAuth client ID in Settings first (gear icon).",
      };
    case code === "invalid-client-id":
      return {
        title: "Client ID looks wrong",
        detail: "It must look like 123…-abc….apps.googleusercontent.com — a client secret or API key won't work here.",
      };
    case code === "gis-blocked":
      return {
        title: "Google library blocked",
        detail:
          "accounts.google.com/gsi/client could not load. Disable ad-blockers for this site, allow https://accounts.google.com in any script blocker, and open the browser console — a 'violates Content-Security-Policy' error means the server is an older Nexora build: update/rebuild (the server must allow Google in its CSP) and hard-reload. On desktop rebuild the app so the updated security policy applies.",
      };
    case code === "gis-unavailable":
      return {
        title: "Google library failed to start",
        detail: "The sign-in script loaded but did not initialize. Reload the page and try again.",
      };
    case code === "auth-cancelled":
      return {
        title: "Sign-in window closed",
        detail: "The Google popup was dismissed before finishing. Click Connect again and complete the consent screen — and allow popups for this site.",
      };
    case code === "google-popup_closed_by_user":
      return {
        title: "Sign-in window closed",
        detail: "You closed the Google window before granting access. Click Connect again and choose Allow on the consent screen.",
      };
    case code === "google-access_denied":
      return {
        title: "Access denied by Google",
        detail: "The account refused consent, or (if your OAuth app is in Testing mode) the account isn't listed under Audience → Test users. Add it as a test user or publish the app.",
      };
    case code === "google-invalid_request" ||
      code === "google-origin_mismatch" ||
      code === "google-redirect_uri_mismatch" ||
      code === "google-idpiframe_initialization_failed":
      return {
        title: "Origin not allowed for this client ID",
        detail: `Google rejected ${origin} as an unauthorized JavaScript origin (Error 400). Under Credentials → your client ID → Authorized JavaScript origins add it EXACTLY — scheme + host + port, no trailing slash. If Google Console itself refuses the URL with "must end with a public top-level domain", it is rejecting a bare IP: http://10.10.10.3:8080 can never be saved. Open Nexora as http://10.10.10.3.nip.io:8080 instead (resolves to the same server, ends in .io so Google accepts it) and allowlist that, or tunnel with ssh -L 8080:localhost:8080 and use http://localhost:8080. For HTTPS origins allowlist the https:// URL. Wait ~5 min after saving, then hard-reload and Connect again.`,
      };
    case code === "google-unauthorized":
      return {
        title: "Google session expired",
        detail: "Reconnect — the stored access token is no longer valid.",
      };
    case code.startsWith("google-error-403"):
      return {
        title: "Google refused the request (403)",
        detail: "Usually the Calendar/Tasks API isn't enabled for this project, or a Testing-mode app is blocking this account. Enable both APIs and check test users.",
      };
    case code.startsWith("google-error-"):
      return {
        title: `Google request failed (${code.replace("google-error-", "")})`,
        detail: "Check your connection and try Sync again. If it persists, reconnect.",
      };
    case code.startsWith("google-"):
      return {
        title: "Google sign-in failed",
        detail: `Google reported: ${code.replace(/^google-/, "")}. If the popup showed Error 400, add ${origin} under Authorized JavaScript origins for this client ID.`,
      };
    default:
      return {
        title: "Google sign-in failed",
        detail: err instanceof Error && err.message ? err.message : "Unknown error — try again.",
      };
  }
}

// ── REST helper ───────────────────────────────────────────────────────────

async function gfetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://www.googleapis.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    disconnectGoogle();
    throw new Error("google-unauthorized");
  }
  if (!res.ok) throw new Error(`google-error-${res.status}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ── Calendar API ──────────────────────────────────────────────────────────

interface GCalDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}
interface GCalItem {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GCalDateTime;
  end?: GCalDateTime;
  updated?: string;
}

function toLocalInput(dt?: GCalDateTime): { start: string; dateOnly: boolean } {
  if (!dt) return { start: "", dateOnly: false };
  if (dt.date) return { start: `${dt.date}T00:00`, dateOnly: true };
  const d = new Date(dt.dateTime ?? "");
  if (Number.isNaN(d.getTime())) return { start: "", dateOnly: false };
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    start: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
    dateOnly: false,
  };
}

export function fromGoogleEvent(g: GCalItem): CalEvent {
  const s = toLocalInput(g.start);
  const e = toLocalInput(g.end);
  return {
    id: `g-${g.id ?? Math.random().toString(36).slice(2)}`,
    title: g.summary || "(No title)",
    description: g.description,
    location: g.location,
    start: s.start,
    end: e.start || s.start,
    dateOnly: s.dateOnly,
    googleId: g.id,
    source: "google",
    updatedAt: g.updated ? Date.parse(g.updated) : Date.now(),
  };
}

export async function listGoogleEvents(token: string, timeMin: string, timeMax: string): Promise<CalEvent[]> {
  const q = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "100",
  });
  const data = await gfetch<{ items?: GCalItem[] }>(`/calendar/v3/calendars/primary/events?${q}`, token);
  return (data.items ?? []).map(fromGoogleEvent);
}

function eventPayload(ev: { title: string; description?: string; location?: string; start: string; end: string; dateOnly?: boolean }) {
  const start: GCalDateTime = ev.dateOnly
    ? { date: ev.start.slice(0, 10) }
    : { dateTime: new Date(ev.start).toISOString() };
  const end: GCalDateTime = ev.dateOnly
    ? { date: ev.end.slice(0, 10) }
    : { dateTime: new Date(ev.end || ev.start).toISOString() };
  return { summary: ev.title, description: ev.description, location: ev.location, start, end };
}

export async function createGoogleEvent(token: string, ev: CalEvent): Promise<GCalItem> {
  return gfetch<GCalItem>("/calendar/v3/calendars/primary/events", token, {
    method: "POST",
    body: JSON.stringify(eventPayload(ev)),
  });
}

export async function updateGoogleEvent(token: string, googleId: string, ev: CalEvent): Promise<GCalItem> {
  return gfetch<GCalItem>(`/calendar/v3/calendars/primary/events/${encodeURIComponent(googleId)}`, token, {
    method: "PATCH",
    body: JSON.stringify(eventPayload(ev)),
  });
}

export async function deleteGoogleEvent(token: string, googleId: string): Promise<void> {
  await gfetch<void>(`/calendar/v3/calendars/primary/events/${encodeURIComponent(googleId)}`, token, {
    method: "DELETE",
  });
}

// ── Tasks API ─────────────────────────────────────────────────────────────

interface GTaskList {
  id?: string;
  title?: string;
}
interface GTask {
  id?: string;
  title?: string;
  notes?: string;
  due?: string;
  status?: string;
  updated?: string;
}

export async function listGoogleTaskLists(token: string): Promise<TaskList[]> {
  const data = await gfetch<{ items?: GTaskList[] }>("/tasks/v1/users/@me/lists", token);
  return (data.items ?? []).map((l) => ({
    id: l.id ?? "@default",
    title: l.title || "My Tasks",
    source: "google" as const,
  }));
}

export function fromGoogleTask(g: GTask, listId: string): TaskItem {
  return {
    id: `g-${g.id ?? Math.random().toString(36).slice(2)}`,
    title: g.title || "(No title)",
    notes: g.notes,
    due: g.due ? g.due.slice(0, 10) : undefined,
    completed: g.status === "completed",
    googleId: g.id,
    listId,
    source: "google",
    updatedAt: g.updated ? Date.parse(g.updated) : Date.now(),
  };
}

export async function listGoogleTasks(token: string, listId: string): Promise<TaskItem[]> {
  const q = new URLSearchParams({ showCompleted: "true", showHidden: "true", maxResults: "100" });
  const data = await gfetch<{ items?: GTask[] }>(
    `/tasks/v1/lists/${encodeURIComponent(listId)}/tasks?${q}`,
    token,
  );
  return (data.items ?? []).map((t) => fromGoogleTask(t, listId));
}

export async function createGoogleTask(
  token: string,
  listId: string,
  t: { title: string; notes?: string; due?: string },
): Promise<GTask> {
  return gfetch<GTask>(`/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`, token, {
    method: "POST",
    body: JSON.stringify({ title: t.title, notes: t.notes, due: t.due ? `${t.due}T00:00:00.000Z` : undefined }),
  });
}

export async function updateGoogleTask(
  token: string,
  listId: string,
  googleId: string,
  patch: { title?: string; notes?: string; due?: string | null; completed?: boolean },
): Promise<GTask> {
  const body: Record<string, unknown> = {};
  if (patch.title !== undefined) body.title = patch.title;
  if (patch.notes !== undefined) body.notes = patch.notes;
  if (patch.due !== undefined) body.due = patch.due ? `${patch.due}T00:00:00.000Z` : null;
  if (patch.completed !== undefined) body.status = patch.completed ? "completed" : "needsAction";
  return gfetch<GTask>(`/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(googleId)}`, token, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteGoogleTask(token: string, listId: string, googleId: string): Promise<void> {
  await gfetch<void>(
    `/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(googleId)}`,
    token,
    { method: "DELETE" },
  );
}

// ── Local fallback store ──────────────────────────────────────────────────

function readLocal<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function writeLocal<T>(key: string, items: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch { /* quota — ignore */ }
}

export const localEventsStore = {
  load: () => readLocal<CalEvent>(LOCAL_EVENTS_KEY),
  save: (items: CalEvent[]) => writeLocal(LOCAL_EVENTS_KEY, items),
};

export const localTasksStore = {
  load: () => readLocal<TaskItem>(LOCAL_TASKS_KEY),
  save: (items: TaskItem[]) => writeLocal(LOCAL_TASKS_KEY, items),
};

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
