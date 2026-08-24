import { getCsrfToken, getBaseUrl } from "../api/client";
import { useTransfers, uid, type Transfer } from "../store/transfers";
import { formatBytes } from "./format";

function fmtSpeed(bps: number): string {
  if (bps >= 1 << 30) return (bps / (1 << 30)).toFixed(1) + " GB/s";
  if (bps >= 1 << 20) return (bps / (1 << 20)).toFixed(1) + " MB/s";
  if (bps >= 1 << 10) return (bps / (1 << 10)).toFixed(1) + " KB/s";
  return bps.toFixed(0) + " B/s";
}

export function speedLabel(bps: number): string {
  return fmtSpeed(bps);
}

// At most MAX_CONCURRENT transfers run at once; uploads and downloads share
// the same pool. The rest wait in the queue and start as slots free up.
const MAX_CONCURRENT = 3;

// Cancellable-transfer registries. Uploads use XHR (abortable); browser
// downloads use fetch + AbortController; Tauri downloads are not cancellable
// through this API.
const activeXhr = new Map<string, XMLHttpRequest>();
const filesById = new Map<string, File>();
const activeControllers = new Map<string, AbortController>();

interface QueuedJob {
  id: string;
  run: () => void;
}

const queue: QueuedJob[] = [];
let activeCount = 0;

// Start as many queued transfers as slots allow.
function pump() {
  while (activeCount < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift()!;
    const t = useTransfers.getState().transfers.find((x) => x.id === job.id);
    // Cancelled while queued — skip it.
    if (!t || t.status === "done" || t.status === "error") continue;
    activeCount += 1;
    useTransfers.getState().update(job.id, { status: "active" });
    job.run();
  }
}

// Mark a running transfer finished and free its slot for the next queued one.
function finish(id: string) {
  activeXhr.delete(id);
  activeControllers.delete(id);
  activeCount = Math.max(0, activeCount - 1);
  pump();
}

function enqueue(id: string, run: () => void) {
  queue.push({ id, run });
  pump();
}

export function cancelTransfer(id: string) {
  const ch = activeChunked.get(id);
  if (ch) {
    ch.cancelled = true;
    ch.ctrl.abort();
    activeChunked.delete(id);
    filesById.delete(id);
    useTransfers.getState().remove(id);
    return;
  }
  const idx = queue.findIndex((j) => j.id === id);
  if (idx >= 0) {
    // Still waiting — just drop it from the queue.
    queue.splice(idx, 1);
    useTransfers.getState().remove(id);
    return;
  }
  activeXhr.get(id)?.abort();
  activeControllers.get(id)?.abort();
  useTransfers.getState().remove(id);
}

export function isCancellable(id: string): boolean {
  return queue.some((j) => j.id === id) || activeXhr.has(id) || activeControllers.has(id) || activeChunked.has(id);
}

/** True while a resumable (chunked) upload for this id is running. */
export function isPausable(id: string): boolean {
  return activeChunked.has(id);
}

// ────────────────────────────────────────────────────────────────────────────
// Resumable chunked uploads (files above RESUMABLE_THRESHOLD).
//
// init → parallel chunk PUTs (idempotent, retry w/ backoff) → complete.
// Session id persists in localStorage so a page refresh can resume from the
// last acknowledged chunk via GET /uploads/{id}/status.
// ────────────────────────────────────────────────────────────────────────────
const RESUMABLE_THRESHOLD = 64 << 20; // 64 MB
const CHUNK_SIZE = 16 << 20;          // 16 MiB per chunk (server clamps 4–64)
const MAX_PARALLEL_CHUNKS = 3;
const CHUNK_RETRIES = 4;
const BACKOFF_MS = [1000, 2000, 4000, 8000];

interface ChunkedState {
  uploadId: string | null;
  file: File;
  rootId: string;
  targetPath: string;
  isTauri: boolean;
  baseUrl: string;
  csrf: string | null;
  authHeader: [string, string] | null;
  ctrl: AbortController;
  paused: boolean;
  cancelled: boolean;
  ackedBytes: number;
  inflight: Map<number, number>; // index → bytes sent for that chunk
  onDone?: () => void;
}

const activeChunked = new Map<string, ChunkedState>();
const sessionKey = (f: File, rootId: string, path: string) =>
  `nexora.up:${rootId}|${path}|${f.name}|${f.size}|${(f as any).lastModified ?? 0}`;

