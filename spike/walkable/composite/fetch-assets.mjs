#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(here, "manifest.json"), "utf8"));
const assetsDir = path.join(here, "assets");
const force = process.argv.includes("--force");
const dayArg = process.argv.find((a) => a.startsWith("--day="))?.slice(6);
const files = manifest.files.filter((f) => !dayArg || f.file.startsWith(dayArg + "/"));

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

async function fetchOne(f) {
  const dest = path.join(assetsDir, f.file);
  if (!force && fs.existsSync(dest)) {
    const buf = fs.readFileSync(dest);
    if ((!f.bytes || buf.length === f.bytes) && (!f.sha256 || sha256(buf) === f.sha256)) return { file: f.file, bytes: buf.length, cached: true };
  }
  const res = await fetch(f.url);
  if (!res.ok) throw new Error(f.file + ": HTTP " + res.status + " from " + f.url);
  const buf = Buffer.from(await res.arrayBuffer());
  if (f.sha256 && sha256(buf) !== f.sha256) throw new Error(f.file + ": sha256 mismatch (expected " + f.sha256 + ")");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return { file: f.file, bytes: buf.length, cached: false };
}

const t0 = Date.now();
const results = [];
const failures = [];
const queue = [...files];
await Promise.all(Array.from({ length: 6 }, async () => {
  while (queue.length) {
    const f = queue.shift();
    try {
      const r = await fetchOne(f);
      results.push(r);
      console.log((r.cached ? "cached " : "fetched") + " " + r.file + " (" + (r.bytes / 1024).toFixed(0) + " KB)");
    } catch (e) {
      failures.push(String(e?.message ?? e));
      console.error("FAILED " + String(e?.message ?? e));
    }
  }
}));
const total = results.reduce((s, r) => s + r.bytes, 0);
console.log(results.length + "/" + files.length + " files, " + (total / 1048576).toFixed(2) + " MB in assets/, " + ((Date.now() - t0) / 1000).toFixed(1) + " s");
if (failures.length) process.exit(1);
