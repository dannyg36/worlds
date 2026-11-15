#!/usr/bin/env node
// pano3d pipeline: equirect panorama -> 14 perspective views -> MoGe-3 metric depth per view on fal
// -> scale-aligned fusion into one equirect distance map -> foreground mesh + inpainted background layer + walk grid
// -> manifest entries the viewer loads. Every fal call goes through ../kit/fal.mjs (budget cap + ledger).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { spent } from "../kit/ledger.mjs";
import { upload } from "../kit/gmi.mjs";
const falRun = async (opts) => (await import("../kit/fal.mjs")).run(opts);

const here = path.dirname(fileURLToPath(import.meta.url));
const APPROACH = "pano3d";
const D2R = Math.PI / 180;
const outDir = (day) => path.join(here, "out", day);
const manifestPath = path.join(here, "manifest.json");
const scenes = JSON.parse(fs.readFileSync(path.join(here, "..", "scenes.json"), "utf8"));
const MAX_MOGE_CALLS = 16;

const LAYOUT = [
  ...[0, 45, 90, 135, 180, 225, 270, 315].map((yaw) => ({ yaw, pitch: 0 })),
  ...[22.5, 112.5, 202.5, 292.5].map((yaw) => ({ yaw, pitch: -55 })),
  { yaw: 0, pitch: 90 },
  { yaw: 0, pitch: -90 },
];

const readJson = (f, fallback) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : fallback);
const stringify = (v, ind = "") => {
  if (Array.isArray(v) && v.every((x) => x === null || typeof x !== "object")) return JSON.stringify(v);
  if (!v || typeof v !== "object") return JSON.stringify(v) ?? "null";
  const inner = ind + "  ";
  const items = Array.isArray(v) ? v.map((x) => inner + stringify(x, inner)) : Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => inner + JSON.stringify(k) + ": " + stringify(x, inner));
  return items.length ? (Array.isArray(v) ? "[" : "{") + "\n" + items.join(",\n") + "\n" + ind + (Array.isArray(v) ? "]" : "}") : Array.isArray(v) ? "[]" : "{}";
};
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, stringify(v) + "\n"); };
const ms = (t) => Math.round(performance.now() - t);

async function loadRGB(file, maxW) {
  const meta = await sharp(file).metadata();
  let img = sharp(file).removeAlpha();
  if (maxW && meta.width > maxW) img = img.resize(maxW, Math.round((maxW * meta.height) / meta.width));
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height, C: info.channels };
}

