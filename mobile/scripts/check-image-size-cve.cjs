// Regression harness for the image-size CVE guards in patches/.
// Each parser runs in a child process with a hard timeout, so an infinite
// loop surfaces as a failed run instead of wedging CI.
//
//   node scripts/check-image-size-cve.cjs
//
// Exits non-zero if any crafted buffer can still hang a parser.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TIMEOUT_MS = 10_000;

/** A minimal ISO-BMFF box: [size][type][payload]. */
function box(type, payload = Buffer.alloc(0), sizeOverride = null) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(sizeOverride === null ? 8 + payload.length : sizeOverride >>> 0, 0);
  head.write(type, 4, 4, "latin1");
  return Buffer.concat([head, payload]);
}

const heifTree = (ispeSize) =>
  Buffer.concat([
    box("ftyp", Buffer.from("heic\0\0\0\0heic", "latin1")),
    box("meta", Buffer.concat([Buffer.alloc(4), box("iprp", box("ipco", box("ispe", Buffer.alloc(12), ispeSize)))])),
    Buffer.alloc(8),
  ]);

const cases = {
  // CVE-2025-71330 (GHSA-w3rx-r6r6-pgpr): ICNS entry with a zero length made
  // the parser's offset never advance.
  icns: (() => {
    const head = Buffer.alloc(8);
    head.write("icns", 0, 4, "latin1");
    head.writeUInt32BE(64, 4);
    const rest = Buffer.alloc(56);
    rest.writeUInt32BE(0, 0);
    return Buffer.concat([head, rest]);
  })(),
  // GHSA-5p2g-fcmc-qvqq: a jxlp box with a zero size made
  // extractPartialStreams recompute the same offset forever.
  jxl: Buffer.concat([
    box("JXL "),
    box("ftyp", Buffer.from("jxl \0\0\0\0jxl ", "latin1")),
    box("jxlp", Buffer.alloc(16), 0),
    Buffer.alloc(16),
  ]),
  "jxl-short-box": Buffer.concat([
    box("JXL "),
    box("ftyp", Buffer.from("jxl \0\0\0\0jxl ", "latin1")),
    box("jxlp", Buffer.alloc(2), 10),
    Buffer.alloc(16),
  ]),
  heif: heifTree(20),
  "heif-zero-ispe": heifTree(0),
};

const child = path.join(os.tmpdir(), `is-cve-child-${process.pid}.cjs`);
fs.writeFileSync(
  child,
  `const fs=require("node:fs");const sizeOf=require(${JSON.stringify(require.resolve("image-size"))});` +
    `try{console.log(JSON.stringify(sizeOf(fs.readFileSync(0))))}catch(e){console.log("threw: "+e.message)}`,
);

let hung = 0;
try {
  for (const [name, buf] of Object.entries(cases)) {
    const r = spawnSync(process.execPath, [child], { input: buf, timeout: TIMEOUT_MS });
    const verdict = r.error
      ? r.error.code === "ETIMEDOUT"
        ? "HANG"
        : `error: ${r.error.message}`
      : "ok";
    if (verdict !== "ok") hung++;
    console.log(`  ${name.padEnd(16)} ${verdict}`);
  }
} finally {
  fs.rmSync(child, { force: true });
}

if (hung) {
  console.error(`\n${hung} crafted input(s) still hang an image-size parser — the CVE guards are missing.`);
  process.exit(1);
}
console.log("\nAll crafted inputs terminate: image-size CVE guards are in place.");
