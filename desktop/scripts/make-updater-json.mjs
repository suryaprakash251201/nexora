#!/usr/bin/env node
/**
 * Build a Tauri v2 `updater.json` from a directory of downloaded bundles.
 *
 * The desktop release job downloads every platform artifact into one folder
 * (tauri-action build-only mode emits the bundles + detached `.sig` files
 * but no updater manifest). This script pairs each updatable archive with
 * its sibling signature and emits the manifest the updater plugin polls at
 * `releases/latest/download/updater.json`.
 *
 * Updatable mapping:
 *   *.AppImage            -> linux-x86_64
 *   *-setup.exe (nsis)    -> windows-x86_64   (.msi is NOT updater-capable)
 *   *.app.tar.gz          -> darwin-<arch>    (arch parsed from filename)
 *
 * Usage:
 *   node make-updater-json.mjs --dir bundles --tag v1.9.0 \
 *     --repo owner/name --out updater.json [--notes "release notes"]
 *
 * Exits non-zero when no updatable platform was found (a release without
 * any updater target is a pipeline bug, not an empty manifest).
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) return def;
  return process.argv[i + 1];
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/** [platformKey, urlFileName] or null when the file is not updater-capable. */
function classify(path) {
  const name = path.split(/[\\/]/).pop();
  if (/\.AppImage$/i.test(name)) return ["linux-x86_64", name];
  if (/-setup\.exe$/i.test(name)) return ["windows-x86_64", name];
  const m = name.match(/\.app\.tar\.gz$/i);
  if (m) {
    const arch = /aarch64|arm64/i.test(name) ? "aarch64" : "x86_64";
    return [`darwin-${arch}`, name];
  }
  return null;
}

const dir = arg("dir", "bundles");
const tag = arg("tag");
const repo = arg("repo");
const out = arg("out", "updater.json");
const notes = arg("notes", `Nexora Desktop ${tag ?? ""}`.trim());

if (!tag || !repo) {
  console.error("make-updater-json: --tag and --repo are required");
  process.exit(2);
}
const version = tag.replace(/^v/, "");
const baseUrl = `https://github.com/${repo}/releases/download/${tag}`;

const platforms = {};
for (const file of walk(dir)) {
  const hit = classify(file);
  if (!hit) continue;
  const [platform, asset] = hit;
  let sigPath = `${file}.sig`;
  try {
    statSync(sigPath);
  } catch {
    console.error(`make-updater-json: missing signature for ${asset} (expected ${asset}.sig)`);
    process.exit(1);
  }
  const signature = readFileSync(sigPath, "utf8").trim();
  if (!signature) {
    console.error(`make-updater-json: empty signature: ${sigPath}`);
    process.exit(1);
  }
  if (platforms[platform]) {
    console.error(`make-updater-json: duplicate target ${platform}: ${platforms[platform].url} vs ${asset}`);
    process.exit(1);
  }
  platforms[platform] = { signature, url: `${baseUrl}/${asset}` };
  console.log(`make-updater-json: ${platform} <- ${asset}`);
}

if (Object.keys(platforms).length === 0) {
  console.error(`make-updater-json: no updatable bundles found under ${dir}`);
  process.exit(1);
}

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms,
};
writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
console.log(`make-updater-json: wrote ${out} (${Object.keys(platforms).length} platform(s))`);