function sampleEq(img, lon, lat, out) {
  const { data, W, H, C } = img;
  const u = (lon / (2 * Math.PI) + 0.5) * W - 0.5, v = (0.5 - lat / Math.PI) * H - 0.5;
  const x0 = Math.floor(u), yf = Math.floor(v), fx = u - x0, fy = v - yf;
  const y0 = Math.min(H - 1, Math.max(0, yf)), y1 = Math.min(H - 1, Math.max(0, yf + 1));
  const xa = ((x0 % W) + W) % W, xb = (xa + 1) % W;
  for (let c = 0; c < 3; c++) {
    const a = data[(y0 * W + xa) * C + c], b = data[(y0 * W + xb) * C + c], d = data[(y1 * W + xa) * C + c], e = data[(y1 * W + xb) * C + c];
    out[c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
  }
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function basis(yawDeg, pitchDeg) {
  const lon = yawDeg * D2R, lat = pitchDeg * D2R;
  const f = [Math.sin(lon) * Math.cos(lat), Math.sin(lat), -Math.cos(lon) * Math.cos(lat)];
  const r = [Math.cos(lon), 0, Math.sin(lon)];
  return { f, r, u: cross(r, f) };
}
const dirOf = (i, j, W, H) => {
  const lon = ((i + 0.5) / W - 0.5) * 2 * Math.PI, lat = (0.5 - (j + 0.5) / H) * Math.PI;
  return [Math.sin(lon) * Math.cos(lat), Math.sin(lat), -Math.cos(lon) * Math.cos(lat)];
};

// ---------------------------------------------------------------- prep + views
async function cmdPrep(day, args) {
  const dir = outDir(day);
  fs.mkdirSync(dir, { recursive: true });
  const src = args.pano;
  if (!src) throw new Error("--pano <url|file> required");
  let buf;
  if (/^https?:/.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error("download " + res.status);
    buf = Buffer.from(await res.arrayBuffer());
  } else buf = fs.readFileSync(src);
  const meta = await sharp(buf).metadata();
  const maxW = Number(args.maxw || 4096);
  let img = sharp(buf).removeAlpha();
  if (meta.width > maxW) img = img.resize(maxW, maxW / 2);
  else if (Math.abs(meta.width - 2 * meta.height) > 2) img = img.resize(meta.width, Math.round(meta.width / 2), { fit: "fill" });
  const info = await img.jpeg({ quality: 88, mozjpeg: true }).toFile(path.join(dir, "pano.jpg"));
  writeJson(path.join(dir, "source.json"), { pano_source: src, source_px: meta.width + "x" + meta.height, source_format: meta.format, source_bytes: buf.length, pano_jpg: { px: info.width + "x" + info.height, bytes: info.size } });
  console.log("pano.jpg " + info.width + "x" + info.height + " " + (info.size / 1e6).toFixed(2) + " MB (source " + meta.width + "x" + meta.height + " " + meta.format + ")");
}

async function cmdViews(day, args) {
  const dir = outDir(day);
  const t = performance.now();
  const pano = await loadRGB(path.join(dir, "pano.jpg"));
  const S = Number(args.size || 992), fov = Number(args.fov || 100);
  const F = S / 2 / Math.tan((fov * D2R) / 2);
  fs.mkdirSync(path.join(dir, "views"), { recursive: true });
  const views = [];
  const px = new Float32Array(3);
  for (const [i, v] of LAYOUT.entries()) {
    const buf = Buffer.alloc(S * S * 3);
    const { f, r, u } = basis(v.yaw, v.pitch);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const xc = (x + 0.5 - S / 2) / F, yc = (y + 0.5 - S / 2) / F;
      const dx = xc * r[0] - yc * u[0] + f[0], dy = xc * r[1] - yc * u[1] + f[1], dz = xc * r[2] - yc * u[2] + f[2];
      const n = Math.hypot(dx, dy, dz);
      sampleEq(pano, Math.atan2(dx / n, -dz / n), Math.asin(dy / n), px);
      const o = (y * S + x) * 3;
      buf[o] = px[0]; buf[o + 1] = px[1]; buf[o + 2] = px[2];
    }
    const file = path.join("views", "view_" + String(i).padStart(2, "0") + ".jpg");
    await sharp(buf, { raw: { width: S, height: S, channels: 3 } }).jpeg({ quality: 94 }).toFile(path.join(dir, file));
    views.push({ i, yaw: v.yaw, pitch: v.pitch, fov, S, file });
  }
  const tSplit = ms(t);
  const t2 = performance.now();
  if (!args["no-upload"]) await Promise.all(views.map(async (v) => { v.url = await upload(path.join(dir, v.file)); }));
  writeJson(path.join(dir, "views.json"), { S, fov, split_ms: tSplit, upload_ms: ms(t2), views });
  console.log(views.length + " views " + S + "px fov " + fov + " split " + tSplit + " ms, upload " + ms(t2) + " ms");
}

// ---------------------------------------------------------------- MoGe-3 per view
async function cmdMoge(day, args) {
  const dir = outDir(day);
  const vj = readJson(path.join(dir, "views.json"));
  const todo = vj.views.filter((v) => !v.moge || args.force);
  if (todo.length > MAX_MOGE_CALLS) throw new Error("refusing " + todo.length + " MoGe calls (max " + MAX_MOGE_CALLS + ")");
  const est = 0.015 * Math.max(1, Math.ceil((vj.S * vj.S) / 1e6));
  console.log(todo.length + " MoGe-3 calls at ~$" + est + " each; spent so far ~$" + spent(APPROACH).toFixed(3));
  const t0 = Date.now();
  const queue = [...todo];
  const conc = Math.min(Number(args.concurrency || 14), todo.length);
  const errors = [];
  await Promise.all(Array.from({ length: conc }, async () => {
    while (queue.length) {
      const v = queue.shift();
      try {
        const { data, entry } = await falRun({
          approach: APPROACH, endpoint: "microsoft/moge-3", estCostUsd: est, label: day + "-view" + String(v.i).padStart(2, "0"),
          outDir: path.join(dir, "moge"),
          input: { image_url: v.url, fov_x: v.fov, resolution_level: 9, num_refinement_steps: 3, apply_mask: true, export_glb: false, export_ply: true },
        });
        v.moge = {
          request_id: entry.request_id, latency_s: entry.latency_s, queue_wait_s: entry.queue_wait_s, fov_x: data.fov_x, fov_y: data.fov_y, intrinsics: data.intrinsics,
          files: entry.files.map((f) => ({ key: f.key, path: f.local ? path.resolve(process.cwd(), f.local) : null, bytes: f.bytes ?? null, url: f.url })),
        };
        console.log("view " + v.i + " ok " + entry.latency_s + " s (queue " + entry.queue_wait_s + " s)");
      } catch (e) {
        errors.push("view " + v.i + ": " + (e.message || e));
        console.error("view " + v.i + " FAILED: " + (e.message || e));
      }
    }
  }));
  vj.moge_wall_s = (Date.now() - t0) / 1000;
  writeJson(path.join(dir, "views.json"), vj);
  console.log("MoGe wall " + vj.moge_wall_s + " s; spent ~$" + spent(APPROACH).toFixed(3));
  if (errors.length) throw new Error(errors.join("; "));
}

function parsePly(buf) {
  const marker = buf.indexOf("end_header");
  const header = buf.subarray(0, marker).toString("latin1").split(/\r?\n/);
  let off = marker + "end_header".length;
  while (buf[off] === 13 || buf[off] === 10) { off++; if (buf[off - 1] === 10) break; }
  let format = "ascii";
  const elements = [];
  for (const line of header) {
    const p = line.trim().split(/\s+/);
    if (p[0] === "format") format = p[1];
    else if (p[0] === "element") elements.push({ name: p[1], count: Number(p[2]), props: [] });
    else if (p[0] === "property") elements.at(-1).props.push(p[1] === "list" ? { list: true, ct: p[2], t: p[3], name: p[4] } : { t: p[1], name: p[2] });
  }
  const vert = elements[0];
  if (!vert || vert.name !== "vertex") throw new Error("PLY: first element is not vertex");
  const n = vert.count;
  const out = { count: n, x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n) };
  const size = { char: 1, int8: 1, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 2, uint16: 2, int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
  if (format === "ascii") {
    const lines = buf.subarray(off).toString("latin1").split(/\r?\n/);
    const ix = vert.props.findIndex((p) => p.name === "x"), iy = vert.props.findIndex((p) => p.name === "y"), iz = vert.props.findIndex((p) => p.name === "z");
    for (let i = 0; i < n; i++) { const p = lines[i].trim().split(/\s+/).map(Number); out.x[i] = p[ix]; out.y[i] = p[iy]; out.z[i] = p[iz]; }
    return out;
  }
  if (vert.props.some((p) => p.list)) throw new Error("PLY: list property in vertex element");
  const le = format === "binary_little_endian";
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const offs = {};
  let stride = 0;
  for (const p of vert.props) { offs[p.name] = { o: stride, t: p.t }; stride += size[p.t]; }
  const rd = (o, t) => (t === "float" || t === "float32" ? dv.getFloat32(o, le) : t === "double" || t === "float64" ? dv.getFloat64(o, le) : NaN);
  for (let i = 0; i < n; i++) {
    const b = off + i * stride;
    out.x[i] = rd(b + offs.x.o, offs.x.t); out.y[i] = rd(b + offs.y.o, offs.y.t); out.z[i] = rd(b + offs.z.o, offs.z.t);
  }
  return out;
}

// ---------------------------------------------------------------- fusion
function percentile(arr, p) {
  if (!arr.length) return NaN;
  const s = Float64Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
}

async function viewDepth(v) {
  if (v.moge.local) {
    const S = v.S, raw = fs.readFileSync(v.moge.depth);
    const depth = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    const mask = await sharp(v.moge.mask).greyscale().raw().toBuffer();
    return { depth, mask, S, glConv: false, points: S * S, hits: depth.reduce((c, d) => c + (d > 0 ? 1 : 0), 0), b: basis(v.yaw, v.pitch), F: S / 2 / Math.tan((v.fov * D2R) / 2) };
  }
  const ply = v.moge.files.find((f) => f.key === "point_cloud");
  const maskF = v.moge.files.find((f) => f.key === "mask");
  const pts = parsePly(fs.readFileSync(ply.path));
  const S = v.S, depth = new Float32Array(S * S);
  const K = v.moge.intrinsics, fxn = K[0][0], cxn = K[0][2], fyn = K[1][1], cyn = K[1][2];
  let neg = 0, cnt = 0;
  for (let i = 0; i < pts.count; i += 101) { cnt++; if (pts.z[i] < 0) neg++; }
  const glConv = neg > cnt / 2;
  let hits = 0;
  for (let i = 0; i < pts.count; i++) {
    const x = pts.x[i], y = glConv ? -pts.y[i] : pts.y[i], z = glConv ? -pts.z[i] : pts.z[i];
    if (!(z > 1e-6)) continue;
    const col = Math.floor((fxn * x / z + cxn) * S), row = Math.floor((fyn * y / z + cyn) * S);
    if (col < 0 || row < 0 || col >= S || row >= S) continue;
    const d = Math.hypot(x, y, z), k = row * S + col;
    if (!depth[k] || d < depth[k]) depth[k] = d;
    hits++;
  }
  const mask = maskF ? await sharp(maskF.path).greyscale().resize(S, S, { kernel: "nearest", fit: "fill" }).raw().toBuffer() : null;
  for (let pass = 0; pass < 3; pass++) {
    const src = depth.slice();
    for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
      const k = y * S + x;
      if (src[k] || (mask && mask[k] < 128)) continue;
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const q = src[k + dy * S + dx]; if (q) { s += Math.log(q); c++; } }
      if (c >= 2) depth[k] = Math.exp(s / c);
    }
  }
  return { depth, mask, S, glConv, points: pts.count, hits, b: basis(v.yaw, v.pitch), F: S / 2 / Math.tan((v.fov * D2R) / 2) };
}

