#!/usr/bin/env node
// Panorama -> walkable Gaussian-splat world (experiment 2).
//
//   node tools/pano-world.mjs --id hackathon-pano --day hackathon --pano <url|path> --depth moge3 [--upload]
//   node tools/pano-world.mjs --id dev-box --pano assets/marble/rustic_kitchen_pano.png --depth box      (no fal, analytic room)
//
// Depth: the equirect is cut into 6 cube faces at --fov degrees (default 100, so neighbours overlap), each face goes
// through microsoft/moge-3 with the known fov_x, the returned point clouds become per-face range maps, faces are
// scale-aligned on their overlaps, fused back into an equirect range map, and the whole world is scaled so the
// camera sits --eye metres (default 1.6) above the floor straight below it.
// Splats: one surfel per equirect pixel (rows near the poles merged to equal area), centred on its 3D point,
// oriented along the local surface (tangents from neighbouring pixels, never across depth edges), sized
// --k x the pixel footprint, coloured from the panorama. Written as SPZ v2 at several resolutions.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { encodeSpz, readPly, quatFromBasis, dirFromLonLat } from "./splatlib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const splatsRoot = path.resolve(here, "..");
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const v = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
  args[a.slice(2)] = v;
}
const id = args.id || "pano-world";
const fov = Number(args.fov || 100);
const faceSize = Number(args.face || 1000);
const eyeH = Number(args.eye || 1.6);
const kScale = Number(args.k || 0.65);
const skyRange = Number(args.sky || 120);
const depthMode = args.depth || "moge3";
const workDir = path.join(splatsRoot, "work", id);
fs.mkdirSync(workDir, { recursive: true });
const timings = {};
const T0 = Date.now();
const lap = (name, t) => { timings[name] = +((Date.now() - t) / 1000).toFixed(2); console.error("[" + id + "] " + name + " " + timings[name] + " s"); };

// ---------- panorama ----------
let t = Date.now();
let panoBuf;
if (/^https?:/.test(args.pano)) {
  const res = await fetch(args.pano);
  if (!res.ok) throw new Error("pano HTTP " + res.status);
  panoBuf = Buffer.from(await res.arrayBuffer());
} else panoBuf = fs.readFileSync(path.resolve(process.cwd(), args.pano));
const panoImg = sharp(panoBuf).removeAlpha().toColorspace("srgb");
const { data: pano, info: panoInfo } = await panoImg.raw().toBuffer({ resolveWithObject: true });
const PW = panoInfo.width, PH = panoInfo.height;
lap("load_pano", t);
console.error("[" + id + "] pano " + PW + "x" + PH);

// ---------- faces ----------
const FACES = [
  { name: "front", f: [0, 0, -1], r: [1, 0, 0] },
  { name: "right", f: [1, 0, 0], r: [0, 0, 1] },
  { name: "back", f: [0, 0, 1], r: [-1, 0, 0] },
  { name: "left", f: [-1, 0, 0], r: [0, 0, -1] },
  { name: "up", f: [0, 1, 0], r: [1, 0, 0] },
  { name: "down", f: [0, -1, 0], r: [1, 0, 0] },
].map((F) => ({ ...F, d: [F.f[1] * F.r[2] - F.f[2] * F.r[1], F.f[2] * F.r[0] - F.f[0] * F.r[2], F.f[0] * F.r[1] - F.f[1] * F.r[0]] }));
const tanHalf = Math.tan((fov * Math.PI) / 360);

