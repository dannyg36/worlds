#!/usr/bin/env node
// One composite world, end to end: scene spec -> object images (one sprite sheet or one image per object) ->
// image-to-3D per object -> phone-ready GLBs -> worlds/<day>.json set + manifest entries + a timing report.
// Every paid call goes through the spike kit (budget cap + ledger). The run makes at most one image call per
// object (or one sheet call) and one 3D call per object; nothing retries on its own.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { cropSheet, cutout } from "./sheet.mjs";
import { optimizeGlb } from "./optimize.mjs";
import { budgetFor } from "./optimize-set.mjs";
import { compositeDir, assetsDir, readWorld, writeWorld, upsertManifest } from "./worldfile.mjs";
import { provider } from "./providers.mjs";

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
}
const day = args.day;
const setName = args.set;
const mode = args.images || "sheet";
const only = args.only ? String(args.only).split(",") : null;
const skip3d = !!args["images-only"];
const reuseImages = args["reuse-images"] || null;
if (!day || !setName) throw new Error("usage: build-world.mjs --day <day> --set <name> [--images sheet|objects] [--only a,b] [--images-only] [--reuse-images <set>]");

const P = provider(args.provider || "gmi", args);
const world = readWorld(day);
const spec = world.spec;
const objects = spec.objects.filter((o) => !only || only.includes(o.id));
const runDir = path.join(assetsDir, day, setName);
fs.mkdirSync(runDir, { recursive: true });
const t0 = Date.now();
const at = () => +((Date.now() - t0) / 1000).toFixed(2);
const timeline = [];
const mark = (event, extra = {}) => {
  const e = { t: at(), event, ...extra };
  timeline.push(e);
  console.log("[" + e.t.toFixed(1) + "s] " + event + (extra.id ? " " + extra.id : "") + (extra.note ? " · " + extra.note : ""));
};

const objectLine = (o) => o.prompt;
function sheetLayout(n) {
  const cols = Math.ceil(Math.sqrt(n));
  return { cols, rows: Math.ceil(n / cols) };
}
const view = args.view === "front" ? "front view at eye level" : "three-quarter view from slightly above";
function sheetPrompt(list, cols, rows) {
  const cells = list.map((o, k) => "row " + (Math.floor(k / cols) + 1) + ", column " + ((k % cols) + 1) + ": " + objectLine(o)).join("; ");
  return "A sprite sheet of " + list.length + " separate game assets laid out in a strict " + cols + " by " + rows + " grid on one uniform plain pure white background. " +
    "Each asset is small inside its own cell and surrounded by wide empty white space, fully visible, " + view + ", never touching the cell edges or any other asset. No panels, frames, borders or cell backgrounds, no ground, no floor, no cast shadows, no text, no labels. " +
    cells + ". " + spec.style + ".";
}
const objectPrompt = (o) => objectLine(o) + ". A single isolated object, " + view + ", the whole object fully inside the frame with generous empty margin on every side, centered, on a plain flat pure white background, no ground, no floor, no cast shadow, no text. " + spec.style + ".";

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const report = { day, set: setName, provider: P.name, image_mode: mode, image_model: P.imageModel, model3d: P.model3d, payload3d: P.payload3d ?? null, started_at: new Date(t0).toISOString(), objects: {}, timeline, calls: [] };

mark("start", { note: objects.length + " objects via " + mode });
const crops = {};
if (reuseImages) {
  for (const o of objects) {
    const dir = path.join(assetsDir, day, reuseImages);
    crops[o.id] = { image: path.join(dir, "img", o.id + ".png"), cutout: path.join(dir, "img", o.id + ".cutout.png") };
  }
  mark("images reused", { note: reuseImages });
} else if (mode === "sheet") {
  const { cols, rows } = sheetLayout(objects.length);
  const prompt = sheetPrompt(objects, cols, rows);
  const r = await P.image({ prompt, size: args["sheet-size"] || "2048x2048", label: day + "-" + setName + "-sheet", outDir: runDir });
  report.calls.push(r.entry);
  report.sheet = { prompt, cols, rows, url: r.url, local: path.relative(compositeDir, r.local) };
  mark("sheet image", { note: r.entry.latency_s + "s, $" + r.entry.est_cost_usd });
  const c = await cropSheet(r.local, { ids: objects.map((o) => o.id), cols, rows, outDir: path.join(runDir, "img") });
  report.sheet.crop = c.sheet;
  for (const x of c.crops) crops[x.id] = x;
  mark("sheet cropped", { note: c.crops.filter((x) => x.fallback).length + " cells fell back to the cell rectangle" });
} else {
  await Promise.all(objects.map(async (o) => {
    const r = await P.image({ prompt: objectPrompt(o), size: args["object-size"] || "1024x1024", label: day + "-" + setName + "-" + o.id, outDir: runDir });
    report.calls.push(r.entry);
    const dir = path.join(runDir, "img");
    fs.mkdirSync(dir, { recursive: true });
    const image = path.join(dir, o.id + ".png");
    const sharp = (await import("sharp")).default;
    await sharp(r.local).resize(1024, 1024, { fit: "contain", background: "#ffffff" }).png().toFile(image);
    const cut = await cutout(image, path.join(dir, o.id + ".cutout.png"));
    crops[o.id] = { id: o.id, image, cutout: cut, url: r.url };
    mark("object image", { id: o.id, note: r.entry.latency_s + "s" });
  }));
}
mark("images done");