async function cmdFuse(day, args) {
  const dir = outDir(day);
  const vj = readJson(path.join(dir, "views.json"));
  const key = args.src || "moge";
  vj.views = vj.views.map((v) => ({ ...v, moge: v[key] }));
  const W = Number(args.w || 1024), H = W / 2, N = W * H;
  const t0 = performance.now();
  const vds = [];
  for (const v of vj.views) vds.push(await viewDepth(v));
  const tLoad = ms(t0);
  const K = vds.length, CAP = 8;
  const sv = new Uint8Array(N * CAP), sl = new Float32Array(N * CAP), sw = new Float32Array(N * CAP), sf = new Uint8Array(N * CAP), sc = new Uint8Array(N);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const d = dirOf(i, j, W, H), p = j * W + i;
    for (let k = 0; k < K; k++) {
      const { b, F, S, depth, mask } = vds[k];
      const zf = d[0] * b.f[0] + d[1] * b.f[1] + d[2] * b.f[2];
      if (zf <= 0.05) continue;
      const xc = (d[0] * b.r[0] + d[1] * b.r[1] + d[2] * b.r[2]) / zf, yc = -(d[0] * b.u[0] + d[1] * b.u[1] + d[2] * b.u[2]) / zf;
      const fx = xc * F + S / 2, fy = yc * F + S / 2;
      if (fx < 0 || fy < 0 || fx >= S || fy >= S) continue;
      const kk = Math.floor(fy) * S + Math.floor(fx);
      const edge = Math.min(fx, fy, S - fx, S - fy) / S;
      const w = Math.pow(zf, 4) * Math.min(1, edge / 0.06) + 1e-4;
      const dd = depth[kk], far = !dd && mask && mask[kk] < 128;
      if (!dd && !far) continue;
      const c = sc[p];
      if (c >= CAP) continue;
      sv[p * CAP + c] = k; sl[p * CAP + c] = dd ? Math.log(dd) : 0; sw[p * CAP + c] = w; sf[p * CAP + c] = far ? 1 : 0;
      sc[p] = c + 1;
    }
  }
  // pairwise log-scale offsets in overlaps
  const pairs = new Map();
  for (let p = 0; p < N; p += 2) {
    const c = sc[p];
    if (c < 2) continue;
    for (let a = 0; a < c; a++) for (let b2 = a + 1; b2 < c; b2++) {
      const A = p * CAP + a, B = p * CAP + b2;
      if (sf[A] || sf[B] || sw[A] < 0.02 || sw[B] < 0.02) continue;
      const ka = sv[A], kb = sv[B], key = ka < kb ? ka * 64 + kb : kb * 64 + ka;
      const diff = ka < kb ? sl[A] - sl[B] : sl[B] - sl[A];
      if (!pairs.has(key)) pairs.set(key, []);
      pairs.get(key).push(diff);
    }
  }
  const edges = [];
  for (const [key, arr] of pairs) if (arr.length >= 200) edges.push({ a: Math.floor(key / 64), b: key % 64, m: percentile(arr, 0.5), n: arr.length, spread: percentile(arr, 0.75) - percentile(arr, 0.25) });
  const off = new Float64Array(K);
  for (let it = 0; it < 300; it++) {
    for (let k = 1; k < K; k++) {
      let s = 0, c = 0;
      for (const e of edges) {
        if (e.a === k) { s += off[e.b] - e.m; c++; }
        else if (e.b === k) { s += off[e.a] + e.m; c++; }
      }
      if (c) off[k] = s / c;
    }
  }
  const meanOff = off.reduce((a, b) => a + b, 0) / K;
  for (let k = 0; k < K; k++) off[k] -= meanOff;
  let resid = 0;
  for (const e of edges) resid += Math.abs(off[e.a] - off[e.b] + e.m);
  // fused log distance
  const lnD = new Float32Array(N), farMask = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    const c = sc[p];
    if (!c) continue;
    let wf = 0, wv = 0, best = -1, bw = -1;
    for (let a = 0; a < c; a++) {
      const A = p * CAP + a;
      if (sf[A]) wf += sw[A];
      else { wv += sw[A]; if (sw[A] > bw) { bw = sw[A]; best = A; } }
    }
    if (wf > wv || best < 0) { farMask[p] = 1; continue; }
    const ref = sl[best] + off[sv[best]];
    let s = 0, ws = 0;
    for (let a = 0; a < c; a++) {
      const A = p * CAP + a;
      if (sf[A]) continue;
      const l = sl[A] + off[sv[A]];
      if (Math.abs(l - ref) > 0.08) continue;
      s += l * sw[A]; ws += sw[A];
    }
    lnD[p] = s / ws;
  }
  const valid = [];
  for (let p = 0; p < N; p += 3) if (!farMask[p] && lnD[p]) valid.push(lnD[p]);
  // eye height from the floor around the nadir
  const ys = [];
  for (let j = 0; j < H; j++) {
    const lat = (0.5 - (j + 0.5) / H) * Math.PI;
    if (lat > -65 * D2R) continue;
    for (let i = 0; i < W; i += 2) { const p = j * W + i; if (lnD[p] && !farMask[p]) ys.push(-Math.exp(lnD[p]) * Math.sin(lat)); }
  }
  const camH = percentile(ys, 0.5);
  const eye = Number(args.eye || 1.6);
  const scale = eye / camH;
  const lnScale = Math.log(scale);
  const farD = Math.min(Number(args.far || 80), Math.max(25, 2.5 * Math.exp(percentile(valid, 0.99)) * scale));
  const dist = new Float32Array(N);
  let nFar = 0, nHole = 0;
  for (let p = 0; p < N; p++) {
    if (farMask[p]) { dist[p] = farD; nFar++; }
    else if (lnD[p]) dist[p] = Math.min(farD, Math.exp(lnD[p] + lnScale));
    else nHole++;
  }
  fillHoles(dist, W, H);
  const fuse = {
    views: K, view_px: vj.S, view_fov: vj.fov, ply_points: vds.map((v) => v.points), ply_hits: vds.map((v) => v.hits), gl_convention: vds[0].glConv,
    pair_edges: edges.length, align_offsets_pct: Array.from(off, (o) => +((Math.exp(o) - 1) * 100).toFixed(1)), align_mean_abs_residual_pct: +((Math.exp(resid / Math.max(1, edges.length)) - 1) * 100).toFixed(2),
    moge_camera_height_m: +camH.toFixed(3), eye_m: eye, scale_to_eye: +scale.toFixed(3), far_m: +farD.toFixed(1), far_px_pct: +((100 * nFar) / N).toFixed(1), hole_px_pct: +((100 * nHole) / N).toFixed(2),
    load_ms: tLoad, fuse_ms: ms(t0) - tLoad, moge_wall_s: vj.moge_wall_s, split_ms: vj.split_ms, upload_ms: vj.upload_ms,
  };
  console.log(JSON.stringify(fuse));
  fuse.depth_source = key === "da2" ? vj.da2_local : vj.moge_local ? vj.moge_local : "fal microsoft/moge-3";
  const method = key === "da2" ? "da2-fused" : vj.moge_local ? "moge2-fused" : "moge3-fused";
  await finish(day, dist, W, H, { method, fuse, eye, edgeDeg: Number(args.edge || 86), prefix: key === "da2" ? "da2f_" : "" });
}

