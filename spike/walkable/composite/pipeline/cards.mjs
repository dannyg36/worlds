#!/usr/bin/env node
// Turn one image set into cutout cards: key out the background (local flood-fill keyer), estimate CPU depth
// (Depth Anything V2 Small, ONNX) for a shallow relief, write a palette PNG + depth PNG per object, optionally upload
// both to GMI storage, and register a "cards" set in worlds/<day>.json plus manifest entries.
//   node pipeline/cards.mjs --day hackathon --from gmi-objects-front --to cards-front [--upload] [--max 768]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { cutout } from "./sheet.mjs";
import { depthForCutout } from "./depth.mjs";
import { compositeDir, assetsDir, readWorld, writeWorld, upsertManifest } from "./worldfile.mjs";

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
}
const { day, from, to } = args;
const maxSide = Number(args.max || 768);
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const world = readWorld(day);
const srcDir = path.join(assetsDir, day, from, "img");
const outDir = path.join(assetsDir, day, to);
fs.mkdirSync(outDir, { recursive: true });
const only = args.only ? String(args.only).split(",") : null;
const ids = world.spec.objects.map((o) => o.id).filter((id) => fs.existsSync(path.join(srcDir, id + ".png")) && (!only || only.includes(id)));
const upload = args.upload ? (await import("../../kit/gmi.mjs")).upload : null;

const t0 = Date.now();
const set = world.sets[to] || { objects: {} };
set.label = "cutout cards from " + from + " (local keyer + Depth Anything V2 Small relief)";
set.kind = "cards";
const manifest = [];
const timings = {};
async function brIaCutout(id) {
  const dir = path.join(assetsDir, day, from, "rmbg");
  const local = path.join(dir, id + ".png");
  if (fs.existsSync(local)) return local;
  const resPath = path.join(dir, day + "-" + from + "-rmbg-" + id + ".result.json");
  if (!fs.existsSync(resPath)) return null;
  const url = JSON.parse(fs.readFileSync(resPath, "utf8")).entry.files[0]?.url;
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  fs.writeFileSync(local, Buffer.from(await res.arrayBuffer()));
  return local;
}

function topFraction(alpha, w, h) {
  const cov = [];
  for (let y = 0; y < h; y++) {
    let c = 0;
    for (let x = 0; x < w; x++) if (alpha[y * w + x] > 127) c++;
    cov.push(c);
  }
  const max = Math.max(...cov);
  const top = cov.findIndex((c) => c >= max * 0.75);
  return +(1 - top / h).toFixed(3);
}

for (const id of ids) {
  const t = Date.now();
  const cut = path.join(outDir, id + ".cutout-full.png");
  const bria = args.keyer === "local" ? null : await brIaCutout(id);
  if (bria) await sharp(bria).trim({ threshold: 1 }).png().toFile(cut);
  else await cutout(path.join(srcDir, id + ".png"), cut);
  const tCut = Date.now() - t;
  const imgFile = day + "/" + to + "/" + id + ".png";
  const imgPath = path.join(assetsDir, imgFile);
  await sharp(cut).resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true }).png({ palette: true, quality: 92, effort: 8 }).toFile(imgPath);
  const meta = await sharp(imgPath).metadata();
  const alpha = await sharp(imgPath).ensureAlpha().extractChannel(3).raw().toBuffer();
  const depthFile = day + "/" + to + "/" + id + ".depth.png";
  const d = await depthForCutout(imgPath, path.join(assetsDir, depthFile), { size: 192 });
  const entry = { card: { image: imgFile, depth: depthFile, width: meta.width, height: meta.height, top_frac: topFraction(alpha, meta.width, meta.height), keyer: bria ? "bria-image-remove-background" : "local" }, bytes: fs.statSync(imgPath).size + fs.statSync(path.join(assetsDir, depthFile)).size };
  for (const f of [imgFile, depthFile]) {
    const buf = fs.readFileSync(path.join(assetsDir, f));
    manifest.push({ file: f, bytes: buf.length, sha256: sha(buf), url: upload ? await upload(path.join(assetsDir, f)) : null });
  }
  set.objects[id] = entry;
  timings[id] = { cutout_ms: tCut, depth_ms: d.ms, depth_infer_ms: d.infer_ms, total_ms: Date.now() - t, png_kb: Math.round(fs.statSync(imgPath).size / 1024), size: meta.width + "x" + meta.height };
  console.log(id.padEnd(11), JSON.stringify(timings[id]));
}
set.cards_ms = Date.now() - t0;
set.source = from;
world.sets[to] = set;
writeWorld(world);
if (manifest.length) upsertManifest(manifest.filter((m) => m.url));
console.log(to + ": " + ids.length + " cards in " + set.cards_ms + " ms" + (upload ? " (uploaded)" : ""));
fs.mkdirSync(path.join(compositeDir, "runs"), { recursive: true });
fs.writeFileSync(path.join(compositeDir, "runs", day + "-" + to + ".json"), JSON.stringify({ day, from, to, cards_ms: set.cards_ms, timings }, null, 2) + "\n");