function bilinearPano(lon, lat, out) {
  const fu = (lon / (2 * Math.PI) + 0.5) * PW - 0.5;
  const fv = Math.min(PH - 1, Math.max(0, (0.5 - lat / Math.PI) * PH - 0.5));
  const u0 = Math.floor(fu), v0 = Math.floor(fv), tu = fu - u0, tv = fv - v0;
  const ua = ((u0 % PW) + PW) % PW, ub = (ua + 1) % PW, vb = Math.min(PH - 1, v0 + 1);
  for (let c = 0; c < 3; c++) {
    const a = pano[(v0 * PW + ua) * 3 + c], b = pano[(v0 * PW + ub) * 3 + c], cc = pano[(vb * PW + ua) * 3 + c], d = pano[(vb * PW + ub) * 3 + c];
    out[c] = (a * (1 - tu) + b * tu) * (1 - tv) + (cc * (1 - tu) + d * tu) * tv;
  }
}
function faceDir(F, u, v, S) {
  const xc = (((u + 0.5) / S) * 2 - 1) * tanHalf, yc = (((v + 0.5) / S) * 2 - 1) * tanHalf;
  return [xc * F.r[0] + yc * F.d[0] + F.f[0], xc * F.r[1] + yc * F.d[1] + F.f[1], xc * F.r[2] + yc * F.d[2] + F.f[2]];
}
t = Date.now();
const rgb = [0, 0, 0];
for (const F of FACES) {
  const img = Buffer.alloc(faceSize * faceSize * 3);
  for (let v = 0; v < faceSize; v++) for (let u = 0; u < faceSize; u++) {
    const [x, y, z] = faceDir(F, u, v, faceSize);
    bilinearPano(Math.atan2(x, -z), Math.asin(y / Math.hypot(x, y, z)), rgb);
    const o = (v * faceSize + u) * 3;
    img[o] = rgb[0]; img[o + 1] = rgb[1]; img[o + 2] = rgb[2];
  }
  F.png = path.join(workDir, "face-" + F.name + ".png");
  await sharp(img, { raw: { width: faceSize, height: faceSize, channels: 3 } }).png().toFile(F.png);
}
lap("cut_faces", t);