function fillHoles(dist, W, H) {
  for (let pass = 0; pass < 64; pass++) {
    let left = 0;
    const src = dist.slice();
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const p = j * W + i;
      if (src[p]) continue;
      let s = 0, c = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const jj = j + dj;
        if (jj < 0 || jj >= H) continue;
        const q = src[jj * W + ((i + di + W) % W)];
        if (q) { s += Math.log(q); c++; }
      }
      if (c) dist[p] = Math.exp(s / c); else left++;
    }
    if (!left) break;
  }
}

// ---------------------------------------------------------------- shared post-processing
function filter1D(src, W, H, r, horizontal, op) {
  const out = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let m = op === "max" ? -Infinity : 0, c = 0;
    for (let k = -r; k <= r; k++) {
      let v;
      if (horizontal) v = src[j * W + ((i + k + W * 4) % W)];
      else { const jj = Math.min(H - 1, Math.max(0, j + k)); v = src[jj * W + i]; }
      if (op === "max") { if (v > m) m = v; } else { m += v; c++; }
    }
    out[j * W + i] = op === "max" ? m : m / c;
  }
  return out;
}

function pushPull(rgb, wgt, W, H) {
  const levels = [{ rgb, w: wgt, W, H }];
  while (levels.at(-1).W > 8 && levels.at(-1).H > 4) {
    const p = levels.at(-1), W2 = Math.ceil(p.W / 2), H2 = Math.ceil(p.H / 2);
    const rgb2 = new Float32Array(W2 * H2 * 3), w2 = new Float32Array(W2 * H2);
    for (let j = 0; j < H2; j++) for (let i = 0; i < W2; i++) {
      let sw = 0, r = 0, g = 0, b = 0;
      for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) {
        const jj = Math.min(p.H - 1, 2 * j + dj), ii = Math.min(p.W - 1, 2 * i + di), q = jj * p.W + ii, w = p.w[q];
        sw += w; r += w * p.rgb[q * 3]; g += w * p.rgb[q * 3 + 1]; b += w * p.rgb[q * 3 + 2];
      }
      const o = j * W2 + i;
      if (sw > 0) { rgb2[o * 3] = r / sw; rgb2[o * 3 + 1] = g / sw; rgb2[o * 3 + 2] = b / sw; }
      w2[o] = Math.min(1, sw);
    }
    levels.push({ rgb: rgb2, w: w2, W: W2, H: H2 });
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const f = levels[l], c = levels[l + 1];
    for (let j = 0; j < f.H; j++) for (let i = 0; i < f.W; i++) {
      const q = j * f.W + i, w = f.w[q];
      if (w >= 1) continue;
      const u = Math.min(c.W - 1, Math.max(0, (i + 0.5) / 2 - 0.5)), v = Math.min(c.H - 1, Math.max(0, (j + 0.5) / 2 - 0.5));
      const x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(c.W - 1, x0 + 1), y1 = Math.min(c.H - 1, y0 + 1), fx = u - x0, fy = v - y0;
      for (let ch = 0; ch < 3; ch++) {
        const s = (c.rgb[(y0 * c.W + x0) * 3 + ch] * (1 - fx) + c.rgb[(y0 * c.W + x1) * 3 + ch] * fx) * (1 - fy) + (c.rgb[(y1 * c.W + x0) * 3 + ch] * (1 - fx) + c.rgb[(y1 * c.W + x1) * 3 + ch] * fx) * fy;
        f.rgb[q * 3 + ch] = w * f.rgb[q * 3 + ch] + (1 - w) * s;
      }
      f.w[q] = 1;
    }
  }
  return levels[0].rgb;
}

