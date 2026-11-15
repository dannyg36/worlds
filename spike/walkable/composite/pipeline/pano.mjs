#!/usr/bin/env node
// Shared panorama -> phone-weight JPEG backdrop, uploaded to GMI storage, registered in worlds/<day>.json + manifest.
//   node pipeline/pano.mjs --day hackathon [--width 4096] [--quality 82] [--upload]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { walkableDir, assetsDir, readWorld, writeWorld, upsertManifest } from "./worldfile.mjs";

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
}
const day = args.day;
const inputs = JSON.parse(fs.readFileSync(path.join(walkableDir, "inputs.json"), "utf8"));
const src = inputs.days[day]?.pano;
if (!src) throw new Error("no shared pano for " + day);
const res = await fetch(src.url);
if (!res.ok) throw new Error("pano download " + res.status);
const raw = Buffer.from(await res.arrayBuffer());
const width = Number(args.width || 4096);
const file = day + "/pano-" + width + ".jpeg";
const out = path.join(assetsDir, file);
fs.mkdirSync(path.dirname(out), { recursive: true });
await sharp(raw).resize(width, width / 2, { fit: "fill" }).jpeg({ quality: Number(args.quality || 82), mozjpeg: true }).toFile(out);
const buf = fs.readFileSync(out);
const url = args.upload ? await (await import("../../kit/gmi.mjs")).upload(out) : null;
const world = readWorld(day);
world.panorama = { file, bytes: buf.length, source_url: src.url, source_bytes: raw.length, model: src.model, size: width + "x" + width / 2, yaw_deg: world.panorama?.yaw_deg ?? 0, height_m: world.panorama?.height_m ?? 1.7 };
writeWorld(world);
if (url) upsertManifest([{ file, bytes: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex"), url }]);
console.log(file, (raw.length / 1048576).toFixed(1) + " MB png -> " + (buf.length / 1048576).toFixed(2) + " MB jpg", url ? "uploaded" : "");
