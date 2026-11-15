#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./gmi.mjs";

const walkableRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenes = JSON.parse(fs.readFileSync(path.join(walkableRoot, "scenes.json"), "utf8"));
const inputsPath = path.join(walkableRoot, "inputs.json");
const args = process.argv.slice(2);
const steps = new Set((args.find((a) => a.startsWith("--steps=")) ?? "--steps=images,pano,glb").slice(8).split(","));
const days = args.filter((a) => !a.startsWith("--")).length ? args.filter((a) => !a.startsWith("--")) : scenes.primary;
const IMG = "seedream-5.0-lite";
const PANO_SUFFIX = " Full 360 by 180 degree equirectangular projection, 2:1, the left and right edges join seamlessly, level horizon across the vertical middle, ceiling or sky filling the top edge, floor or ground filling the bottom edge, no people cut off at the seam, no text, no watermark.";

const first = (r) => ({ url: r.files[0]?.url, bytes: r.files[0]?.bytes ?? null, latency_s: r.entry.latency_s, queue_wait_s: r.entry.queue_wait_s, request_id: r.entry.request_id });

async function makeDay(day, inputs) {
  const s = scenes.days[day];
  const outDir = path.join(walkableRoot, "assets", "inputs", day);
  const cur = (inputs.days[day] ??= {});
  if (steps.has("images")) {
    const [concept, eye] = await Promise.all([
      run({ approach: "root", model: IMG, estCostUsd: 0.035, label: day + "-concept", outDir, payload: { prompt: s.concept_prompt, size: "2048x2048", max_images: 1, output_format: "png", watermark: false } }),
      run({ approach: "root", model: IMG, estCostUsd: 0.035, label: day + "-eye", outDir, payload: { prompt: s.eye_level_prompt, size: "2560x1440", max_images: 1, output_format: "png", watermark: false } }),
    ]);
    cur.concept = { ...first(concept), model: IMG, size: "2048x2048", prompt: s.concept_prompt };
    cur.eye = { ...first(eye), model: IMG, size: "2560x1440", prompt: s.eye_level_prompt };
  }
  if (steps.has("pano")) {
    const prompt = s.panorama_prompt + PANO_SUFFIX;
    const [withRef, textOnly] = await Promise.all([
      run({ approach: "root", model: IMG, estCostUsd: 0.035, label: day + "-pano-ref", outDir, payload: { prompt, image: [cur.eye.url], size: "4096x2048", max_images: 1, output_format: "png", watermark: false } }),
      run({ approach: "root", model: IMG, estCostUsd: 0.035, label: day + "-pano-text", outDir, payload: { prompt, size: "4096x2048", max_images: 1, output_format: "png", watermark: false } }),
    ]);
    cur.pano_candidates = {
      ref: { ...first(withRef), model: IMG, size: "4096x2048", reference: "eye", prompt },
      text: { ...first(textOnly), model: IMG, size: "4096x2048", reference: null, prompt },
    };
  }
  if (steps.has("glb")) {
    const glb = await run({ approach: "root", model: "hunyuan-3d-pro", estCostUsd: 0.375, label: day + "-diorama", outDir, timeoutS: 1800, payload: { image_url: cur.concept.url, generate_type: "Normal", face_count: 100000, enable_pbr: false } });
    cur.diorama_glb = { files: glb.files.map((f) => ({ key: f.key, url: f.url, bytes: f.bytes ?? null })), latency_s: glb.entry.latency_s, queue_wait_s: glb.entry.queue_wait_s, request_id: glb.entry.request_id, model: "hunyuan-3d-pro", payload: { generate_type: "Normal", face_count: 100000, enable_pbr: false } };
  }
}

const inputs = JSON.parse(fs.readFileSync(inputsPath, "utf8"));
inputs.note = "Shared base images per primary day, all from GMI. concept: isometric diorama on white for image-to-3D (seedream-5.0-lite 2048x2048). eye: eye-level view (seedream-5.0-lite 2560x1440). pano: equirectangular panorama (seedream-5.0-lite 4096x2048; pano_candidates keeps both the eye-referenced and the text-only take, pano is the pick). diorama_glb: hunyuan-3d-pro from the concept image, run one at a time.";
const results = await Promise.allSettled(days.map((d) => makeDay(d, inputs)));
results.forEach((r, i) => { if (r.status === "rejected") console.error(days[i] + ": " + String(r.reason?.message ?? r.reason)); });
fs.writeFileSync(inputsPath, JSON.stringify(inputs, null, 2) + "\n");
console.log(JSON.stringify(inputs.days, null, 2));