function authHeaders(isTauri: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  const csrf = getCsrfToken();
  if (csrf) h["X-CSRF-Token"] = csrf;
  const storedToken = localStorage.getItem("nexora-token");
  if (isTauri && storedToken) h["Authorization"] = "Bearer " + storedToken;
  return h;
}

/** Map backend failures to human sentences — never a bare "network error". */
function describeUploadFailure(status: number | null, code: string | null, atBytes: number, total: number): string {
  const at = total > 0 ? ` at ${formatBytes(atBytes)} / ${formatBytes(total)}` : "";
  if (code === "disk_full" || status === 507) return `Upload stopped${at} — server is out of storage space`;
  if (status === 413 || code === "payload_too_large") return `Upload rejected${at} — piece too large`;
  if (status === 401) return `Sign-in expired${at} — please sign in and retry`;
  if (status === 403 || code === "permission_denied") return `Upload blocked${at} — no write access to this folder`;
  if (code === "mime_not_allowed") return `File type not allowed by the server`;
  if (code === "upload_expired" || status === 404) return `Upload session expired${at} — start again`;
  if (code === "chunks_missing" || code === "size_mismatch") return `Resuming upload${at}…`;
  return `Transfer failed${at} (${status ?? "network"} ${code ?? ""})`.trimEnd();
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); rej(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}

async function jsonOrThrow(res: Response): Promise<any> {
  let body: any = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = new Error(body?.message || res.statusText) as any;
    err.status = res.status;
    err.code = body?.error ?? null;
    throw err;
  }
  return body;
}

/** Run one chunk PUT with exponential-backoff retries on transient errors. */
async function putChunk(st: ChunkedState, index: number, onByte: (delta: number) => void): Promise<void> {
  const url = `${st.baseUrl}/api/v1/files/uploads/${st.uploadId}/chunk?index=${index}`;
  const start = index * CHUNK_SIZE;
  const end = Math.min(start + CHUNK_SIZE, st.file.size);
  const blob = st.file.slice(start, end);

  for (let attempt = 0; attempt <= CHUNK_RETRIES; attempt++) {
    if (st.cancelled) throw new DOMException("Cancelled", "AbortError");
    try {
      const xhr = new XMLHttpRequest();
      const xhrDone = new Promise<void>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(Object.assign(new Error(`chunk ${xhr.status}`), { status: xhr.status }));
        };
        xhr.onerror = () => reject(Object.assign(new Error("chunk network"), { status: 0 }));
        xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
      });
      xhr.open("PUT", url);
      for (const [k, v] of Object.entries(authHeaders(st.isTauri))) xhr.setRequestHeader(k, v);
      let last = 0;
      xhr.upload.onprogress = (e) => { onByte(e.loaded - last); last = e.loaded; };
      xhr.send(blob);
      await xhrDone;
      return;
    } catch (e: any) {
      if (e?.name === "AbortError") {
        if (st.cancelled) throw e;
        throw Object.assign(new Error("paused"), { paused: true });
      }
      const status: number = e?.status ?? 0;
      const transient = status === 0 || status === 429 || status >= 500;
      if (!transient || attempt === CHUNK_RETRIES) throw e;
      useTransfers.getState().update(id_of(st), { status: "retrying" });
      await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)], st.ctrl.signal);
    }
  }
}
// Small helper so retry logging can find its transfer id without extra plumbing.
function id_of(st: ChunkedState): string {
  for (const [id, v] of activeChunked) if (v === st) return id;
  return "";
}


// startUpload enqueues each file individually via XHR so progress is reported
// per file, and records each transfer in the global transfers store.
export function startUpload(
  rootId: string,
  path: string,
  fileList: FileList | File[],
  onDone?: () => void
) {
  const files = Array.from(fileList);
  if (!files.length || !rootId) return;

  const isTauri = "__TAURI_INTERNALS__" in window;
  const baseUrl = getBaseUrl();

  files.forEach((file) => {
    const id = uid();
    // Support relative folder path if uploaded via webkitdirectory or folder drop
    const relPath = (file as any).webkitRelativePath || "";
    let targetPath = path;
    if (relPath && relPath.includes("/")) {
      const relDir = relPath.substring(0, relPath.lastIndexOf("/"));
      targetPath = path ? `${path}/${relDir}` : relDir;
    }

    const transfer: Transfer = {
      id,
      name: file.name,
      kind: "upload",
      rootId,
      path: targetPath,
      loaded: 0,
      total: file.size,
      speed: 0,
      status: "queued",
    };
    useTransfers.getState().add(transfer);
    filesById.set(id, file);

    enqueue(id, () => runUpload(id, file, rootId, targetPath, isTauri, baseUrl, onDone));
  });
}

