#!/usr/bin/env node
// CPU monocular depth for cutout cards: Depth Anything V2 Small (ONNX, transformers.js), normalized inside the
// cutout's alpha mask, pushed outward past the silhouette so the relief mesh has no rubber-sheet edge, and blurred.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

let estimator = null;
async function getEstimator() {
  if (estimator) return estimator;
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = path.join(os.homedir(), ".capy/work/hf-cache");
  estimator = await pipeline("depth-estimation", process.env.DEPTH_MODEL || "onnx-community/depth-anything-v2-small", { dtype: process.env.DEPTH_DTYPE || "fp32", device: "cpu" });
  return estimator;
}

export async function depthForCutout(cutoutPath, outPath, { size = 256 } = {}) {
  const t0 = Date.now();
  const est = await getEstimator();
  const { RawImage } = await import("@huggingface/transformers");
  const meta = await sharp(cutoutPath).metadata();
  const flat = await sharp(cutoutPath).flatten({ background: "#ffffff" }).png().toBuffer();
  const tmp = path.join(os.tmpdir(), "depth-in-" + process.pid + "-" + Math.random().toString(36).slice(2) + ".png");
  fs.writeFileSync(tmp, flat);
  const img = await RawImage.read(tmp);
  const tInfer = Date.now();
  const out = await est(img);
  const inferMs = Date.now() - tInfer;
  fs.rmSync(tmp, { force: true });
  const d = out.depth;
  const w = Math.max(16, Math.round(size * Math.min(1, meta.width / meta.height)));
  const h = Math.max(16, Math.round(size * Math.min(1, meta.height / meta.width)));
  const depthRaw = await sharp(Buffer.from(d.data), { raw: { width: d.width, height: d.height, channels: d.channels } }).resize(w, h, { fit: "fill" }).greyscale().raw().toBuffer();
  const alphaRaw = await sharp(cutoutPath).ensureAlpha().extractChannel(3).resize(w, h, { fit: "fill" }).raw().toBuffer();
  const n = w * h;
  const mask = new Uint8Array(n);
  let lo = 255, hi = 0;
  for (let i = 0; i < n; i++) {
    if (alphaRaw[i] > 127) {
      mask[i] = 1;
      lo = Math.min(lo, depthRaw[i]);
      hi = Math.max(hi, depthRaw[i]);
    }
  }
  const val = new Float32Array(n);
  for (let i = 0; i < n; i++) val[i] = mask[i] ? (depthRaw[i] - lo) / Math.max(1, hi - lo) : -1;
  const filled = Float32Array.from(val);
  for (let pass = 0; pass < Math.max(w, h); pass++) {
    let changed = false;
    const src = Float32Array.from(filled);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (src[i] >= 0) continue;
        let s = 0, c = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const v = src[yy * w + xx];
          if (v >= 0) { s += v; c++; }
        }
        if (c) { filled[i] = (s / c) * 0.985; changed = true; }
      }
    }
    if (!changed) break;
  }
  const bytes = Buffer.alloc(n);
  for (let i = 0; i < n; i++) bytes[i] = Math.round(Math.max(0, filled[i]) * 255);
  await sharp(bytes, { raw: { width: w, height: h, channels: 1 } }).blur(1.2).png().toFile(outPath);
  return { out: outPath, w, h, infer_ms: inferMs, ms: Date.now() - t0, mask_coverage: +(mask.reduce((s, v) => s + v, 0) / n).toFixed(3) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output] = process.argv.slice(2);
  const t = Date.now();
  const r = await depthForCutout(input, output);
  console.log(JSON.stringify({ ...r, total_ms: Date.now() - t }));
}
