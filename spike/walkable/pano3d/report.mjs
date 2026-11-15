#!/usr/bin/env node
// Prints the measurement table for RESULTS.md from out/<day>/ (info.json, views.json, source.json) and manifest.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);
const manifest = read(path.join(here, "manifest.json"));
const mb = (b) => (b / 1e6).toFixed(2);
const rows = [];
for (const day of process.argv.slice(2).length ? process.argv.slice(2) : ["hackathon", "santa-cruz"]) {
  const dir = path.join(here, "out", day);
  const info = read(path.join(dir, "info.json")) ?? {};
  const vj = read(path.join(dir, "views.json")) ?? {};
  const src = read(path.join(dir, "source.json")) ?? {};
  const files = manifest?.days?.[day]?.files ?? {};
  const size = (f) => files[f]?.bytes ?? (fs.existsSync(path.join(dir, f)) ? fs.statSync(path.join(dir, f)).size : 0);
  for (const [m, label] of [["moge2-fused", "MoGe-2 ViT-L x14 crops"], ["da2-fused", "DA2 metric-S x14 crops"], ["da2-equirect", "DA2 metric-S one-shot equirect"]]) {
    const e = info[m];
    if (!e) continue;
    const f = e.fuse ?? {};
    const cpu = m === "moge2-fused" ? vj.moge_local : m === "da2-fused" ? vj.da2_local : f;
    const perView = m === "moge2-fused" ? vj.views?.map((v) => v.moge?.infer_s).filter((x) => x) : m === "da2-fused" ? vj.views?.map((v) => v.da2?.infer_s).filter((x) => x) : [];
    const depthCpu = m === "da2-equirect" ? f.infer_s : perView.reduce((a, b) => a + b, 0);
    const bytes = { pano: size("pano.jpg"), depth: size(e.prefix + "depth.png"), bg: size(e.bg?.tex), bgdepth: size(e.bg?.depth) };
    rows.push({
      day, method: label, model: cpu?.model ?? f.model,
      depth_cpu_s: +depthCpu.toFixed(1), per_crop_s: perView.length ? +(depthCpu / perView.length).toFixed(2) : null, crops_timed: perView.length || 1,
      load_s: cpu?.load_s ?? null, split_s: m === "da2-equirect" ? 0 : +(vj.split_ms / 1000).toFixed(1), fuse_s: +(((f.load_ms ?? 0) + (f.fuse_ms ?? 0)) / 1000).toFixed(1), post_s: +((e.post_ms ?? 0) / 1000).toFixed(1),
      align_resid_pct: f.align_mean_abs_residual_pct ?? null, raw_cam_h_m: f.moge_camera_height_m ?? f.raw_camera_height_m ?? null, far_m: f.far_m ?? null, far_px_pct: f.far_px_pct ?? null,
      depth_range_m: [Math.exp(e.depthInfo.lnMin).toFixed(2), Math.exp(e.depthInfo.lnMax).toFixed(1)].join("-"),
      bg_masked_pct: e.bg?.masked_px_pct ?? null, walk_free_cells: e.walk?.grid?.free_cells ?? null,
      bytes, download_mb: +mb(bytes.pano + bytes.depth + bytes.bg + bytes.bgdepth),
      pano_source: src.source_px + " " + src.source_format + " " + mb(src.source_bytes ?? 0) + " MB",
    });
  }
}
if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
else {
  console.log("| day | method | depth CPU s (per crop) | split + fuse + post s | overlap residual | depth range m | far px | download MB (pano + depth + bg + bgdepth) |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of rows) console.log("| " + [r.day, r.method, r.depth_cpu_s + (r.per_crop_s ? " (" + r.per_crop_s + ")" : ""), [r.split_s, r.fuse_s, r.post_s].join(" + "), r.align_resid_pct == null ? "n/a" : r.align_resid_pct + "%", r.depth_range_m, r.far_px_pct == null ? "n/a" : r.far_px_pct + "%", r.download_mb + " (" + [r.bytes.pano, r.bytes.depth, r.bytes.bg, r.bytes.bgdepth].map(mb).join(" + ") + ")"].join(" | ") + " |");
}