function runUpload(
  id: string,
  file: File,
  rootId: string,
  targetPath: string,
  isTauri: boolean,
  baseUrl: string,
  onDone?: () => void
) {
  if (file.size >= RESUMABLE_THRESHOLD) {
    void runChunkedUpload(id, file, rootId, targetPath, isTauri, baseUrl, onDone);
    return;
  }
  const form = new FormData();
  form.append("files", file);

  const uploadUrl = baseUrl + `/api/v1/files/upload?root=${encodeURIComponent(rootId)}&path=${encodeURIComponent(targetPath)}`;
  const xhr = new XMLHttpRequest();
  xhr.open("POST", uploadUrl);
  activeXhr.set(id, xhr);
  const cleanup = () => activeXhr.delete(id);
  xhr.withCredentials = !isTauri;
  const csrf = getCsrfToken();
  if (csrf) xhr.setRequestHeader("X-CSRF-Token", csrf);

  // In Tauri, cookies are not shared with the external API server, so send token via header
  const storedToken = localStorage.getItem("nexora-token");
  if (isTauri && storedToken) {
    xhr.setRequestHeader("Authorization", "Bearer " + storedToken);
  }

  let lastTime = performance.now();
  let lastLoaded = 0;
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    cleanup();
    finish(id);
  };

  xhr.upload.onprogress = (e) => {
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    if (dt > 0.25) {
      const speed = (e.loaded - lastLoaded) / dt;
      lastTime = now;
      lastLoaded = e.loaded;
      useTransfers.getState().update(id, { loaded: e.loaded, total: e.total, speed });
    } else {
      useTransfers.getState().update(id, { loaded: e.loaded, total: e.total });
    }
  };

  xhr.onload = () => {
    done();
    if (xhr.status >= 200 && xhr.status < 300) {
      useTransfers.getState().update(id, { loaded: file.size, total: file.size, speed: 0, status: "done" });
      onDone?.();
    } else {
      let code: string | null = null;
      try { code = JSON.parse(xhr.responseText)?.error ?? null; } catch { /* ignore */ }
      const msg = describeUploadFailure(xhr.status, code, 0, file.size);
      useTransfers.getState().update(id, { status: "error", error: msg });
    }
  };
  xhr.onabort = () => done();
  xhr.onerror = () => {
    done();
    const t = useTransfers.getState().transfers.find((x) => x.id === id);
    const at = t && t.loaded > 0 ? ` at ${formatBytes(t.loaded)}` : "";
    useTransfers.getState().update(id, { status: "error", error: `Network error${at} — connection closed by server` });
  };
  xhr.send(form);
}

// startDownload enqueues a download that streams the file via fetch so
// download progress can be shown, then triggers a browser save. The transfer
// is recorded in the store.
export async function startDownload(rootId: string, path: string, name: string) {
  const isTauri = "__TAURI_INTERNALS__" in window;
  const baseUrl = getBaseUrl();
  const pathUrl = `/api/v1/files/download?root=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`;
  const fullUrl = baseUrl + pathUrl;
  const id = uid();

  useTransfers.getState().add({
    id, name, kind: "download", rootId, path, loaded: 0, total: 0, speed: 0, status: "queued",
  });

  enqueue(id, () => {
    void runDownload(id, name, fullUrl, isTauri);
  });
}

