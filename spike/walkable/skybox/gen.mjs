#!/usr/bin/env node
// Bounded GMI generation jobs for the skybox approach. Every job is exactly one paid call, run only when named.
//   node spike/walkable/skybox/gen.mjs list
//   node spike/walkable/skybox/gen.mjs shared hackathon            # download the root's shared inputs (free)
//   node spike/walkable/skybox/gen.mjs run hackathon:klein santa-cruz:klein
//   node spike/walkable/skybox/gen.mjs publish hackathon klein [src]  # jpg + upload + manifest entry
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { run, upload } from "../kit/gmi.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const walk = path.resolve(here, "..");
const scenes = JSON.parse(fs.readFileSync(path.join(walk, "scenes.json"), "utf8"));
const inputsPath = path.join(walk, "inputs.json");
const manifestPath = path.join(here, "manifest.json");
const genDir = (day) => path.join(here, "assets", "gen", day);
const SEAMLESS = " Seamless 360-degree equirectangular projection in a 2:1 frame: the left and right edges join without a seam, the horizon is level across the middle of the frame, the camera stands at eye height, and straight vertical lines stay vertical.";
const SHARED = {
  concept: (d) => d.concept,
  eye: (d) => d.eye,
  "seedream-text": (d) => d.pano_candidates?.text,
  "seedream-ref": (d) => d.pano_candidates?.ref,
};
const SHARED_LABELS = { "seedream-text": "Seedream 5.0 lite (text, root's pick)", "seedream-ref": "Seedream 5.0 lite (eye-referenced)" };

function inputUrl(day, kind) {
  const d = JSON.parse(fs.readFileSync(inputsPath, "utf8")).days?.[day];
  const url = d?.[kind]?.url;
  if (!url) throw new Error("inputs.json has no " + kind + " image for " + day + " yet");
  return url;
}

function sideFile(day, name) {
  const p = path.join(genDir(day), name);
  if (!fs.existsSync(p)) throw new Error("missing " + path.relative(process.cwd(), p) + "; run its prep step first");
  return JSON.parse(fs.readFileSync(p, "utf8")).url;
}

const methods = {
  klein: { model: "Flux2-Klein", est: 0.01, label: "FLUX.2 Klein (text, 1024x512 cap)", payload: (s) => ({ prompt: s.panorama_prompt, width: 1024, height: 512 }) },
  fluxdev: { model: "Flux2-Dev", est: 0.01, label: "FLUX.2 Dev (text, 1024x512 cap)", payload: (s) => ({ prompt: s.panorama_prompt, width: 1024, height: 512 }) },
  qwen: { model: "Qwen-Image-2512", est: 0.01, label: "Qwen-Image 2512 (text)", payload: (s) => ({ prompt: s.panorama_prompt, negative_prompt: " ", width: 2048, height: 1024 }) },
  gpt: { model: "gpt-image-2.5-flare-generate", est: 0.028, label: "GPT Image 2.5 flare (text, control)", payload: (s) => ({ prompt: s.panorama_prompt + "." + SEAMLESS, size: "2048x1024", quality: "medium", output_format: "png", n: 1 }) },
  "wan-outpaint": { model: "wan2.7-image", est: 0.03, label: "Wan 2.7 outpaint (eye image on 2:1 canvas)", payload: (s, day) => ({ text: "Fill the green area to complete a seamless 360-degree equirectangular panorama around the photo in the middle: same place, same style, same light, level horizon, left and right edges match. " + s.panorama_prompt, image: [sideFile(day, "control.json")], size: "2K", n: 1 }) },
};

const special = {
  upscale: { model: "bria-image-increase-resolution", est: 0.02, payload: (day, src) => ({ image: publishedUrl(day, src), desired_increase: 2 }) },
  seamfix: { model: "bria-genfill", est: 0.04, payload: (day, src) => ({ image: sideFile(day, src + "-rolled.json"), mask: sideFile(day, "seam-mask.json"), prompt: scenes.days[day].panorama_prompt }) },
  cutout: { model: "bria-image-remove-background", est: 0.018, payload: (day) => ({ image: inputUrl(day, "concept") }) },
};

function publishedUrl(day, id) {
  const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const p = m.days[day]?.panos?.find((x) => x.id === id);
  if (!p?.url) throw new Error("publish " + day + " " + id + " first");
  return p.url;
}

function job(id) {
  const [day, name, src] = id.split(":");
  if (!scenes.days[day]) throw new Error("unknown day in " + id);
  if (methods[name]) {
    const m = methods[name];
    return { day, label: day + "-" + name, model: m.model, est: m.est, payload: () => m.payload(scenes.days[day], day) };
  }
  if (special[name]) {
    const m = special[name];
    return { day, label: day + "-" + name + (src ? "-" + src : ""), model: m.model, est: m.est, payload: () => m.payload(day, src) };
  }
  throw new Error("unknown job " + id + "; methods: " + Object.keys(methods).join(", ") + "; special: upscale:<pano>, seamfix:<pano>, cutout");
}

function firstImage(dir, label) {
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(label + "__") && /\.(png|jpe?g|webp)$/i.test(f));
  if (!files.length) throw new Error("no image output for " + label + " in " + dir);
  return path.join(dir, files[0]);
}