// ---------- depth per face ----------
const N = faceSize * faceSize;
const falCalls = [];
let depthMeta = null;
if (depthMode === "box") {
  const half = [3, 1.5, 3], cy = 1.6 - 1.5;
  for (const F of FACES) {
    F.range = new Float32Array(N);
    for (let v = 0; v < faceSize; v++) for (let u = 0; u < faceSize; u++) {
      const [x, y, z] = faceDir(F, u, v, faceSize);
      const l = Math.hypot(x, y, z), dx = x / l, dy = y / l, dz = z / l;
      let best = Infinity;
      for (const [comp, lim, o] of [[dx, half[0], 0], [dy, half[1], cy], [dz, half[2], 0]]) {
        if (Math.abs(comp) < 1e-9) continue;
        const tt = ((comp > 0 ? lim : -lim) + (comp === dy ? -o : 0)) / comp;
        if (tt > 0 && tt < best) best = tt;
      }
      F.range[v * faceSize + u] = best;
    }
    F.scale = 1;
  }
} else if (depthMode === "moge3") {
  const { run, upload } = await import("../../kit/fal.mjs");
  t = Date.now();
  await Promise.all(FACES.map(async (F) => { F.url = await upload(F.png); }));
  lap("upload_faces", t);
  t = Date.now();
  const est = Math.max(1, Math.ceil((faceSize * faceSize) / 1e6)) * 0.015;
  await Promise.all(FACES.map(async (F) => {
    const { data, entry } = await run({
      approach: "splats", endpoint: "microsoft/moge-3", estCostUsd: est, label: id + "-moge3-" + F.name, outDir: path.join(workDir, "moge"),
      input: { image_url: F.url, fov_x: fov, resolution_level: 9, num_refinement_steps: 3, apply_mask: true, export_ply: true, export_glb: false },
    });
    falCalls.push({ face: F.name, request_id: entry.request_id, latency_s: entry.latency_s, queue_wait_s: entry.queue_wait_s, est_cost_usd: entry.est_cost_usd, fov_x: data.fov_x, fov_y: data.fov_y, intrinsics: data.intrinsics });
    F.moge = data;
    F.plyPath = path.join(splatsRoot, entry.files.find((f) => f.key === "point_cloud").local.replace(/^.*?work\//, "work/"));
  }));
  lap("moge3_parallel", t);
  t = Date.now();
  for (const F of FACES) {
    const plyFile = fs.existsSync(F.plyPath) ? F.plyPath : path.join(workDir, "moge", id + "-moge3-" + F.name + "__point_cloud.ply");
    const ply = readPly(fs.readFileSync(plyFile));
    const { x, y, z } = ply.data;
    let zs = 0;
    for (let i = 0; i < ply.count; i += 97) zs += z[i];
    const opencv = zs > 0;
    const K = F.moge.intrinsics;
    const fxn = K[0][0], fyn = K[1][1], cxn = K[0][2], cyn = K[1][2];
    F.range = new Float32Array(N).fill(NaN);
    let hit = 0;
    for (let i = 0; i < ply.count; i++) {
      const X = x[i], Y = opencv ? y[i] : -y[i], Z = opencv ? z[i] : -z[i];
      if (!(Z > 0)) continue;
      const u = Math.round((fxn * (X / Z) + cxn) * faceSize - 0.5), v = Math.round((fyn * (Y / Z) + cyn) * faceSize - 0.5);
      if (u < 0 || v < 0 || u >= faceSize || v >= faceSize) continue;
      const r = Math.hypot(X, Y, Z), k = v * faceSize + u;
      if (!(F.range[k] <= r)) F.range[k] = r;
      hit++;
    }
    F.plyInfo = { points: ply.count, mapped: hit, valid_frac: +(hit / N).toFixed(3), convention: opencv ? "opencv" : "opengl", props: ply.props };
  }
  lap("parse_point_clouds", t);
} else if (depthMode === "moge2-cpu") {
  const { execFileSync } = await import("node:child_process");
  t = Date.now();
  const depthDir = path.join(workDir, "depth");
  execFileSync(path.join(splatsRoot, ".venv", "bin", "python"), [path.join(here, "moge_faces.py"), "--faces", ...FACES.map((F) => F.png), "--fov", String(fov), "--out", depthDir, "--model", args.model || "Ruicheng/moge-2-vits-normal"], { stdio: ["ignore", "ignore", "inherit"] });
  lap("moge2_cpu", t);
  depthMeta = JSON.parse(fs.readFileSync(path.join(depthDir, "moge.json"), "utf8"));
  for (const F of FACES) {
    const buf = fs.readFileSync(path.join(depthDir, "face-" + F.name + ".f32"));
    F.range = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + N * 4));
    const m = depthMeta.faces.find((f) => f.face === "face-" + F.name);
    F.plyInfo = { valid_frac: m.valid_frac, median_range: m.median_range_m, wall_s: m.wall_s, cpu_s: m.cpu_s };
  }
} else throw new Error("unknown --depth " + depthMode);

// Fill small holes in each face range map (edge-removed pixels) from valid neighbours.
for (const F of FACES) {
  for (let it = 0; it < 3; it++) {
    const src = F.range.slice();
    for (let v = 1; v < faceSize - 1; v++) for (let u = 1; u < faceSize - 1; u++) {
      const k = v * faceSize + u;
      if (!Number.isNaN(src[k])) continue;
      let s = 0, c = 0;
      for (const o of [-1, 1, -faceSize, faceSize]) { const q = src[k + o]; if (!Number.isNaN(q)) { s += q; c++; } }
      if (c >= 2) F.range[k] = s / c;
    }
  }
}

function faceLookup(F, x, y, z) {
  const zc = x * F.f[0] + y * F.f[1] + z * F.f[2];
  if (zc <= 1e-6) return null;
  const px = (x * F.r[0] + y * F.r[1] + z * F.r[2]) / zc / tanHalf, py = (x * F.d[0] + y * F.d[1] + z * F.d[2]) / zc / tanHalf;
  if (px <= -1 || px >= 1 || py <= -1 || py >= 1) return null;
  const u = Math.min(faceSize - 1, Math.floor(((px + 1) / 2) * faceSize)), v = Math.min(faceSize - 1, Math.floor(((py + 1) / 2) * faceSize));
  const r = F.range[v * faceSize + u];
  if (Number.isNaN(r)) return null;
  const l = Math.hypot(x, y, z);
  return { r: r * (F.scale ?? 1), edge: 1 - Math.max(Math.abs(px), Math.abs(py)), unit: l };
}

