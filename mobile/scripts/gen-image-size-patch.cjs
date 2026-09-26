// Builds mobile/patches/image-size+1.2.1.patch from scratch: pristine 1.2.1
// files (from the npm tarball) vs the same files with the CVE guards applied,
// diffed with git so the output is a canonical patch-package patch.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const repo = path.join(__dirname, "..");
const pristine = process.argv[2]; // extracted image-size@1.2.1 package dir

const edits = [
  {
    file: "dist/types/icns.js",
    from: "        imageOffset += imageHeader[1];",
    to: "        imageOffset += imageHeader[1] || 8; // CVE-2025-71330: zero-length guard",
    all: true,
  },
  {
    file: "dist/types/jxl.js",
    from: [
      "        if (!jxlpBox)",
      "            break;",
      "        partialStreams.push(",
    ].join("\n"),
    to: [
      "        if (!jxlpBox)",
      "            break;",
      "        if (jxlpBox.size < 12) {",
      "            throw new TypeError('Invalid JXL');",
      "        }",
      "        partialStreams.push(",
    ].join("\n"),
  },
];

const work = fs.mkdtempSync(path.join(os.tmpdir(), "isgen-"));
const nm = path.join(work, "node_modules", "image-size");
fs.mkdirSync(nm, { recursive: true });
fs.cpSync(pristine, nm, { recursive: true });

// Stage pristine, then mutate, so `git diff` yields exactly the patch.
const git = (...args) => execFileSync("git", args, { cwd: work, encoding: "utf8" });
git("init", "-q");
git("config", "user.email", "patch@local");
git("config", "user.name", "patch");
git("add", "-A");
git("commit", "-qm", "pristine");

for (const e of edits) {
  const p = path.join(nm, e.file);
  const src = fs.readFileSync(p, "utf8");
  if (!src.includes(e.from)) throw new Error(`anchor not found in ${e.file}`);
  const out = e.all ? src.split(e.from).join(e.to) : src.replace(e.from, e.to);
  fs.writeFileSync(p, out);
}

const diff = git("diff", "--no-color", "--", "node_modules/image-size");
const target = path.join(repo, "patches", "image-size+1.2.1.patch");
fs.writeFileSync(target, diff);
console.log(`wrote ${target} (${diff.split("\n").length} lines)`);
console.log(diff);