async function runDownload(id: string, name: string, fullUrl: string, isTauri: boolean) {
  if (isTauri) {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { download: tauriDownload } = await import("@tauri-apps/plugin-upload");

      const savePath = await save({ defaultPath: name });
      if (!savePath) {
        useTransfers.getState().update(id, { status: "error", error: "Download cancelled" });
        finish(id);
        return;
      }

      const absoluteUrl = fullUrl;

      const headers = new Map<string, string>();
      const token = localStorage.getItem("nexora-token");
      if (token) headers.set("Authorization", `Bearer ${token}`);

      let lastTime = 0;
      let lastLoaded = 0;
      let trackingStarted = false;

      await tauriDownload(absoluteUrl, savePath, (p) => {
        const cumulative = p.progressTotal;

        if (!trackingStarted) {
          lastTime = performance.now();
          lastLoaded = cumulative;
          trackingStarted = true;
          useTransfers.getState().update(id, {
            loaded: cumulative,
            total: p.total
          });
          return;
        }

        const now = performance.now();
        const dt = (now - lastTime) / 1000;

        if (dt > 0.25 && cumulative > lastLoaded) {
          const speed = Math.round((cumulative - lastLoaded) / dt);
          lastTime = now;
          lastLoaded = cumulative;
          useTransfers.getState().update(id, {
            loaded: cumulative,
            total: p.total,
            speed
          });
        } else {
          useTransfers.getState().update(id, {
            loaded: cumulative,
            total: p.total
          });
        }
      }, headers);

      const st = useTransfers.getState().transfers.find(t => t.id === id);
      useTransfers.getState().update(id, { loaded: st?.total || 0, speed: 0, status: "done" });
    } catch (e: any) {
      useTransfers.getState().update(id, { status: "error", error: e?.message || "Download failed" });
    } finally {
      finish(id);
    }
    return;
  }

  // Browser download
  const controller = new AbortController();
  activeControllers.set(id, controller);
  try {
    const res = await fetch(fullUrl, { credentials: "include", signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
    const total = Number(res.headers.get("Content-Length")) || 0;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    let lastTime = performance.now();
    let lastLoaded = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.length;
        const now = performance.now();
        const dt = (now - lastTime) / 1000;
        if (dt > 0.25) {
          const speed = (loaded - lastLoaded) / dt;
          lastTime = now;
          lastLoaded = loaded;
          useTransfers.getState().update(id, { loaded, total, speed });
        } else {
          useTransfers.getState().update(id, { loaded, total });
        }
      }
    }

    const blob = new Blob(chunks as BlobPart[]);
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    useTransfers.getState().update(id, { loaded: total || loaded, total: total || loaded, speed: 0, status: "done" });
  } catch (e: any) {
    if (e?.name !== "AbortError") {
      useTransfers.getState().update(id, { status: "error", error: e?.message || "Download failed" });
    }
  } finally {
    activeControllers.delete(id);
    finish(id);
  }
}


