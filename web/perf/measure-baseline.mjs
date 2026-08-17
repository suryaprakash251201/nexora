/**
 * Phase 0 — Nexora frontend performance baseline.
 * Measures, per fresh cold load:
 *   - navigation timing (TTFB, DOMContentLoaded, load, LCP)
 *   - total transfer size + per-resource totals (JS/CSS/font/img/api)
 *   - dashboard startup: API call durations + thumbnail burst
 *   - folder navigation: click→first-paint and click→settled latency
 * Run:  cd web && node perf/measure-baseline.mjs [iterations]
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:8080";
const ITER = Math.max(1, parseInt(process.argv[2] || "3", 10));
const USER = { u: "admin", p: "Password123!" };

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function p95(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)];
}
function sum(arr) { return arr.reduce((a, b) => a + b, 0); }
function ms(x) { return Math.round(x); }
function kb(x) { return Math.round(x / 1024); }

async function coldLoad(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const apiCalls = [];   // {name, dur, size}
  const thumbs = [];     // {dur, size, status}
  let lcp = 0;
  let nav = null;

  page.on("response", (res) => {
    const url = res.url();
    if (url.startsWith(BASE + "/api/")) {
      apiCalls.push({ path: url.replace(BASE + "/api/v1", "").split("?")[0], reqStart: performance.now() });
      res.body().then(() => {
        const e = apiCalls[apiCalls.length - 1];
        if (e) e.dur = performance.now() - e.reqStart;
      }).catch(() => {});
      if (url.includes("/files/thumbnail")) {
        thumbs.push({ status: res.status() });
      }
    }
  });

  await page.addInitScript(() => {
    window.__perf = { resources: [] };
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.entryType === "largest-contentful-paint") window.__perf.lcp = e.startTime;
      }
    });
    po.observe({ type: "largest-contentful-paint", buffered: true });
    const ro = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__perf.resources.push(e);
    });
    ro.observe({ type: "resource", buffered: true });
  });

  const t0 = Date.now();
  await page.goto(BASE + "/", { waitUntil: "commit", timeout: 30000 });
  // boot splash is painted right away; wait for login form
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 30000 });
  const tLoginVisible = Date.now() - t0;

  // login
  const tLoginStart = Date.now();
  await page.fill('input[autocomplete="username"]', USER.u);
  await page.fill('input[autocomplete="current-password"]', USER.p);
  await page.click('button[type="submit"]');
  // dashboard ready = stats bar rendered
  await page.waitForSelector("text=Storage Used", { timeout: 30000 });
  const tDashboard = Date.now() - tLoginStart;

  // let thumbs settle
  await page.waitForTimeout(2500);

  const entry = await page.evaluate((base) => {
    const nav = performance.getEntriesByType("navigation")[0];
    const res = window.__perf.resources;
    const byType = (re) => {
      const out = {};
      for (const r of re) {
        const t = r.initiatorType === "img" ? "img" : r.initiatorType === "css" ? "css" : r.initiatorType === "script" ? "script" : r.initiatorType === "fetch" || r.initiatorType === "xmlhttprequest" ? "xhr" : r.initiatorType === "link" ? "link" : "other";
        out[t] = (out[t] || 0) + (r.transferSize || 0);
      }
      return out;
    };
    return {
      ttfb: nav.responseStart, dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd,
      transfer: res.reduce((a, r) => a + (r.transferSize || 0), 0),
      decoded: res.reduce((a, r) => a + (r.decodedBodySize || 0), 0),
      byType: byType(res),
      jsTransfers: res.filter(r => r.initiatorType === "script").map(r => ({ n: r.name.split("/").pop(), t: r.transferSize || 0, d: r.duration })),
      cssTransfers: res.filter(r => r.initiatorType === "css").map(r => ({ n: r.name.split("/").pop(), t: r.transferSize || 0, d: r.duration })),
      fontTransfers: res.filter(r => r.name.includes(".woff2")).map(r => ({ n: r.name.split("/").pop(), t: r.transferSize || 0 })),
      imgTransfers: res.filter(r => r.initiatorType === "img").map(r => ({ n: r.name.split("?")[0].split("/").pop(), t: r.transferSize || 0, d: r.duration })),
      api: res.filter(r => r.name.includes("/api/")).map(r => ({ n: r.name.replace(base + "/api/v1", "").split("?")[0], d: r.duration, s: r.transferSize || 0 })),
      lcp: window.__perf.lcp || 0,
    };
  }, BASE);
  const tLcp = Date.now() - t0; // rough wall-clock LCP proxy

  // ---- folder navigation ----
  const tNavStart = Date.now();
  await page.click('nav button:has-text("Files")'); // root button in sidebar
  await page.waitForSelector('[title="Screenshots"]', { timeout: 30000 });
  const tFolderList = Date.now() - tNavStart;
  // open Screenshots folder (80 images)
  await page.click('[title="Screenshots"]');
  await page.waitForSelector('[title="img-079.jpg"]', { timeout: 30000 });
  const tFolderItems = Date.now() - tNavStart;
  // settled: wait for last image to load (or net idle-ish)
  await page.waitForTimeout(3000);

  const thumbsAfterNav = await page.evaluate(() => {
    const res = window.__perf.resources;
    // filter thumbnails that came after nav (Screenshots paths)
    return {
      count: res.filter(r => r.name.includes("/files/thumbnail") && r.name.includes("Screenshots")).length,
      dur: res.filter(r => r.name.includes("/files/thumbnail") && r.name.includes("Screenshots")).map(r => r.duration),
    };
  });

  await ctx.close();

  return {
    load: {
      ttfb: ms(entry.ttfb), dcl: ms(entry.dcl), load: ms(entry.load), lcp: ms(entry.lcp), lcpWall: ms(tLcp),
      tLoginVisible: ms(tLoginVisible), tDashboard: ms(tDashboard),
      transferKB: kb(entry.transfer), decodedKB: kb(entry.decoded), byType: entry.byType,
      jsTransfers: entry.jsTransfers, cssTransfers: entry.cssTransfers,
      fontTransfers: entry.fontTransfers, imgTransfers: entry.imgTransfers,
    },
    api: entry.api,
    thumbs: thumbs.map((t, i) => ({ i, status: t.status })),
    folder: {
      tList: ms(tFolderList), tItems: ms(tFolderItems),
      thumbsCount: thumbsAfterNav.count, thumbsDur: thumbsAfterNav.dur,
    },
  };
}

const browser = await chromium.launch();
const results = [];
try {
  for (let i = 0; i < ITER; i++) {
    const r = await coldLoad(browser);
    results.push(r);
    console.log(`iter ${i + 1}: ttfb=${r.load.ttfb}ms dcl=${r.load.dcl}ms load=${r.load.load}ms lcp=${r.load.lcpWall}ms dash=${r.load.tDashboard}ms folder=${r.folder.tItems}ms transfer=${r.load.transferKB}KB`);
  }
  fs.writeFileSync("/tmp/nexora-perf/results.json", JSON.stringify(results, null, 2));
  console.log("wrote /tmp/nexora-perf/results.json");
} finally {
  await browser.close();
}

// ——— aggregate report ———
const agg = {
  ttfb: median(results.map(r => r.load.ttfb)),
  dcl: median(results.map(r => r.load.dcl)),
  load: median(results.map(r => r.load.load)),
  lcp: median(results.map(r => r.load.lcpWall)),
  tLoginVisible: median(results.map(r => r.load.tLoginVisible)),
  tDashboard: median(results.map(r => r.load.tDashboard)),
  transferKB: median(results.map(r => r.load.transferKB)),
  decodedKB: median(results.map(r => r.load.decodedKB)),
  byType: (() => { const t = {}; for (const r of results) for (const [k, v] of Object.entries(r.load.byType)) t[k] = (t[k] || 0) + v; for (const k in t) t[k] = kb(t[k]); return t; })(),
  folderTList: median(results.map(r => r.folder.tList)),
  folderTItems: median(results.map(r => r.folder.tItems)),
  thumbsPerLoad: median(results.map(r => r.api.filter(a => a.n.includes("thumbnail")).length)),
  thumbsP95: p95(results.flatMap(r => r.folder.thumbsDur)),
};

// API call durations (median per endpoint across iters)
const apiByPath = {};
for (const r of results) for (const a of r.api) (apiByPath[a.n] = apiByPath[a.n] || []).push(a.d);
const apiMedians = Object.entries(apiByPath).map(([n, d]) => ({ n, median: ms(median(d)), p95: ms(p95(d)) })).sort((a, b) => b.median - a.median);

console.log("\n========== BASELINE REPORT ==========");
console.log(JSON.stringify({ agg, apiMedians }, null, 2));