/**
 * Bundle-size gate — fails if any built JS chunk exceeds its budget (raw KB).
 * Run after `npm run build`. Tune limits in BUDGETS as chunks evolve.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BUDGETS = [
  { match: /^index-.*\.js$/, kb: 560 },
  { match: /^pdf-.*\.js$/, kb: 460 },
  { match: /^vendor-.*\.js$/, kb: 220 },
];

// fileURLToPath, not URL#pathname: pathname keeps the leading slash and
// percent-encoding, which produces "C:\C:\Users\Name%20With%20Space\..." on
// Windows and makes the gate fail there.
const dir = fileURLToPath(new URL("../dist/assets", import.meta.url));
let failed = false;
for (const f of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
  const kb = Math.round(statSync(join(dir, f)).size / 1024);
  const rule = BUDGETS.find((b) => b.match.test(f));
  if (!rule) continue;
  const ok = kb <= rule.kb;
  console.log(`${ok ? "✔" : "✘"} ${f} — ${kb}KB / ${rule.kb}KB`);
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