async function shared(day) {
  const d = JSON.parse(fs.readFileSync(inputsPath, "utf8")).days?.[day];
  if (!d) throw new Error("inputs.json has no day " + day);
  fs.mkdirSync(genDir(day), { recursive: true });
  for (const [id, pick] of Object.entries(SHARED)) {
    const src = pick(d);
    if (!src?.url) { console.log(id.padEnd(16) + "not in inputs.json yet"); continue; }
    const out = path.join(genDir(day), day + "-" + id + "__shared" + path.extname(new URL(src.url).pathname));
    if (!fs.existsSync(out)) {
      const res = await fetch(src.url);
      if (!res.ok) throw new Error(id + ": HTTP " + res.status);
      fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    }
    console.log(id.padEnd(16) + path.relative(process.cwd(), out) + " " + fs.statSync(out).size + " bytes");
  }
}

function sharedResult(day, id) {
  const src = SHARED[id](JSON.parse(fs.readFileSync(inputsPath, "utf8")).days[day]);
  return { model: src.model, entry: { est_cost_usd: 0, latency_s: src.latency_s, queue_wait_s: src.queue_wait_s, request_id: src.request_id, files: [{ url: src.url, bytes: src.bytes }] } };
}

async function publish(day, id, srcFile = null) {
  const dir = genDir(day);
  const isShared = !!SHARED_LABELS[id];
  const result = isShared ? sharedResult(day, id) : JSON.parse(fs.readFileSync(path.join(dir, day + "-" + id + ".result.json"), "utf8"));
  const src = srcFile ? path.resolve(srcFile) : firstImage(dir, day + "-" + id);
  const extra = isShared ? { label: SHARED_LABELS[id], paid_by: "root" } : {};
  const jpg = path.join(dir, "pano-" + id + ".jpeg");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", src, "-q:v", "4", jpg]);
  const [w, h] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", jpg]).toString().trim().split(",").map(Number);
  const url = await upload(jpg);
  const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const dayCfg = m.days[day];
  const entry = {
    id,
    label: methods[id]?.label ?? extra.label ?? id,
    file: day + "/pano-" + id + ".jpeg",
    url,
    bytes: fs.statSync(jpg).size,
    width: w,
    height: h,
    endpoint: result.model,
    est_cost_usd: result.entry.est_cost_usd,
    latency_s: result.entry.latency_s,
    queue_wait_s: result.entry.queue_wait_s,
    request_id: result.entry.request_id,
    source_url: result.entry.files[0]?.url ?? null,
    source_bytes: result.entry.files[0]?.bytes ?? null,
    ...extra,
  };
  dayCfg.panos = (dayCfg.panos || []).filter((p) => p.id !== id && !p.file.startsWith("_sample/"));
  dayCfg.panos.push(entry);
  if (!dayCfg.default_pano || dayCfg.default_pano === "sample") dayCfg.default_pano = id;
  fs.mkdirSync(path.join(here, "assets", day), { recursive: true });
  fs.copyFileSync(jpg, path.join(here, "assets", day, "pano-" + id + ".jpeg"));
  fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + "\n");
  return entry;
}

async function card(day) {
  const dir = genDir(day);
  const result = JSON.parse(fs.readFileSync(path.join(dir, day + "-cutout.result.json"), "utf8"));
  const png = path.join(dir, "card.png");
  const info = JSON.parse(execFileSync("uv", ["run", "-q", "--with", "numpy", "--with", "pillow", "python", path.join(here, "tools", "pano.py"), "cutout", firstImage(dir, day + "-cutout"), png]).toString());
  const url = await upload(png);
  const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  m.days[day].card = {
    file: day + "/card.png",
    label: "Concept image cutout (billboard stand-in for the diorama GLB)",
    url,
    bytes: fs.statSync(png).size,
    width: info.size[0],
    height: info.size[1],
    endpoint: result.model,
    est_cost_usd: result.entry.est_cost_usd,
    latency_s: result.entry.latency_s,
    request_id: result.entry.request_id,
  };
  fs.mkdirSync(path.join(here, "assets", day), { recursive: true });
  fs.copyFileSync(png, path.join(here, "assets", day, "card.png"));
  fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + "\n");
  return m.days[day].card;
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "list") {
  for (const day of scenes.primary) {
    for (const [k, m] of Object.entries(methods)) console.log((day + ":" + k).padEnd(28) + m.model.padEnd(32) + "~$" + m.est);
    console.log((day + ":cutout").padEnd(28) + special.cutout.model.padEnd(32) + "~$" + special.cutout.est);
  }
} else if (cmd === "run") {
  const jobs = rest.map(job);
  const total = jobs.reduce((s, j) => s + j.est, 0);
  console.error("running " + jobs.length + " job(s), est ~$" + total.toFixed(3));
  const results = await Promise.allSettled(jobs.map((j) => run({ approach: "skybox", model: j.model, payload: j.payload(), estCostUsd: j.est, label: j.label, outDir: genDir(j.day), is3d: j.is3d || null })));
  results.forEach((r, i) => console.log(jobs[i].label.padEnd(36) + (r.status === "fulfilled" ? "ok " + r.value.entry.latency_s + "s queue " + r.value.entry.queue_wait_s + "s " + (r.value.entry.output_bytes || 0) + " bytes" : "FAILED " + String(r.reason?.message ?? r.reason).slice(0, 400))));
} else if (cmd === "shared") {
  for (const day of rest.length ? rest : scenes.primary) await shared(day);
} else if (cmd === "card") {
  for (const day of rest.length ? rest : scenes.primary) console.log(JSON.stringify(await card(day)));
} else if (cmd === "publish") {
  console.log(JSON.stringify(await publish(rest[0], rest[1], rest[2]), null, 2));
} else {
  console.log("usage: gen.mjs list | shared [day...] | run <day:method>... | publish <day> <id> [src]");
}