function encodeU16(dist) {
  let lo = Infinity, hi = -Infinity;
  for (const d of dist) if (d > 0) { const l = Math.log(d); if (l < lo) lo = l; if (l > hi) hi = l; }
  const u = new Uint16Array(dist.length);
  for (let i = 0; i < dist.length; i++) u[i] = dist[i] > 0 ? Math.max(1, Math.round(((Math.log(dist[i]) - lo) / (hi - lo)) * 65535)) : 0;
  return { buf: Buffer.from(u.buffer), lnMin: +lo.toFixed(6), lnMax: +hi.toFixed(6) };
}

function walkGrid(dist, W, H, eye, n = 41, extent = 4) {
  const cell = (2 * extent) / (n - 1);
  const floorVals = Array.from({ length: n * n }, () => []);
  const obst = new Uint32Array(n * n), drop = new Uint32Array(n * n);
  for (let j = 0; j < H; j++) {
    const lat = (0.5 - (j + 0.5) / H) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < W; i++) {
      const d = dist[j * W + i];
      if (!d) continue;
      const rho = d * cl;
      if (rho > extent + cell) continue;
      const lon = ((i + 0.5) / W - 0.5) * 2 * Math.PI;
      const ix = Math.round((Math.sin(lon) * rho + extent) / cell), iz = Math.round((-Math.cos(lon) * rho + extent) / cell);
      if (ix < 0 || iz < 0 || ix >= n || iz >= n) continue;
      const k = iz * n + ix, rel = sl * d + eye;
      if (rel < -0.6) drop[k]++;
      else if (rel < 0.15) floorVals[k].push(sl * d);
      else if (rel < eye + 0.3) obst[k]++;
    }
  }
  const floor = new Float32Array(n * n).fill(NaN), blocked = new Uint8Array(n * n);
  for (let k = 0; k < n * n; k++) {
    if (floorVals[k].length >= 3) floor[k] = percentile(floorVals[k], 0.5);
    if (obst[k] >= 3 || (drop[k] >= 3 && floorVals[k].length < 3)) blocked[k] = 1;
  }
  for (let it = 0; it < 2 * n; it++) {
    let left = 0;
    const src = floor.slice();
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
      const k = iz * n + ix;
      if (!Number.isNaN(src[k])) continue;
      let s = 0, c = 0;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = ix + a, z = iz + b;
        if (x < 0 || z < 0 || x >= n || z >= n) continue;
        const v = src[z * n + x];
        if (!Number.isNaN(v)) { s += v; c++; }
      }
      if (c) floor[k] = s / c; else left++;
    }
    if (!left) break;
  }
  for (let k = 0; k < n * n; k++) if (Number.isNaN(floor[k])) floor[k] = -eye;
  const dil = blocked.slice();
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
    if (!blocked[iz * n + ix]) continue;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const x = ix + a, z = iz + b;
      if (x >= 0 && z >= 0 && x < n && z < n) dil[z * n + x] = 1;
    }
  }
  const c0 = (n - 1) / 2;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) dil[(c0 + b) * n + c0 + a] = 0;
  const f0 = floor[c0 * n + c0];
  for (let k = 0; k < n * n; k++) floor[k] = floor[k] - f0 - eye;
  let free = 0;
  for (let k = 0; k < n * n; k++) if (!dil[k]) free++;
  return { n, extent, cell: +cell.toFixed(4), floor: Array.from(floor, (v) => +v.toFixed(3)), blocked: Array.from(dil), free_cells: free };
}

async function writePacked(u16buf, w, h, file) {
  const u = new Uint16Array(u16buf.buffer, u16buf.byteOffset, w * h), rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { rgb[i * 3] = u[i] >> 8; rgb[i * 3 + 1] = u[i] & 255; }
  await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(file);
}

function turbo(t) {
  t = Math.min(1, Math.max(0, t));
  const r = 34.61 + t * (1172.33 - t * (10793.56 - t * (33300.12 - t * (38394.49 - t * 14825.05))));
  const g = 23.31 + t * (557.33 + t * (1225.33 - t * (3574.96 - t * (1073.77 + t * 707.56))));
  const b = 27.2 + t * (3211.1 - t * (15327.97 - t * (27814 - t * (22569.18 - t * 6838.66))));
  return [r, g, b].map((v) => Math.max(0, Math.min(255, v)));
}
async function depthPreview(dist, W, H, file) {
  const buf = Buffer.alloc(W * H * 3);
  let lo = Infinity, hi = -Infinity;
  for (const d of dist) if (d > 0) { lo = Math.min(lo, Math.log(d)); hi = Math.max(hi, Math.log(d)); }
  for (let p = 0; p < W * H; p++) { const c = turbo(1 - (Math.log(dist[p] || Math.exp(hi)) - lo) / (hi - lo)); buf[p * 3] = c[0]; buf[p * 3 + 1] = c[1]; buf[p * 3 + 2] = c[2]; }
  await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png().toFile(file);
}

