#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(root, "assets");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

function collect(node, out = []) {
  if (Array.isArray(node)) node.forEach((v) => collect(v, out));
  else if (node && typeof node === "object") {
    if (typeof node.file === "string" && typeof node.url === "string") out.push(node);
    Object.values(node).forEach((v) => collect(v, out));
  }
  return out;
}

async function download(asset) {
  const dest = path.join(assetsDir, asset.file);
  if (!dest.startsWith(assetsDir + path.sep)) throw new Error("bad path " + asset.file);
  if (fs.existsSync(dest) && (!asset.bytes || fs.statSync(dest).size === asset.bytes)) return { file: asset.file, skipped: true, bytes: fs.statSync(dest).size };
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(asset.url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      if (asset.bytes && buf.length !== asset.bytes) throw new Error("size " + buf.length + " != manifest " + asset.bytes);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest + ".part", buf);
      fs.renameSync(dest + ".part", dest);
      return { file: asset.file, bytes: buf.length };
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error(asset.file + ": " + (lastError?.message ?? lastError));
}

const assets = [...new Map(collect(manifest).map((a) => [a.file, a])).values()];
let failed = 0;
let total = 0;
const queue = [...assets];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const a = queue.shift();
      try {
        const r = await download(a);
        total += r.bytes;
        console.log((r.skipped ? "have " : "got  ") + r.file.padEnd(48) + " " + (r.bytes / 1e6).toFixed(2) + " MB");
      } catch (e) {
        failed++;
        console.error("FAIL " + e.message);
      }
    }
  }),
);
console.log(assets.length - failed + "/" + assets.length + " assets in " + path.relative(process.cwd(), assetsDir) + " (" + (total / 1e6).toFixed(1) + " MB)");
process.exit(failed ? 1 : 0);
