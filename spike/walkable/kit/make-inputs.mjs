#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./fal.mjs";

const walkableRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenes = JSON.parse(fs.readFileSync(path.join(walkableRoot, "scenes.json"), "utf8"));
const inputsPath = path.join(walkableRoot, "inputs.json");
const days = process.argv.slice(2).length ? process.argv.slice(2) : scenes.primary;

const pick = (data, entry, extra) => {
  const img = data.images?.[0] ?? data.image;
  return { url: img.url, width: img.width ?? null, height: img.height ?? null, bytes: entry.output_bytes, latency_s: entry.latency_s, request_id: entry.request_id, ...extra };
};

async function makeDay(day) {
  const s = scenes.days[day];
  const outDir = path.join(walkableRoot, "assets", "inputs", day);
  const nb = "fal-ai/nano-banana-2";
  const [concept, eye] = await Promise.all([
    run({ approach: "root", endpoint: nb, estCostUsd: 0.08, label: day + "-concept", outDir, input: { prompt: s.concept_prompt, aspect_ratio: "1:1", resolution: "1K", output_format: "png", num_images: 1 } }),
    run({ approach: "root", endpoint: nb, estCostUsd: 0.08, label: day + "-eye", outDir, input: { prompt: s.eye_level_prompt, aspect_ratio: "16:9", resolution: "1K", output_format: "png", num_images: 1 } }),
  ]);
  const eyeOut = pick(eye.data, eye.entry, { model: nb, prompt: s.eye_level_prompt });
  const pano = await run({ approach: "root", endpoint: "fal-ai/hunyuan_world", estCostUsd: 0.15, label: day + "-pano", outDir, input: { image_url: eyeOut.url, prompt: s.panorama_prompt } });
  return {
    concept: pick(concept.data, concept.entry, { model: nb, prompt: s.concept_prompt }),
    eye: eyeOut,
    pano: pick(pano.data, pano.entry, { model: "fal-ai/hunyuan_world", prompt: s.panorama_prompt, from: "eye" }),
  };
}

const results = await Promise.allSettled(days.map(makeDay));
const inputs = JSON.parse(fs.readFileSync(inputsPath, "utf8"));
inputs.note = "Shared base images per primary day, fal CDN URLs. concept: isometric diorama on white for image-to-3D (fal-ai/nano-banana-2, 1:1, 1K). eye: eye-level view (fal-ai/nano-banana-2, 16:9, 1K). pano: equirectangular panorama from the eye image (fal-ai/hunyuan_world, 1920x960).";
results.forEach((r, i) => {
  if (r.status === "fulfilled") inputs.days[days[i]] = r.value;
  else console.error(days[i] + ": " + String(r.reason?.message ?? r.reason));
});
fs.writeFileSync(inputsPath, JSON.stringify(inputs, null, 2) + "\n");
console.log(JSON.stringify(inputs.days, null, 2));