async function finish(day, dist, W, H, { method, fuse = {}, eye = 1.6, edgeDeg = 86, prefix = "" }) {
  const dir = outDir(day);
  const t = performance.now();
  const enc = encodeU16(dist);
  fs.writeFileSync(path.join(dir, prefix + "depth.u16"), enc.buf);
  await writePacked(enc.buf, W, H, path.join(dir, prefix + "depth.png"));
  await depthPreview(dist, W, H, path.join(dir, prefix + "depth_preview.png"));
  const info = readJson(path.join(dir, "info.json"), {});
  const entry = { method, prefix, depthInfo: { w: W, h: H, lnMin: enc.lnMin, lnMax: enc.lnMax }, edgeDeg, fuse };
  {
    const lnD = new Float32Array(W * H);
    for (let p = 0; p < W * H; p++) lnD[p] = Math.log(dist[p]);
    const r = Math.round((40 * W) / 1024);
    let bgLn = filter1D(filter1D(lnD, W, H, r, true, "max"), W, H, r, false, "max");
    const rb = Math.max(2, Math.round(r / 3));
    bgLn = filter1D(filter1D(bgLn, W, H, rb, true, "mean"), W, H, rb, false, "mean");
    for (let p = 0; p < W * H; p++) bgLn[p] = Math.max(bgLn[p], lnD[p]);
    const pano = await sharp(path.join(dir, "pano.jpg")).removeAlpha().resize(W, H, { fit: "fill" }).raw().toBuffer();
    const mask = new Uint8Array(W * H);
    let masked = 0;
    for (let p = 0; p < W * H; p++) if (bgLn[p] - lnD[p] > Math.log(1.12)) mask[p] = 1;
    const wgt = new Float32Array(W * H).fill(1), rgb = new Float32Array(W * H * 3);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const p = j * W + i;
      rgb[p * 3] = pano[p * 3]; rgb[p * 3 + 1] = pano[p * 3 + 1]; rgb[p * 3 + 2] = pano[p * 3 + 2];
      let m = 0;
      for (let dj = -2; dj <= 2 && !m; dj++) for (let di = -2; di <= 2; di++) {
        const jj = Math.min(H - 1, Math.max(0, j + dj));
        if (mask[jj * W + ((i + di + W) % W)]) { m = 1; break; }
      }
      if (m) { wgt[p] = 0; masked++; }
    }
    const filled = pushPull(rgb, wgt, W, H);
    const out = Buffer.alloc(W * H * 3);
    for (let q = 0; q < W * H * 3; q++) out[q] = Math.max(0, Math.min(255, Math.round(filled[q])));
    await sharp(out, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 85 }).toFile(path.join(dir, prefix + "bg.jpg"));
    const bw = W / 2, bh = H / 2, bgDist = new Float32Array(bw * bh);
    for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
      let s = 0;
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) s += bgLn[(2 * j + a) * W + 2 * i + b];
      bgDist[j * bw + i] = Math.exp(s / 4);
    }
    const benc = encodeU16(bgDist);
    fs.writeFileSync(path.join(dir, prefix + "bg.u16"), benc.buf);
    await writePacked(benc.buf, bw, bh, path.join(dir, prefix + "bgdepth.png"));
    entry.bg = { tex: prefix + "bg.jpg", depth: prefix + "bgdepth.png", depthInfo: { w: bw, h: bh, lnMin: benc.lnMin, lnMax: benc.lnMax }, push: 1.03, masked_px_pct: +((100 * masked) / (W * H)).toFixed(1), maxfilter_px: r };
    entry.walk = { radius: 2.5, eye, grid: walkGrid(dist, W, H, eye) };
    if (!prefix) info.walk = entry.walk;
    entry.post_ms = ms(t);
  }
  info[method] = entry;
  writeJson(path.join(dir, "info.json"), info);
  console.log(method + ": depth " + W + "x" + H + " ln[" + enc.lnMin.toFixed(2) + "," + enc.lnMax.toFixed(2) + "] post " + ms(t) + " ms walk free cells " + entry.walk.grid.free_cells);
}

// ---------------------------------------------------------------- synthetic dev depth (no fal)
async function cmdSynthetic(day, args) {
  const W = Number(args.w || 1024), H = W / 2, dist = new Float32Array(W * H);
  const box = { x0: -2.6, x1: 3.0, y0: -1.5, y1: 1.2, z0: -3.2, z1: 2.4 };
  const pillar = { x: 1.0, z: -1.4, r: 0.3 };
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const [dx, dy, dz] = dirOf(i, j, W, H);
    let t = Infinity;
    for (const [d, lo, hi] of [[dx, box.x0, box.x1], [dy, box.y0, box.y1], [dz, box.z0, box.z1]]) if (d) t = Math.min(t, (d > 0 ? hi : lo) / d);
    const a = dx * dx + dz * dz, b = -2 * (dx * pillar.x + dz * pillar.z), c = pillar.x ** 2 + pillar.z ** 2 - pillar.r ** 2;
    const disc = b * b - 4 * a * c;
    if (disc > 0 && a > 0) { const tp = (-b - Math.sqrt(disc)) / (2 * a); if (tp > 0 && tp < t) t = tp; }
    dist[j * W + i] = t;
  }
  await finish(day, dist, W, H, { method: "synthetic-box", eye: 1.5 });
}

// ---------------------------------------------------------------- other fal methods
async function cmdDa2(day, args) {
  const dir = outDir(day);
  const src = readJson(path.join(dir, "source.json"));
  const panoUrl = args.url || src.pano_source;
  const { data, entry } = await falRun({ approach: APPROACH, endpoint: "fal-ai/image-preprocessors/depth-anything/v2", estCostUsd: 0, label: day + "-da2-equirect", outDir: path.join(dir, "da2"), input: { image_url: panoUrl } });
  const W = Number(args.w || 1024), H = W / 2;
  const img = await sharp(path.resolve(process.cwd(), entry.files[0].local)).greyscale().resize(W, H, { fit: "fill" }).raw({ depth: "ushort" }).toBuffer().catch(() => null)
    ?? await sharp(path.resolve(process.cwd(), entry.files[0].local)).greyscale().resize(W, H, { fit: "fill" }).raw().toBuffer();
  const maxv = img.length === W * H * 2 ? 65535 : 255;
  const q = new Float32Array(W * H);
  const arr = img.length === W * H * 2 ? new Uint16Array(img.buffer, img.byteOffset, W * H) : img;
  for (let p = 0; p < W * H; p++) q[p] = arr[p] / maxv;
  const info = readJson(path.join(dir, "info.json"), {});
  const ref = info["moge3-fused"] ?? info["moge2-fused"];
  const refU = new Uint16Array(fs.readFileSync(path.join(dir, "depth.u16")).buffer.slice(0));
  const k = (ref.depthInfo.lnMax - ref.depthInfo.lnMin) / 65535;
  let sxx = 0, sx = 0, sy = 0, sxy = 0, n = 0;
  for (let p = 0; p < W * H; p += 5) {
    const d = Math.exp(ref.depthInfo.lnMin + refU[p] * k);
    if (d > 30) continue;
    const x = q[p], y = 1 / d;
    sxx += x * x; sx += x; sy += y; sxy += x * y; n++;
  }
  const a = (n * sxy - sx * sy) / (n * sxx - sx * sx), b = (sy - a * sx) / n;
  const farD = ref.fuse.far_m || 60;
  const dist = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) { const inv = a * q[p] + b; dist[p] = inv > 1 / farD ? 1 / inv : farD; }
  await finish(day, dist, W, H, { method: "da2-equirect", prefix: "da2_", fuse: { endpoint_latency_s: entry.latency_s, align: "scale+shift in inverse depth to the MoGe-3 fused map", a: +a.toFixed(4), b: +b.toFixed(4), source_px: data.image?.width + "x" + data.image?.height } });
}

