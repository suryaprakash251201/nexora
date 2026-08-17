import { chromium } from "@playwright/test";
const BASE = process.env.BASE || "http://localhost:8080";
const ITER = parseInt(process.argv[2] || "3", 10);
const browser = await chromium.launch();
const out = [];
for (let i = 0; i < ITER; i++) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { sessionStorage.setItem("nexora-splash-seen", "1"); } catch {} });
  await page.goto(BASE + "/", { waitUntil: "commit" });
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 30000 });
  const t0 = Date.now();
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=Storage Used", { timeout: 20000 });
  out.push(Date.now() - t0);
  await ctx.close();
}
console.log("no-splash dash (ms):", out.join(", "), "median", [...out].sort((a,b)=>a-b)[Math.floor(out.length/2)]);
await browser.close();