// ---------- scale alignment across faces ----------
t = Date.now();
const pairs = [];
for (let a = 0; a < FACES.length; a++) for (let b = a + 1; b < FACES.length; b++) {
  const A = FACES[a], B = FACES[b], ratios = [];
  for (let v = 0; v < faceSize; v += 3) for (let u = 0; u < faceSize; u += 3) {
    const [x, y, z] = faceDir(A, u, v, faceSize);
    const ra = A.range[v * faceSize + u];
    if (Number.isNaN(ra)) continue;
    const hb = faceLookup({ ...B, scale: 1 }, x, y, z);
    if (!hb || hb.edge < 0.01) continue;
    const rel = hb.r / ra;
    if (rel > 0.5 && rel < 2) ratios.push(Math.log(rel));
  }
  if (ratios.length > 200) {
    ratios.sort((p, q) => p - q);
    pairs.push({ a, b, m: ratios[ratios.length >> 1], n: ratios.length });
  }
}
const logS = new Array(FACES.length).fill(0);
if (depthMode !== "box") {
  for (let iter = 0; iter < 200; iter++) {
    for (let i = 1; i < FACES.length; i++) {
      let s = 0, w = 0;
      for (const p of pairs) {
        if (p.a === i) { s += (logS[p.b] + p.m) * p.n; w += p.n; }
        else if (p.b === i) { s += (logS[p.a] - p.m) * p.n; w += p.n; }
      }
      if (w) logS[i] = s / w;
    }
  }
}
FACES.forEach((F, i) => (F.scale = Math.exp(logS[i])));
lap("align_faces", t);

// ---------- fused range + global metric scale ----------
function fusedRange(x, y, z) {
  let s = 0, w = 0;
  for (const F of FACES) {
    const h = faceLookup(F, x, y, z);
    if (!h) continue;
    const wt = Math.min(1, h.edge / 0.08) + 1e-4;
    s += Math.log(h.r) * wt;
    w += wt;
  }
  return w ? Math.exp(s / w) : NaN;
}
const drops = [];
for (let i = 0; i < 4000; i++) {
  const a = Math.random() * 2 * Math.PI, c = Math.cos((15 * Math.PI) / 180), zc = c + (1 - c) * Math.random(), s = Math.sqrt(1 - zc * zc);
  const dx = s * Math.cos(a), dy = -zc, dz = s * Math.sin(a);
  const r = fusedRange(dx, dy, dz);
  if (!Number.isNaN(r)) drops.push(r * zc);
}
drops.sort((p, q) => p - q);
const camHeight = drops.length ? drops[drops.length >> 1] : eyeH;
const g = eyeH / camHeight;
console.error("[" + id + "] estimated camera height " + camHeight.toFixed(3) + " (depth units) -> scale " + g.toFixed(3));