async function runChunkedUpload(
  id: string,
  file: File,
  rootId: string,
  targetPath: string,
  isTauri: boolean,
  baseUrl: string,
  onDone?: () => void,
  existingId?: string | null,
) {
  const ctrl = new AbortController();
  const st: ChunkedState = {
    uploadId: existingId ?? null,
    file, rootId, targetPath, isTauri, baseUrl,
    csrf: getCsrfToken(),
    authHeader: null,
    ctrl,
    paused: false,
    cancelled: false,
    ackedBytes: 0,
    inflight: new Map(),
    onDone,
  };
  activeChunked.set(id, st);

  const setP = (patch: Partial<Transfer>) => useTransfers.getState().update(id, patch);
  const total = file.size;

  try {
    const headers = authHeaders(isTauri);
    const jfetch = async (url: string, init?: RequestInit) => {
      const res = await fetch(url, { credentials: !isTauri ? "include" : "omit", signal: ctrl.signal, ...init });
      return jsonOrThrow(res);
    };

    // ── Init or resume ──
    if (!st.uploadId && existingId) st.uploadId = existingId;
    if (!st.uploadId) {
      setP({ status: "processing" });
      const r = await jfetch(`${baseUrl}/api/v1/files/uploads/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ root: rootId, path: targetPath, name: file.name, size: file.size, mime: file.type, chunk_size: CHUNK_SIZE }),
      });
      st.uploadId = r.uploadId as string;
      localStorage.setItem(sessionKey(file, rootId, targetPath), st.uploadId);
    }

    // Acknowledged state from the server (covers refresh-resume too).
    let status = await jfetch(`${baseUrl}/api/v1/files/uploads/${st.uploadId}/status`);
    const present: Record<number, boolean> | undefined = status.present;
    let next: number = Math.max(0, status.nextChunk ?? 0);
    st.ackedBytes = status.uploadedBytes ?? 0;
    const totalChunks: number = status.totalChunks;
    setP({ loaded: st.ackedBytes, total });

    // ── Bounded-parallelism chunk pump ──
    let cursor = next;
    const sumInflight = (s2: ChunkedState) => [...s2.inflight.values()].reduce((a, b) => a + b, 0);
    const bump = (index: number, delta: number) => {
      const cur = st.inflight.get(index) ?? 0;
      st.inflight.set(index, cur + delta);
      setP({ loaded: Math.min(total, st.ackedBytes + sumInflight(st)) });
    };
    const worker = async () => {
      for (;;) {
        if (st.cancelled) throw new DOMException("Cancelled", "AbortError");
        if (st.paused) throw Object.assign(new Error("paused"), { paused: true });
        if (cursor >= totalChunks) return;
        // Skip chunks the server already acknowledged.
        while (cursor < totalChunks && present?.[cursor]) {
          cursor++;
          st.ackedBytes += Math.min(CHUNK_SIZE, total - (cursor - 1) * CHUNK_SIZE);
        }
        if (cursor >= totalChunks) return;
        const index = cursor++;
        await putChunk(st, index, (delta) => bump(index, delta));
        st.inflight.delete(index);
        st.ackedBytes += Math.min(CHUNK_SIZE, total - index * CHUNK_SIZE);
        setP({ loaded: Math.min(total, st.ackedBytes), status: "active" });
      }
    };

    const workers = Math.max(1, Math.min(MAX_PARALLEL_CHUNKS, totalChunks - next));
    await Promise.all(Array.from({ length: workers }, worker));

    // ── Complete: server verifies, assembles, atomic-renames ──
    setP({ loaded: total, status: "processing", speed: 0 });
    try {
      await jfetch(`${baseUrl}/api/v1/files/uploads/${st.uploadId}/complete`, { method: "POST", headers });
    } catch (e: any) {
      if (e?.code === "chunks_missing" || e?.code === "size_mismatch") {
        // Server lost a chunk mid-flight — re-sync from its status and continue.
        activeChunked.delete(id);
        finish(id);
        enqueue(id, () => runChunkedUpload(id, file, rootId, targetPath, isTauri, baseUrl, onDone, st.uploadId));
        return;
      }
      throw e;
    }

    localStorage.removeItem(sessionKey(file, rootId, targetPath));
    setP({ loaded: total, speed: 0, status: "done" });
    onDone?.();
  } catch (e: any) {
    if (st.cancelled || e?.name === "AbortError") {
      if (st.paused) {
        setP({ status: "paused", speed: 0 }); // keep session id → resume later
        return;
      }
      if (st.uploadId) {
        localStorage.removeItem(sessionKey(file, rootId, targetPath));
        void fetch(`${baseUrl}/api/v1/files/uploads/${st.uploadId}`, {
          method: "DELETE", credentials: !isTauri ? "include" : "omit", headers: authHeaders(isTauri),
        }).catch(() => {});
      }
      setP({ status: "error", error: "Upload cancelled" });
    } else {
      const msg = describeUploadFailure(e?.status ?? null, e?.code ?? null, st.ackedBytes, total);
      setP({ status: "error", error: msg });
      // Keep the session so "Retry" can resume from the last acked chunk.
    }
  } finally {
    activeChunked.delete(id);
    finish(id);
  }
}

// ── Pause / resume controls for the transfers panel ────────────────────────
export function pauseTransfer(id: string) {
  const st = activeChunked.get(id);
  if (st && !st.paused) {
    st.paused = true;
    st.ctrl.abort();
    useTransfers.getState().update(id, { status: "paused", speed: 0 });
  }
}

export function resumeTransfer(id: string) {
  const t = useTransfers.getState().transfers.find((x) => x.id === id);
  if (!t || t.status !== "paused") return;
  const f = filesById.get(id);
  if (!f) {
    // After a page refresh the File handle is gone; resuming needs the bytes.
    useTransfers.getState().update(id, {
      status: "error",
      error: "File handle lost on page reload — remove this entry and add the file again to resume.",
    });
    return;
  }
  const uploadId = localStorage.getItem(sessionKey(f, t.rootId, t.path)) ?? null;
  useTransfers.getState().update(id, { status: "queued" });
  enqueue(id, () => runChunkedUpload(id, f, t.rootId, t.path, "__TAURI_INTERNALS__" in window, getBaseUrl(), undefined, uploadId));
}