async function cmdDa2eq(day, args) {
  const dir = outDir(day);
  const meta = readJson(path.join(dir, "da2_equirect.json"));
  const raw = fs.readFileSync(path.join(dir, "da2_equirect.f32"));
  const W = meta.w, H = meta.h;
  const d0 = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const ys = [];
  for (let j = 0; j < H; j++) {
    const lat = (0.5 - (j + 0.5) / H) * Math.PI;
    if (lat > -65 * D2R) continue;
    for (let i = 0; i < W; i += 2) ys.push(-d0[j * W + i] * Math.sin(lat));
  }
  const eye = Number(args.eye || 1.6), camH = percentile(ys, 0.5), scale = eye / camH;
  const farD = Number(args.far || 80);
  const dist = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) dist[p] = Math.min(farD, Math.max(0.2, d0[p] * scale));
  await finish(day, dist, W, H, { method: "da2-equirect", prefix: "da2e_", eye, edgeDeg: Number(args.edge || 86), fuse: { ...meta, raw_camera_height_m: +camH.toFixed(3), scale_to_eye: +scale.toFixed(3), far_m: farD } });
}

async function cmdEye(day, args) {
  const dir = outDir(day);
  if (!args.image) throw new Error("--image <eye-level image url> required");
  const meta = await sharp(Buffer.from(await (await fetch(args.image)).arrayBuffer())).metadata();
  const mp = Math.max(1, Math.ceil((meta.width * meta.height) / 1e6));
  const { data, entry } = await falRun({ approach: APPROACH, endpoint: "microsoft/moge-3", estCostUsd: 0.015 * mp, label: day + "-moge3-eye", outDir: path.join(dir, "eye"),
    input: { image_url: args.image, resolution_level: 9, num_refinement_steps: 3, apply_mask: true, export_glb: true, export_ply: false } });
  const info = readJson(path.join(dir, "info.json"), {});
  info.eye = { image: args.image, px: meta.width + "x" + meta.height, fov_x: data.fov_x, fov_y: data.fov_y, latency_s: entry.latency_s, files: entry.files.map((f) => ({ key: f.key, path: f.local && path.resolve(process.cwd(), f.local), bytes: f.bytes, url: f.url })) };
  writeJson(path.join(dir, "info.json"), info);
  console.log("eye GLB " + JSON.stringify(info.eye.files.find((f) => f.key === "model_mesh")));
}

async function cmdHunyuan(day, args) {
  const dir = outDir(day);
  const src = readJson(path.join(dir, "source.json"));
  const presets = {
    hackathon: { labels_fg1: "people, laptops, monitors, table", labels_fg2: "pizza boxes, beanbag, whiteboard", classes: "indoor" },
    "santa-cruz": { labels_fg1: "bicycles, bench, cypress trees", labels_fg2: "wharf, sea lions, surfers", classes: "outdoor" },
  };
  const input = { image_url: args.url || src.pano_source, ...(presets[day] ?? { labels_fg1: "people", labels_fg2: "trees", classes: "outdoor" }), export_drc: !!args.drc };
  const { data, entry } = await falRun({ approach: APPROACH, endpoint: "fal-ai/hunyuan_world/image-to-world", estCostUsd: 0.3, label: day + "-hunyuan-world" + (args.drc ? "-drc" : ""), outDir: path.join(dir, "hunyuan"), input, logs: true });
  console.log(JSON.stringify({ data, entry }, null, 2));
}

// ---------------------------------------------------------------- GLB export
function sphereMesh(dist, w, h, { edgeDeg = 86, scale = 1, cut = true }) {
  const nx = w + 1, rows = h + 2, nv = nx * rows;
  const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  let s0 = 0, s1 = 0;
  for (let i = 0; i < w; i++) { s0 += Math.log(dist[i]); s1 += Math.log(dist[(h - 1) * w + i]); }
  const dTop = Math.exp(s0 / w), dBot = Math.exp(s1 / w);
  for (let r = 0; r < rows; r++) {
    const v = r === 0 ? 0 : r === rows - 1 ? 1 : (r - 0.5) / h, lat = (0.5 - v) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i <= w; i++) {
      const u = i / w, lon = (u - 0.5) * 2 * Math.PI, k = r * nx + i;
      const d = (r === 0 ? dTop : r === rows - 1 ? dBot : dist[(r - 1) * w + (i % w)]) * scale;
      pos[k * 3] = Math.sin(lon) * cl * d; pos[k * 3 + 1] = sl * d; pos[k * 3 + 2] = -Math.cos(lon) * cl * d;
      uv[k * 2] = u; uv[k * 2 + 1] = v;
    }
  }
  const cosMax = Math.cos(edgeDeg * D2R), idx = [];
  const tri = (a, b, c) => {
    if (cut) {
      const A = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]];
      const e1 = [pos[b * 3] - A[0], pos[b * 3 + 1] - A[1], pos[b * 3 + 2] - A[2]], e2 = [pos[c * 3] - A[0], pos[c * 3 + 1] - A[1], pos[c * 3 + 2] - A[2]];
      const n = cross(e1, e2), C = [A[0] + (e1[0] + e2[0]) / 3, A[1] + (e1[1] + e2[1]) / 3, A[2] + (e1[2] + e2[2]) / 3];
      const nn = Math.hypot(...n) * Math.hypot(...C);
      if (nn === 0) return;
      if (!(Math.abs(n[0] * C[0] + n[1] * C[1] + n[2] * C[2]) >= cosMax * nn)) return;
    }
    idx.push(a, b, c);
  };
  for (let r = 0; r < rows - 1; r++) for (let i = 0; i < w; i++) { const a = r * nx + i, b = a + 1, c = a + nx, d = c + 1; tri(a, c, b); tri(b, c, d); }
  return { pos, uv, idx: Uint32Array.from(idx) };
}

function decodeU16(file, di) {
  const u = new Uint16Array(fs.readFileSync(file).buffer.slice(0));
  const k = (di.lnMax - di.lnMin) / 65535, d = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) d[i] = u[i] ? Math.exp(di.lnMin + u[i] * k) : 0;
  return d;
}

