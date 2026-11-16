#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2] || path.join(root, "stats.jsonl");
const filter = process.argv[3] || "iPhone";
const rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => (r.user_agent || "").includes(filter) && r.session);

const median = (xs) => {
  const s = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const groups = new Map();
for (const r of rows) {
  if (r.reason !== "tick" || r.tour || r.recording || !r.frame_ms_5s?.n || r.frame_ms_5s.n < 100) continue;
  const key = [r.day, r.pano, r.mode, r.mode === "stand" ? r.scale : "-"].join(" | ");
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}
console.log("| day | pano | mode | scale | samples | FPS (median) | frame ms avg | p95 | max | draw calls | tris | est GPU MB |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const [key, rs] of [...groups.entries()].sort()) {
  console.log("| " + key + " | " + rs.length + " | " + median(rs.map((r) => r.frame_ms_5s.fps)) + " | " + median(rs.map((r) => r.frame_ms_5s.avg)) + " | " + median(rs.map((r) => r.frame_ms_5s.p95)) + " | " + Math.max(...rs.map((r) => r.frame_ms_5s.max)) + " | " + median(rs.map((r) => r.render.calls)) + " | " + median(rs.map((r) => r.render.triangles)) + " | " + median(rs.map((r) => r.est_gpu_mb)) + " |");
}
const loads = rows.filter((r) => r.reason === "loaded");
console.log("\n| session | day | pano | pano bytes | pano fetch/decode/pmrem/first render ms | glb bytes | glb fetch/parse ms | compile ms | TTFF ms |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const r of loads) {
  const p = r.pano_load, g = r.glb_load;
  console.log("| " + r.session.slice(0, 8) + " | " + r.day + " | " + r.pano + " | " + p.bytes + " | " + [p.ms.fetch, p.ms.decode, p.ms.pmrem, Math.round(p.first_render_ms)].join(" / ") + " | " + g.bytes + " | " + [g.ms.fetch, g.ms.parse].join(" / ") + " | " + (r.compile_ms ?? "-") + " | " + r.ttff_ms + " |");
}
const last = rows[rows.length - 1];
if (last) console.log("\ndevice: " + last.user_agent + " | screen " + last.screen.join("x") + " @" + last.device_dpr + "x | " + last.gl.renderer + " | " + last.gl.version + " | MAX_TEXTURE_SIZE " + last.gl.maxTexture + " | cube " + last.gl.maxCubeMap + " | samples " + last.gl.maxSamples + " | hw threads " + last.nav.hw + " | gyro events " + Math.max(...rows.map((r) => r.gyro?.events ?? 0)));
