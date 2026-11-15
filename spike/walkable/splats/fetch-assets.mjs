#!/usr/bin/env node
// Downloads everything the splats page needs into spike/walkable/splats/assets/ from the committed manifest.
//   node spike/walkable/splats/fetch-assets.mjs            (everything)
//   node spike/walkable/splats/fetch-assets.mjs --only hackathon   (entries whose id contains "hackathon", plus vendor libs)
// No dependencies. Files already present with the right size (and sha256 when the manifest has one) are skipped.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const assetsDir = path.join(root, "assets");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > 0 ? process.argv[onlyIdx + 1] : null;

const entries = [
  ...manifest.vendor.map((v) => ({ ...v, id: "vendor:" + v.path })),
  ...manifest.assets.filter((a) => !only || a.id.includes(only)),
  ...(manifest.extras ?? []).filter((a) => !only || a.id.includes(only)),
];

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function present(e) {
  const p = path.join(assetsDir, e.path);
  if (!fs.existsSync(p)) return false;
  const buf = fs.readFileSync(p);
  if (e.bytes && buf.length !== e.bytes) return false;
  if (e.sha256 && sha256(buf) !== e.sha256) return false;
  return true;
}

async function download(e) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(e.url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      if (e.bytes && buf.length !== e.bytes) throw new Error("size " + buf.length + " != " + e.bytes);
      if (e.sha256 && sha256(buf) !== e.sha256) throw new Error("sha256 mismatch");
      const p = path.join(assetsDir, e.path);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p + ".part", buf);
      fs.renameSync(p + ".part", p);
      return buf.length;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastErr;
}

const queue = [...entries];
let failed = 0;
let fetched = 0;
let skipped = 0;
let bytes = 0;
async function worker() {
  for (let e = queue.shift(); e; e = queue.shift()) {
    if (present(e)) {
      skipped++;
      continue;
    }
    const t0 = Date.now();
    try {
      const n = await download(e);
      fetched++;
      bytes += n;
      console.log("ok   " + e.path + "  " + (n / 1e6).toFixed(2) + " MB in " + ((Date.now() - t0) / 1000).toFixed(1) + " s");
    } catch (err) {
      failed++;
      console.error("FAIL " + e.path + "  " + e.url + "  " + (err?.message ?? err));
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
console.log(fetched + " fetched (" + (bytes / 1e6).toFixed(1) + " MB), " + skipped + " already present, " + failed + " failed -> " + path.relative(process.cwd(), assetsDir));
if (failed) process.exit(1);
