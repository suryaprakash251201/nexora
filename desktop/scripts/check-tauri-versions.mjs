#!/usr/bin/env node
/**
 * Fail-fast guard for Tauri plugin version drift.
 *
 * Tauri hard-fails the build when an NPM `@tauri-apps/plugin-*` package and
 * its Rust `tauri-plugin-*` crate differ on major/minor (e.g. notification
 * 2.4.0 vs 2.3.3). The npm and cargo lockfiles drift silently when only one
 * side is bumped, so this runs in CI before the expensive Rust build and
 * prints the exact fix instead of a cryptic error 60s into every matrix leg.
 *
 * Runs on plain `node` (no deps) so it works on ubuntu/macos/windows alike.
 */
import { readFileSync } from "node:fs";

const npmLock = JSON.parse(readFileSync("desktop/package-lock.json", "utf8"));
const npm = {};
for (const [key, entry] of Object.entries(npmLock.packages ?? {})) {
  const name = key.split("node_modules/").pop();
  if (name.startsWith("@tauri-apps/plugin-")) {
    npm[name.split("plugin-").pop()] = entry.version;
  }
}

const cargoLock = readFileSync("desktop/src-tauri/Cargo.lock", "utf8");
const cargo = Object.fromEntries(
  [...cargoLock.matchAll(/name = "tauri-plugin-([^"]+)"\nversion = "([^"]+)"/g)].map((m) => [m[1], m[2]]),
);

const minor = (v) => v.split(".").slice(0, 2).join(".");
const bad = Object.entries(npm)
  .filter(([plugin, nver]) => cargo[plugin] && minor(nver) !== minor(cargo[plugin]))
  .map(([plugin, nver]) => `${plugin}: npm ${nver} vs cargo ${cargo[plugin]}`);

if (bad.length > 0) {
  console.error("Tauri plugin version mismatch (npm vs cargo, major.minor must match):");
  for (const b of bad) console.error(`  - ${b}`);
  console.error("Fix: bump the lagging side, then refresh the lockfile (npm i / cargo update -p).");
  process.exit(1);
}

console.log(
  "Tauri plugin versions in sync:",
  Object.entries(npm)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join(", "),
);