// ---------- splats per level ----------
const levelWidths = (args.levels ? String(args.levels).split(",").map(Number) : [PW, Math.round(PW / Math.SQRT2 / 2) * 2, Math.round(PW / 4) * 2]).filter((w) => w <= PW * 1.01);
const outputs = [];
for (const W of levelWidths) {
  t = Date.now();
  const H = W / 2;
  const { data: col } = await sharp(panoBuf).removeAlpha().toColorspace("srgb").resize(W, H, { kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
  const F = new Float32Array(W * H);
  const dir = [0, 0, 0];
  let skyCount = 0;
  for (let j = 0; j < H; j++) {
    const lat = (0.5 - (j + 0.5) / H) * Math.PI;
    for (let i = 0; i < W; i++) {
      dirFromLonLat(((i + 0.5) / W - 0.5) * 2 * Math.PI, lat, dir);
      F[j * W + i] = fusedRange(dir[0], dir[1], dir[2]) * g;
    }
  }
  for (let it = 0; it < 4; it++) {
    const src = F.slice();
    for (let j = 1; j < H - 1; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (!Number.isNaN(src[k])) continue;
      let s = 0, c = 0;
      for (const q of [src[j * W + ((i + 1) % W)], src[j * W + ((i - 1 + W) % W)], src[k - W], src[k + W]]) if (!Number.isNaN(q)) { s += q; c++; }
      if (c >= 2) F[k] = s / c;
    }
  }
  for (let k = 0; k < W * H; k++) {
    if (Number.isNaN(F[k])) { F[k] = skyRange; skyCount++; }
    else if (F[k] > skyRange * 0.95) F[k] = skyRange * 0.95;
  }
  const dPhi = (2 * Math.PI) / W, dTheta = Math.PI / H;
  const groups = [];
  for (let j = 0; j < H; j++) {
    const lat = (0.5 - (j + 0.5) / H) * Math.PI;
    const m = Math.max(1, Math.min(W >> 3, Math.round(1 / Math.max(Math.cos(lat), 1e-3))));
    for (let i0 = 0; i0 + m <= W; i0 += m) groups.push(j, i0, m);
  }
  const n = groups.length / 3;
  const positions = new Float32Array(n * 3), scales = new Float32Array(n * 3), quats = new Float32Array(n * 4), opacities = new Float32Array(n).fill(0.98), colors = new Float32Array(n * 3);
  const P = (i, j, out) => {
    const ii = ((i % W) + W) % W, jj = Math.min(H - 1, Math.max(0, j));
    const lon = ((ii + 0.5) / W - 0.5) * 2 * Math.PI, lat = (0.5 - (jj + 0.5) / H) * Math.PI;
    dirFromLonLat(lon, lat, out);
    const r = F[jj * W + ii];
    out[0] *= r; out[1] *= r; out[2] *= r;
    return r;
  };
  const p0 = [0, 0, 0], pa = [0, 0, 0], pb = [0, 0, 0];
  let fallbacks = 0;
  const pickTangent = (i, j, di, dj, expect, out) => {
    let best = null, bestL = Infinity;
    for (const sgn of [1, -1]) {
      if (j + dj * sgn < 0 || j + dj * sgn >= H) continue;
      P(i + di * sgn, j + dj * sgn, pa);
      const vx = (pa[0] - p0[0]) * sgn, vy = (pa[1] - p0[1]) * sgn, vz = (pa[2] - p0[2]) * sgn;
      const l = Math.hypot(vx, vy, vz);
      if (l < bestL && l < expect * 6) { bestL = l; best = [vx, vy, vz]; }
    }
    if (best && bestL > 1e-9) { out[0] = best[0]; out[1] = best[1]; out[2] = best[2]; return true; }
    return false;
  };
  const du = [0, 0, 0], dv = [0, 0, 0];
  for (let g3 = 0; g3 < n; g3++) {
    const j = groups[g3 * 3], i0 = groups[g3 * 3 + 1], m = groups[g3 * 3 + 2];
    const ic = i0 + (m >> 1);
    const r = P(ic, j, p0);
    const lon = ((ic + 0.5) / W - 0.5) * 2 * Math.PI, lat = (0.5 - (j + 0.5) / H) * Math.PI;
    const eu = r * m * dPhi * Math.max(Math.cos(lat), dTheta), ev = r * dTheta;
    const east = [Math.cos(lon), 0, Math.sin(lon)], north = [-Math.sin(lat) * Math.sin(lon), Math.cos(lat), Math.sin(lat) * Math.cos(lon)];
    const sky = r >= skyRange * 0.999;
    const okU = !sky && pickTangent(ic, j, m, 0, eu, du);
    const okV = !sky && pickTangent(ic, j, 0, 1, ev, dv);
    if (!okU) { du[0] = east[0] * eu; du[1] = 0; du[2] = east[2] * eu; }
    if (!okV) { dv[0] = north[0] * ev; dv[1] = north[1] * ev; dv[2] = north[2] * ev; }
    if (!okU || !okV) fallbacks++;
    let l1 = Math.hypot(du[0], du[1], du[2]);
    const a1 = [du[0] / l1, du[1] / l1, du[2] / l1];
    const dot = dv[0] * a1[0] + dv[1] * a1[1] + dv[2] * a1[2];
    let w2 = [dv[0] - dot * a1[0], dv[1] - dot * a1[1], dv[2] - dot * a1[2]];
    let l2 = Math.hypot(w2[0], w2[1], w2[2]);
    if (l2 < 1e-6 * (l1 + 1e-9)) { w2 = [north[0] * ev, north[1] * ev, north[2] * ev]; l2 = ev; }
    const a2 = [w2[0] / l2, w2[1] / l2, w2[2] / l2];
    const a3 = [a1[1] * a2[2] - a1[2] * a2[1], a1[2] * a2[0] - a1[0] * a2[2], a1[0] * a2[1] - a1[1] * a2[0]];
    const l3 = Math.hypot(a3[0], a3[1], a3[2]) || 1;
    const a2o = [a3[1] * a1[2] - a3[2] * a1[1], a3[2] * a1[0] - a3[0] * a1[2], a3[0] * a1[1] - a3[1] * a1[0]].map((q) => q / l3);
    quatFromBasis(a1[0], a1[1], a1[2], a2o[0], a2o[1], a2o[2], a3[0] / l3, a3[1] / l3, a3[2] / l3, quats, g3 * 4);
    const s1 = kScale * l1, s2 = kScale * l2;
    scales[g3 * 3] = s1; scales[g3 * 3 + 1] = s2; scales[g3 * 3 + 2] = Math.max(0.12 * Math.min(s1, s2), 1e-5);
    positions[g3 * 3] = p0[0]; positions[g3 * 3 + 1] = p0[1]; positions[g3 * 3 + 2] = p0[2];
    let cr = 0, cg = 0, cb = 0;
    for (let q = 0; q < m; q++) { const o = (j * W + i0 + q) * 3; cr += col[o]; cg += col[o + 1]; cb += col[o + 2]; }
    colors[g3 * 3] = cr / m / 255; colors[g3 * 3 + 1] = cg / m / 255; colors[g3 * 3 + 2] = cb / m / 255;
  }
  const spz = encodeSpz({ n, positions, scales, quats, opacities, colors });
  const file = path.join(workDir, id + "-" + W + ".spz");
  fs.writeFileSync(file, spz);
  lap("splats_" + W, t);
  outputs.push({ width: W, height: H, splats: n, bytes: spz.length, file, fallback_frac: +(fallbacks / n).toFixed(3), sky_frac: +(skyCount / (W * H)).toFixed(3) });
  if (W === levelWidths[0]) {
    let lo = Infinity, hi = 0;
    for (const v of F) if (v < skyRange * 0.95) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const img = Buffer.alloc(W * H);
    for (let k = 0; k < W * H; k++) img[k] = F[k] >= skyRange * 0.95 ? 0 : Math.round(255 * (1 - Math.log(F[k] / lo) / Math.log(hi / lo + 1e-6)));
    await sharp(img, { raw: { width: W, height: H, channels: 1 } }).png().toFile(path.join(workDir, id + "-range.png"));
    outputs[outputs.length - 1].range_m = [+lo.toFixed(2), +hi.toFixed(2)];
  }
}
timings.total_s = +((Date.now() - T0) / 1000).toFixed(2);
const summary = {
  id, day: args.day ?? null, pano: { source: args.pano, width: PW, height: PH }, depth: depthMode, fov, faceSize, kScale, skyRange,
  camHeight_depth_units: +camHeight.toFixed(3), metric_scale_applied: +g.toFixed(4),
  face_scales: FACES.map((F) => ({ face: F.name, scale: +F.scale.toFixed(4), ...(F.plyInfo ?? {}) })), pairs: pairs.map((p) => ({ a: FACES[p.a].name, b: FACES[p.b].name, log_ratio: +p.m.toFixed(4), n: p.n })),
  fal_calls: falCalls, depth_meta: depthMeta && { model: depthMeta.model, load_s: depthMeta.load_s, total_wall_s: depthMeta.total_wall_s, cpu_s: +depthMeta.faces.reduce((s, f) => s + f.cpu_s, 0).toFixed(1), threads: depthMeta.threads }, timings, outputs,
};
fs.writeFileSync(path.join(workDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