async function cmdGlb(day, args) {
  const { Document, NodeIO } = await import("@gltf-transform/core");
  const { ALL_EXTENSIONS, KHRMaterialsUnlit } = await import("@gltf-transform/extensions");
  const { reorder, quantize, meshopt, compactPrimitive } = await import("@gltf-transform/functions");
  const { MeshoptEncoder } = await import("meshoptimizer");
  await MeshoptEncoder.ready;
  const dir = outDir(day);
  const info = readJson(path.join(dir, "info.json"));
  const e = info[args.method || ["moge3-fused", "moge2-fused", "synthetic-box"].find((m) => info[m])];
  const t = performance.now();
  const doc = new Document();
  const buffer = doc.createBuffer();
  const unlit = doc.createExtension(KHRMaterialsUnlit);
  const sceneNode = doc.createScene("world");
  const add = (name, mesh, imgFile) => {
    const tex = doc.createTexture(name).setImage(fs.readFileSync(imgFile)).setMimeType("image/jpeg");
    const mat = doc.createMaterial(name).setBaseColorTexture(tex).setDoubleSided(true).setExtension("KHR_materials_unlit", unlit.createUnlit());
    const prim = doc.createPrimitive()
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(mesh.pos).setBuffer(buffer))
      .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(mesh.uv).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(mesh.idx).setBuffer(buffer))
      .setMaterial(mat);
    compactPrimitive(prim);
    sceneNode.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  };
  const fgDist = decodeU16(path.join(dir, "depth.u16"), e.depthInfo);
  const fg = sphereMesh(fgDist, e.depthInfo.w, e.depthInfo.h, { edgeDeg: e.edgeDeg });
  add("foreground", fg, path.join(dir, "pano.jpg"));
  if (e.bg) {
    const bgDist = decodeU16(path.join(dir, "bg.u16"), e.bg.depthInfo);
    add("background", sphereMesh(bgDist, e.bg.depthInfo.w, e.bg.depthInfo.h, { cut: false, scale: e.bg.push }), path.join(dir, "bg.jpg"));
  }
  await doc.transform(reorder({ encoder: MeshoptEncoder }), quantize(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  const glb = await io.writeBinary(doc);
  fs.writeFileSync(path.join(dir, "world.glb"), glb);
  info.glb = { bytes: glb.length, fg_tris: fg.idx.length / 3, ms: ms(t), textures: ["pano.jpg", e.bg ? "bg.jpg" : null].filter(Boolean) };
  writeJson(path.join(dir, "info.json"), info);
  console.log("world.glb " + (glb.length / 1e6).toFixed(2) + " MB, fg tris " + fg.idx.length / 3 + ", " + info.glb.ms + " ms");
}

// ---------------------------------------------------------------- publish to fal storage + manifest
async function cmdPublish(day, args) {
  const dir = outDir(day);
  const info = readJson(path.join(dir, "info.json"));
  const manifest = readJson(manifestPath, { note: "", days: {} });
  const prev = manifest.days[day] ?? {};
  const files = { ...(prev.files ?? {}) };
  const methods = [
    ["moge2-fused", "depth", "MoGe-2 ViT-L on 14 crops (CPU), fused", "MoGe×14"],
    ["moge3-fused", "depth", "MoGe-3 on 14 crops (fal), fused", "MoGe3×14"],
    ["da2-fused", "da2f", "Depth Anything V2 metric-S on 14 crops (CPU), fused", "DA2×14"],
    ["da2-equirect", "da2e", "Depth Anything V2 metric-S one-shot on the equirect", "DA2 1-shot"],
    ["synthetic-box", "synthetic", "synthetic box depth (dev)", "box"],
  ].filter(([m]) => info[m]);
  const want = new Set(["pano.jpg"]);
  const modes = {};
  for (const [m, key, label, short] of methods) {
    const e = info[m];
    want.add((e.prefix ?? "") + "depth.png");
    if (e.bg) { want.add(e.bg.tex); want.add(e.bg.depth); }
    modes[key] = { kind: "depth", label, short, depth: (e.prefix ?? "") + "depth.png", depthInfo: e.depthInfo, edgeDeg: e.edgeDeg, walk: e.walk && { ...e.walk, radius: Number(args.radius || 1.25) },
      bg: e.bg && { tex: e.bg.tex, depth: e.bg.depth, depthInfo: e.bg.depthInfo, push: e.bg.push } };
  }
  for (const f of want) {
    const p = path.join(dir, f), bytes = fs.statSync(p).size;
    fs.mkdirSync(path.join(here, "assets", day), { recursive: true });
    fs.copyFileSync(p, path.join(here, "assets", day, f));
    if (args.local) { files[f] = { url: files[f]?.bytes === bytes ? files[f].url : null, bytes }; continue; }
    if (files[f]?.bytes === bytes && files[f]?.url && !args.force) continue;
    let src = p;
    if (f.endsWith(".jpg")) {
      src = path.join(os.tmpdir(), "pano3d-" + day + "-" + f.replace(/\.jpg$/, ".jpeg"));
      fs.copyFileSync(p, src);
    }
    files[f] = { url: await upload(src), bytes };
    console.log("uploaded " + f + " " + (bytes / 1e6).toFixed(2) + " MB");
  }
  for (const f of Object.keys(files)) if (!want.has(f)) delete files[f];
  manifest.days[day] = {
    title: scenes.days[day]?.title ?? day,
    ...(day === "sample" ? { dev: true } : {}),
    pano: "pano.jpg",
    pano_source: readJson(path.join(dir, "source.json"), {}).pano_source,
    defaultMode: Object.keys(modes)[0],
    startYaw: prev.startYaw ?? 0,
    startPitch: prev.startPitch ?? -8,
    files,
    modes,
  };
  writeJson(manifestPath, manifest);
  console.log("manifest: " + day + " modes " + Object.keys(modes).join(", ") + "; files " + Object.keys(files).length);
}

const argv = process.argv.slice(2);
const cmd = argv[0];
const args = {};
for (let i = 1; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) continue;
  const k = argv[i].slice(2), v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  args[k] = v;
}
const cmds = { da2eq: cmdDa2eq, prep: cmdPrep, views: cmdViews, moge: cmdMoge, fuse: cmdFuse, synthetic: cmdSynthetic, da2: cmdDa2, eye: cmdEye, hunyuan: cmdHunyuan, glb: cmdGlb, publish: cmdPublish };
if (!cmds[cmd] || !args.day) {
  console.log("usage: node pipeline.mjs <" + Object.keys(cmds).join("|") + "> --day <day> [...]");
  process.exit(cmd ? 1 : 0);
}
const t0 = performance.now();
await cmds[cmd](args.day, args);
console.log(cmd + " done in " + ms(t0) + " ms");
