import { getCsrfToken } from "../api/client";
import { useTransfers, uid, type Transfer } from "../store/transfers";

function fmtSpeed(bps: number): string {
  if (bps >= 1 << 30) return (bps / (1 << 30)).toFixed(1) + " GB/s";
  if (bps >= 1 << 20) return (bps / (1 << 20)).toFixed(1) + " MB/s";
  if (bps >= 1 << 10) return (bps / (1 << 10)).toFixed(1) + " KB/s";
  return bps.toFixed(0) + " B/s";
}

export function speedLabel(bps: number): string {
  return fmtSpeed(bps);
}

// startUpload uploads each file individually via XHR so progress is reported
// per file, and records each transfer in the global transfers store.
export function startUpload(
  rootId: string,
  path: string,
  fileList: FileList,
  onDone?: () => void
) {
  const files = Array.from(fileList);
  if (!files.length || !rootId) return;

  const isTauri = "__TAURI_INTERNALS__" in window;
  const storedUrl = localStorage.getItem("nexora-api-url") || "";
  const baseUrl = (isTauri && storedUrl) ? storedUrl.replace(/\/$/, "") : "";

  files.forEach((file) => {
    const id = uid();
    const transfer: Transfer = {
      id,
      name: file.name,
      kind: "upload",
      rootId,
      path,
      loaded: 0,
      total: file.size,
      speed: 0,
      status: "active",
    };
    useTransfers.getState().add(transfer);

    const form = new FormData();
    form.append("files", file);

    const uploadUrl = baseUrl + `/api/v1/files/upload?root=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`;
    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl);
    xhr.withCredentials = !isTauri;
    xhr.setRequestHeader("X-CSRF-Token", getCsrfToken());

    // In Tauri, cookies are not shared with the external API server, so send token via header
    const storedToken = localStorage.getItem("nexora-token");
    if (isTauri && storedToken) {
      xhr.setRequestHeader("Authorization", "Bearer " + storedToken);
    }

    let lastTime = performance.now();
    let lastLoaded = 0;

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
      if (xhr.status >= 200 && xhr.status < 300) {
        useTransfers.getState().update(id, { loaded: file.size, total: file.size, speed: 0, status: "done" });
        onDone?.();
      } else {
        let msg = `Upload failed (${xhr.status})`;
        try {
          const j = JSON.parse(xhr.responseText);
          if (j.message) msg = j.message;
        } catch { /* ignore */ }
        useTransfers.getState().update(id, { status: "error", error: msg });
      }
    };
    xhr.onerror = () => useTransfers.getState().update(id, { status: "error", error: "Network error" });
    xhr.send(form);
  });
}

// startDownload streams the file via fetch so download progress can be shown,
// then triggers a browser save. The transfer is recorded in the store.
export async function startDownload(rootId: string, path: string, name: string) {
  const isTauri = "__TAURI_INTERNALS__" in window;
  const url = `/api/v1/files/download?root=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`;
  const id = uid();
  
  useTransfers.getState().add({
    id, name, kind: "download", rootId, path, loaded: 0, total: 0, speed: 0, status: "active",
  });

  if (isTauri) {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { download: tauriDownload } = await import("@tauri-apps/plugin-upload");
      
      const savePath = await save({ defaultPath: name });
      if (!savePath) {
        useTransfers.getState().update(id, { status: "error", error: "Download cancelled" });
        return;
      }
      
      // Need absolute URL for tauri upload plugin
      const absoluteUrl = new URL(url, localStorage.getItem("nexora-api-url") || window.location.origin).toString();
      
      const headers = new Map<string, string>();
      const token = localStorage.getItem("nexora-token");
      if (token) headers.set("Authorization", `Bearer ${token}`);
      
      // Track time and bytes locally for real-time speed calculation.
      // IMPORTANT: initialization happens inside the first progress callback
      // so the save-dialog delay is excluded from speed calculations.
      let lastTime = 0;
      let lastLoaded = 0;
      let trackingStarted = false;
      
      await tauriDownload(absoluteUrl, savePath, (p) => {
        if (!trackingStarted) {
          // First callback — just record baseline, skip speed (excludes dialog time)
          lastTime = performance.now();
          lastLoaded = p.progress;
          trackingStarted = true;
          useTransfers.getState().update(id, {
            loaded: p.progress,
            total: p.total
          });
          return;
        }
        
        const now = performance.now();
        const dt = (now - lastTime) / 1000;
        
        if (dt > 0.25 && p.progress > lastLoaded) {
          const speed = Math.round((p.progress - lastLoaded) / dt);
          lastTime = now;
          lastLoaded = p.progress;
          useTransfers.getState().update(id, {
            loaded: p.progress,
            total: p.total,
            speed
          });
        } else {
          useTransfers.getState().update(id, {
            loaded: p.progress,
            total: p.total
          });
        }
      }, headers);
      
      const st = useTransfers.getState().transfers.find(t => t.id === id);
      useTransfers.getState().update(id, { loaded: st?.total || 0, speed: 0, status: "done" });
    } catch (e: any) {
      useTransfers.getState().update(id, { status: "error", error: e?.message || "Download failed" });
    }
    return;
  }

  // Browser download
  try {
    const res = await fetch(url, { credentials: "include" });
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
    useTransfers.getState().update(id, { status: "error", error: e?.message || "Download failed" });
  }
}
