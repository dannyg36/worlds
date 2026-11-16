#!/usr/bin/env node
// Adds or updates entries in manifest.json from a URL (downloads it to compute bytes and sha256, keeps the copy in assets/).
//   node tools/manifest-add.mjs --section assets --id hackathon-pano --path hackathon/pano.spz --url https://... [--meta '{"day":"hackathon"}']
//   node tools/manifest-add.mjs --section vendor --path vendor/three.module.js --url https://...
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const manifestPath = path.join(root, "manifest.json");

export async function addEntry({ section = "assets", id, path: rel, url, meta = {} }) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const local = path.join(root, "assets", rel);
  let buf;
  if (fs.existsSync(local)) buf = fs.readFileSync(local);
  else {
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
    buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(local), { recursive: true });
    fs.writeFileSync(local, buf);
  }
  const entry = { ...(id ? { id } : {}), path: rel, url, bytes: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex"), ...meta };
  manifest[section] = manifest[section] ?? [];
  const key = (e) => (id ? e.id === id : e.path === rel);
  const i = manifest[section].findIndex(key);
  if (i >= 0) manifest[section][i] = { ...manifest[section][i], ...entry };
  else manifest[section].push(entry);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return entry;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
  const entry = await addEntry({ section: args.section, id: args.id, path: args.path, url: args.url, meta: args.meta ? JSON.parse(args.meta) : {} });
  console.log(JSON.stringify(entry));
}