const set = world.sets[setName] || { objects: {} };
set.label = set.label || (P.model3d + " from " + mode + " images (" + P.imageModel + ")");
set.provider = P.name;
const manifest = [];
const optimizeJobs = [];
if (!skip3d) {
  for (const o of objects) {
    const c = crops[o.id];
    const imageUrl = await P.upload(c.image);
    mark("3d submit", { id: o.id });
    let r;
    try {
      r = await P.to3d({ imageUrl, label: day + "-" + setName + "-" + o.id, outDir: path.join(runDir, "raw") });
    } catch (e) {
      mark("3d failed", { id: o.id, note: String(e?.message ?? e).slice(0, 200) });
      continue;
    }
    report.calls.push(r.entry);
    mark("3d done", { id: o.id, note: r.entry.latency_s + "s (queue " + r.entry.queue_wait_s + "s), " + (r.bytes / 1048576).toFixed(1) + " MB" });
    optimizeJobs.push((async () => {
      const file = day + "/" + setName + "/" + o.id + ".glb";
      const opt = await optimizeGlb(r.local, path.join(assetsDir, file), budgetFor(o.size_m));
      const buf = fs.readFileSync(path.join(assetsDir, file));
      set.objects[o.id] = { file, bytes: buf.length, raw_url: r.url, raw_bytes: opt.in_bytes, tris: opt.tris_out, tris_raw: opt.tris_in, textures: opt.textures_out, textures_raw: opt.textures_in, image: path.relative(assetsDir, c.image) };
      report.objects[o.id] = { latency_s: r.entry.latency_s, queue_wait_s: r.entry.queue_wait_s, est_cost_usd: r.entry.est_cost_usd, request_id: r.entry.request_id, raw_url: r.url, raw_bytes: opt.in_bytes, opt_bytes: buf.length, tris_raw: opt.tris_in, tris: opt.tris_out, textures_raw: opt.textures_in, textures: opt.textures_out, optimize_ms: opt.ms };
      manifest.push({ file, sha256: sha(buf), bytes: buf.length, url: null, derive: { from_url: r.url, recipe: "pipeline/optimize.mjs " + JSON.stringify(budgetFor(o.size_m)) } });
      mark("optimized", { id: o.id, note: (opt.in_bytes / 1048576).toFixed(1) + " MB -> " + (buf.length / 1024).toFixed(0) + " KB, tris " + opt.tris_in + " -> " + opt.tris_out });
    })());
  }
  await Promise.all(optimizeJobs);
}
mark("done");
report.wall_s = at();
report.est_cost_usd = +report.calls.reduce((s, e) => s + (e?.est_cost_usd || 0), 0).toFixed(3);
report.download_bytes = Object.values(set.objects).reduce((s, a) => s + (a.bytes || 0), 0);
set.pipeline = { wall_s: report.wall_s, est_cost_usd: report.est_cost_usd, image_mode: mode, image_model: P.imageModel, model3d: P.model3d };
world.sets[setName] = set;
writeWorld(world);
if (manifest.length) upsertManifest(manifest);
const runsDir = path.join(compositeDir, "runs");
fs.mkdirSync(runsDir, { recursive: true });
fs.writeFileSync(path.join(runsDir, day + "-" + setName + ".json"), JSON.stringify(report, null, 2) + "\n");
console.log("wall " + report.wall_s + " s · ~$" + report.est_cost_usd + " · " + (report.download_bytes / 1048576).toFixed(2) + " MB of GLBs · runs/" + day + "-" + setName + ".json");
