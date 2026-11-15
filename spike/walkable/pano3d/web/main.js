import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const CDN = "https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/libs/";
const qs = new URLSearchParams(location.search);
const DAY = qs.get("day") || "hackathon";
const SESSION = Math.random().toString(36).slice(2, 10);
const $ = (id) => document.getElementById(id);
const hudEl = $("hud");
const msgEl = $("msg");
const setMsg = (t) => { msgEl.textContent = t; msgEl.style.display = t ? "" : "none"; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stats = { session: SESSION, day: DAY, mode: null, load: {}, assets: {}, mesh: {} };
let manifest = null;
let dayDef = null;

const canvas = $("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Number(qs.get("dpr") || 2)));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const gl = renderer.getContext();
const dbg = gl.getExtension("WEBGL_debug_renderer_info");
const glInfo = {
  version: gl.getParameter(gl.VERSION),
  vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
  renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
  maxAniso: renderer.capabilities.getMaxAnisotropy(),
  devicePixelRatio: window.devicePixelRatio,
  pixelRatio: renderer.getPixelRatio(),
  three: THREE.REVISION,
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0b0f);
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 2000);
camera.rotation.order = "YXZ";
const worldGroup = new THREE.Group();
const panoGroup = new THREE.Group();
panoGroup.visible = false;
scene.add(worldGroup, panoGroup);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = Number(qs.get("fov")) || (w < h ? 82 : 62);
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

async function fetchAsset(name) {
  const url = "/assets/" + DAY + "/" + name;
  setMsg("loading " + name + " …");
  const t = performance.now();
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status + " " + url);
  const buf = await res.arrayBuffer();
  const entry = performance.getEntriesByName(new URL(url, location.href).href).pop();
  stats.assets[name] = { bytes: buf.byteLength, transfer: entry ? entry.encodedBodySize || entry.transferSize || null : null, ms: Math.round(performance.now() - t) };
  return buf;
}

const texCache = new Map();
async function loadTexture(name) {
  if (texCache.has(name)) return texCache.get(name);
  const p = (async () => {
    const buf = await fetchAsset(name);
    const t = performance.now();
    const type = name.endsWith(".png") ? "image/png" : name.endsWith(".webp") ? "image/webp" : "image/jpeg";
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([buf], { type }));
    await img.decode();
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = Math.min(8, glInfo.maxAniso);
    tex.needsUpdate = true;
    stats.load["decode " + name] = Math.round(performance.now() - t);
    stats.assets[name].px = img.naturalWidth + "x" + img.naturalHeight;
    return tex;
  })();
  texCache.set(name, p);
  return p;
}

async function loadDepth(name, info) {
  const u16 = new Uint16Array(await fetchAsset(name));
  const k = (info.lnMax - info.lnMin) / 65535;
  const out = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) out[i] = u16[i] ? Math.exp(info.lnMin + u16[i] * k) : 0;
  const step = Math.max(1, Number(qs.get("grid_step") || 1) | 0);
  if (step === 1) return { dist: out, w: info.w, h: info.h };
  const w = Math.floor(info.w / step), h = Math.floor(info.h / step), d = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) d[j * w + i] = out[(j * step + (step >> 1)) * info.w + i * step + (step >> 1)];
  return { dist: d, w, h };
}

function buildSphereGeometry(dist, w, h, { edgeDeg = 86, scale = 1, cut = true } = {}) {
  const nx = w + 1, rows = h + 2, nv = nx * rows;
  const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), ok = new Uint8Array(nv);
  let s0 = 0, n0 = 0, s1 = 0, n1 = 0;
  for (let i = 0; i < w; i++) {
    if (dist[i] > 0) { s0 += Math.log(dist[i]); n0++; }
    const b = dist[(h - 1) * w + i];
    if (b > 0) { s1 += Math.log(b); n1++; }
  }
  const dTop = n0 ? Math.exp(s0 / n0) : 0, dBot = n1 ? Math.exp(s1 / n1) : 0;
  for (let r = 0; r < rows; r++) {
    const v = r === 0 ? 0 : r === rows - 1 ? 1 : (r - 0.5) / h;
    const lat = (0.5 - v) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i <= w; i++) {
      const u = (i + 0.5) / w, lon = (u - 0.5) * 2 * Math.PI;
      const d = (r === 0 ? dTop : r === rows - 1 ? dBot : dist[(r - 1) * w + (i % w)]) * scale, k = r * nx + i;
      pos[k * 3] = Math.sin(lon) * cl * d;
      pos[k * 3 + 1] = sl * d;
      pos[k * 3 + 2] = -Math.cos(lon) * cl * d;
      uv[k * 2] = u;
      uv[k * 2 + 1] = 1 - v;
      ok[k] = d > 0 ? 1 : 0;
    }
  }
  const cosMax = Math.cos((edgeDeg * Math.PI) / 180);
  const idx = new Uint32Array((rows - 1) * w * 6);
  let n = 0, dropped = 0;
  const tri = (a, b, c) => {
    if (!ok[a] || !ok[b] || !ok[c]) { dropped++; return; }
    if (cut) {
      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
      const e1x = pos[b * 3] - ax, e1y = pos[b * 3 + 1] - ay, e1z = pos[b * 3 + 2] - az;
      const e2x = pos[c * 3] - ax, e2y = pos[c * 3 + 1] - ay, e2z = pos[c * 3 + 2] - az;
      const nX = e1y * e2z - e1z * e2y, nY = e1z * e2x - e1x * e2z, nZ = e1x * e2y - e1y * e2x;
      const cX = ax + (e1x + e2x) / 3, cY = ay + (e1y + e2y) / 3, cZ = az + (e1z + e2z) / 3;
      const nn = Math.sqrt((nX * nX + nY * nY + nZ * nZ) * (cX * cX + cY * cY + cZ * cZ));
      if (!(Math.abs(nX * cX + nY * cY + nZ * cZ) >= cosMax * nn)) { dropped++; return; }
    }
    idx[n++] = a; idx[n++] = b; idx[n++] = c;
  };
  for (let r = 0; r < rows - 1; r++) for (let i = 0; i < w; i++) {
    const a = r * nx + i, b = a + 1, c = a + nx, d = c + 1;
    tri(a, c, b);
    tri(b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx.subarray(0, n), 1));
  g.computeBoundingSphere();
  return { geometry: g, verts: nv, tris: n / 3, dropped };
}

function sphereMesh(tex, radius, w = 256, h = 128) {
  const { geometry } = buildSphereGeometry(new Float32Array(w * h).fill(radius), w, h, { cut: false });
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, depthWrite: false }));
}

const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setDRACOLoader(new DRACOLoader().setDecoderPath(CDN + "draco/gltf/"));
let rawDraco = null;

function disposeGroup(g) {
  g.traverse((o) => {
    o.geometry?.dispose?.();
    if (o.material) for (const m of [].concat(o.material)) { m.dispose(); }
  });
  g.clear();
}

const walk = { radius: 2.5, eye: 1.6, grid: null, yaw0: 0 };

function applyTransform(obj, tf) {
  if (!tf) return;
  if (tf.rotation) obj.rotation.set(...tf.rotation.map((d) => (d * Math.PI) / 180));
  if (tf.scale) obj.scale.setScalar(tf.scale);
  if (tf.position) obj.position.set(...tf.position);
}

async function loadMode(key) {
  const def = dayDef.modes[key];
  if (!def) throw new Error("no mode " + key + " for " + DAY);
  disposeGroup(worldGroup);
  stats.mode = key;
  stats.mesh = {};
  const t0 = performance.now();
  walk.radius = Number(qs.get("radius")) || def.walk?.radius || dayDef.walk?.radius || 2.5;
  walk.eye = def.walk?.eye ?? dayDef.walk?.eye ?? 1.6;
  walk.grid = def.walk?.grid ?? dayDef.walk?.grid ?? null;
  const panoName = def.pano || dayDef.pano;
  const panoTexP = panoName ? loadTexture(panoName) : null;
  if (def.kind === "depth") {
    const [tex, depth] = await Promise.all([panoTexP, loadDepth(def.depth, def.depthInfo)]);
    const t1 = performance.now();
    const fg = buildSphereGeometry(depth.dist, depth.w, depth.h, { edgeDeg: Number(qs.get("edge")) || def.edgeDeg || 86, cut: qs.get("cut") !== "0" });
    worldGroup.add(new THREE.Mesh(fg.geometry, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })));
    stats.mesh = { grid: depth.w + "x" + depth.h, verts: fg.verts, tris: fg.tris, cut: fg.dropped };
    if (def.bg && qs.get("bg") !== "0") {
      const [btex, bd] = await Promise.all([loadTexture(def.bg.tex), loadDepth(def.bg.depth, def.bg.depthInfo)]);
      const bg = buildSphereGeometry(bd.dist, bd.w, bd.h, { cut: false, scale: def.bg.push || 1.03 });
      const m = new THREE.Mesh(bg.geometry, new THREE.MeshBasicMaterial({ map: btex, side: THREE.DoubleSide }));
      worldGroup.add(m);
      stats.mesh.bgVerts = bg.verts;
      stats.mesh.bgTris = bg.tris;
    } else {
      worldGroup.add(sphereMesh(tex, 900));
    }
    stats.load["build " + key] = Math.round(performance.now() - t1);
  } else if (def.kind === "glb") {
    const buf = await fetchAsset(def.file);
    const t1 = performance.now();
    const gltf = await gltfLoader.parseAsync(buf, "");
    let verts = 0, tris = 0;
    gltf.scene.traverse((o) => {
      if (!o.isMesh && !o.isPoints) return;
      for (const m of [].concat(o.material)) m.side = THREE.DoubleSide;
      verts += o.geometry.attributes.position.count;
      tris += o.geometry.index ? o.geometry.index.count / 3 : o.isMesh ? o.geometry.attributes.position.count / 3 : 0;
    });
    applyTransform(gltf.scene, def.transform);
    worldGroup.add(gltf.scene);
    if (def.fill !== false && panoTexP) worldGroup.add(sphereMesh(await panoTexP, 900));
    stats.mesh = { verts, tris };
    stats.load["parse " + key] = Math.round(performance.now() - t1);
  } else if (def.kind === "layers") {
    let verts = 0, tris = 0;
    const t1 = performance.now();
    for (const f of def.files) {
      const buf = await fetchAsset(f.name);
      let geom;
      if (f.name.endsWith(".drc")) {
        rawDraco ??= new DRACOLoader().setDecoderPath(CDN + "draco/");
        geom = await new Promise((res, rej) => rawDraco.parse(buf, res, rej));
      } else geom = new PLYLoader().parse(buf);
      if (geom.attributes.color && geom.attributes.color.itemSize === 4) {
        const c = geom.attributes.color, c3 = new Float32Array(c.count * 3);
        for (let i = 0; i < c.count; i++) { c3[i * 3] = c.getX(i); c3[i * 3 + 1] = c.getY(i); c3[i * 3 + 2] = c.getZ(i); }
        geom.setAttribute("color", new THREE.BufferAttribute(c3, 3));
      }
      const colored = !!geom.attributes.color;
      const obj = geom.index
        ? new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ vertexColors: colored, side: THREE.DoubleSide, color: colored ? 0xffffff : 0x8899aa }))
        : new THREE.Points(geom, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: colored }));
      applyTransform(obj, f.transform || def.transform);
      worldGroup.add(obj);
      verts += geom.attributes.position.count;
      tris += geom.index ? geom.index.count / 3 : 0;
    }
    if (def.fill && panoTexP) worldGroup.add(sphereMesh(await panoTexP, 900));
    stats.mesh = { verts, tris, layers: def.files.length };
    stats.load["parse " + key] = Math.round(performance.now() - t1);
  }
  if (panoTexP) {
    disposeGroup(panoGroup);
    panoGroup.add(sphereMesh(await panoTexP, 500));
  }
  stats.load["mode " + key] = Math.round(performance.now() - t0);
  $("modebtn").textContent = def.short || key;
  flashTag(def.label || key);
  setMsg("");
}

// ---------- controls ----------
let yaw = 0, pitch = 0;
const cam = new THREE.Vector3(0, 0, 0);
let camY = 0;
const lookSign = qs.get("look") === "fps" ? -1 : 1;
const look = { id: null, x: 0, y: 0 };
const stick = { id: null, cx: 0, cy: 0, vx: 0, vy: 0 };
const keys = new Set();

canvas.addEventListener("pointerdown", (e) => {
  if (look.id !== null) return;
  look.id = e.pointerId; look.x = e.clientX; look.y = e.clientY;
  canvas.setPointerCapture(e.pointerId);
  script = null;
});
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerId !== look.id) return;
  const k = (1.25 * (camera.fov * Math.PI) / 180) / window.innerHeight;
  yaw += lookSign * (e.clientX - look.x) * k;
  pitch = THREE.MathUtils.clamp(pitch + lookSign * (e.clientY - look.y) * k, -1.45, 1.45);
  look.x = e.clientX; look.y = e.clientY;
});
const endLook = (e) => { if (e.pointerId === look.id) look.id = null; };
canvas.addEventListener("pointerup", endLook);
canvas.addEventListener("pointercancel", endLook);

const stickEl = $("stick"), knob = $("knob");
const STICK_R = 46;
function stickMove(e) {
  let dx = e.clientX - stick.cx, dy = e.clientY - stick.cy;
  const l = Math.hypot(dx, dy);
  if (l > STICK_R) { dx *= STICK_R / l; dy *= STICK_R / l; }
  stick.vx = dx / STICK_R; stick.vy = dy / STICK_R;
  knob.style.transform = "translate(" + dx + "px," + dy + "px)";
}
stickEl.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  const r = stickEl.getBoundingClientRect();
  stick.id = e.pointerId; stick.cx = r.left + r.width / 2; stick.cy = r.top + r.height / 2;
  stickEl.setPointerCapture(e.pointerId);
  script = null;
  stickMove(e);
});
stickEl.addEventListener("pointermove", (e) => { if (e.pointerId === stick.id) stickMove(e); });
const endStick = (e) => {
  if (e.pointerId !== stick.id) return;
  stick.id = null; stick.vx = 0; stick.vy = 0; knob.style.transform = "";
};
stickEl.addEventListener("pointerup", endStick);
stickEl.addEventListener("pointercancel", endStick);
window.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (e.code === "KeyP") setView3d(!view3d);
  if (e.code === "Space") twoSteps();
});
window.addEventListener("keyup", (e) => keys.delete(e.code));

function gridAt(arr, g, x, z) {
  const fx = THREE.MathUtils.clamp((x + g.extent) / g.cell, 0, g.n - 1.001), fz = THREE.MathUtils.clamp((z + g.extent) / g.cell, 0, g.n - 1.001);
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
  const a = arr[iz * g.n + ix], b = arr[iz * g.n + ix + 1], c = arr[(iz + 1) * g.n + ix], d = arr[(iz + 1) * g.n + ix + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}
const floorY = (x, z) => (walk.grid ? gridAt(walk.grid.floor, walk.grid, x, z) : -walk.eye);
function walkable(x, z) {
  if (Math.hypot(x, z) > walk.radius + 1e-6) return false;
  const g = walk.grid;
  if (!g || !g.blocked) return true;
  const ix = Math.round((x + g.extent) / g.cell), iz = Math.round((z + g.extent) / g.cell);
  if (ix < 0 || iz < 0 || ix >= g.n || iz >= g.n) return false;
  return g.blocked[iz * g.n + ix] !== 1;
}
function tryMove(dx, dz) {
  let x = cam.x + dx, z = cam.z + dz;
  const r = Math.hypot(x, z);
  if (r > walk.radius) { x *= walk.radius / r; z *= walk.radius / r; }
  if (walkable(x, z)) { cam.x = x; cam.z = z; return; }
  if (walkable(cam.x + dx, cam.z)) cam.x += dx;
  else if (walkable(cam.x, cam.z + dz)) cam.z += dz;
}

// ---------- view toggle, scripted moves, demo ----------
let view3d = true;
let tagTimer = 0;
function flashTag(t) {
  const el = $("tagtext");
  el.textContent = t; el.classList.add("show");
  clearTimeout(tagTimer);
  tagTimer = setTimeout(() => el.classList.remove("show"), 1600);
}
function setView3d(on) {
  view3d = on;
  worldGroup.visible = on;
  panoGroup.visible = !on;
  $("toggle").textContent = on ? "3D" : "Pano";
  $("toggle").classList.toggle("on", on);
  flashTag(on ? "3D mesh: real parallax" : "Plain panorama: no parallax");
}

let script = null;
function runScript(keyframes) {
  const f = new THREE.Vector2(-Math.sin(yaw), -Math.cos(yaw)), r = new THREE.Vector2(Math.cos(yaw), -Math.sin(yaw));
  const base = { x: cam.x, z: cam.z, yaw, pitch };
  script = {
    t0: performance.now() / 1000,
    keys: keyframes.map((k) => ({
      t: k.t,
      x: base.x + (k.fwd ?? 0) * f.x + (k.right ?? 0) * r.x,
      z: base.z + (k.fwd ?? 0) * f.y + (k.right ?? 0) * r.y,
      yaw: base.yaw + ((k.yaw ?? 0) * Math.PI) / 180,
      pitch: k.pitch !== undefined ? (k.pitch * Math.PI) / 180 : base.pitch,
      view: k.view,
      bob: k.bob,
    })),
    lastView: null,
  };
}
const smooth = (t) => t * t * (3 - 2 * t);
function stepScript(now) {
  const t = now - script.t0, ks = script.keys;
  let i = 0;
  while (i < ks.length - 1 && t > ks[i + 1].t) i++;
  const a = ks[i], b = ks[Math.min(i + 1, ks.length - 1)];
  const s = b.t > a.t ? smooth(THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1)) : 1;
  const x = a.x + (b.x - a.x) * s, z = a.z + (b.z - a.z) * s;
  tryMove(x - cam.x, z - cam.z);
  yaw = a.yaw + (b.yaw - a.yaw) * s;
  pitch = a.pitch + (b.pitch - a.pitch) * s;
  if (a.view && script.lastView !== a.view + i) { script.lastView = a.view + i; setView3d(a.view === "3d"); }
  scriptBob = b.bob ? Math.sin(s * Math.PI * 2) * 0.025 : 0;
  if (t > ks[ks.length - 1].t) script = null;
}
let scriptBob = 0;
function twoSteps() {
  runScript([
    { t: 0 },
    { t: 0.9, fwd: 0.7, bob: true },
    { t: 1.8, fwd: 1.4, bob: true },
    { t: 2.8, fwd: 1.4 },
    { t: 4.4, fwd: 0, bob: true },
  ]);
}
const DEMO = [
  { t: 0, view: "3d", pitch: -6 },
  { t: 1.5, yaw: 14, pitch: -6 },
  { t: 3.0, yaw: 0, pitch: -6 },
  { t: 4.0, fwd: 0.7, bob: true },
  { t: 5.0, fwd: 1.4, bob: true },
  { t: 6.4, fwd: 1.4, right: -0.9 },
  { t: 8.4, fwd: 1.4, right: 0.9 },
  { t: 9.2, fwd: 1.4, right: 0.9, view: "pano" },
  { t: 11.2, fwd: 1.4, right: -0.9 },
  { t: 12.0, fwd: 1.4, right: -0.9, view: "3d" },
  { t: 14.0, fwd: 1.4, right: 0.9 },
  { t: 15.0, fwd: 1.4, right: 0.9, yaw: -20 },
  { t: 17.0, fwd: 0, right: 0, yaw: 0 },
];
function demo() { cam.set(0, 0, 0); runScript(DEMO); }

async function record() {
  const btn = $("rec");
  if (!canvas.captureStream || !window.MediaRecorder) { flashTag("no MediaRecorder here"); return; }
  const type = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 8e6 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  btn.classList.add("on"); btn.textContent = "● recording";
  rec.start(1000);
  demo();
  await sleep(DEMO[DEMO.length - 1].t * 1000 + 600);
  rec.stop();
  await stopped;
  const blob = new Blob(chunks, { type: rec.mimeType || type });
  btn.textContent = "uploading";
  try {
    const res = await fetch("/clip?name=" + encodeURIComponent(DAY + "-" + stats.mode), { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
    flashTag("clip " + (blob.size / 1e6).toFixed(1) + " MB " + (res.ok ? "saved" : "failed"));
  } catch (e) { flashTag("clip upload failed"); }
  btn.classList.remove("on"); btn.textContent = "● rec";
}

$("toggle").addEventListener("click", () => setView3d(!view3d));
$("steps").addEventListener("click", twoSteps);
$("rec").addEventListener("click", record);
$("hudbtn").addEventListener("click", () => hudEl.classList.toggle("off"));
$("modebtn").addEventListener("click", async () => {
  const keysList = Object.keys(dayDef.modes);
  const next = keysList[(keysList.indexOf(stats.mode) + 1) % keysList.length];
  try { await loadMode(next); post("mode"); } catch (e) { setMsg(String(e.message || e)); }
});
if (qs.get("hud") === "0") hudEl.classList.add("off");

// ---------- stats ----------
const dts = [];
let frames = 0, fpsT = performance.now(), fps = 0, last = performance.now(), posts = 0, firstFrame = false;
function frameStats() {
  const s = [...dts].sort((a, b) => a - b);
  const avg = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
  return { avg: +avg.toFixed(2), p95: +(s[Math.floor(s.length * 0.95)] || 0).toFixed(2), max: +(s[s.length - 1] || 0).toFixed(2) };
}
function snapshot(event) {
  return {
    event, session: SESSION, day: DAY, mode: stats.mode, view: view3d ? "3d" : "pano",
    t: +(performance.now() / 1000).toFixed(1), fps: +fps.toFixed(1), frameMs: frameStats(),
    gl: glInfo, screen: { w: window.innerWidth, h: window.innerHeight }, canvas: { w: canvas.width, h: canvas.height },
    render: { tris: renderer.info.render.triangles, calls: renderer.info.render.calls, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures },
    mesh: stats.mesh, load: stats.load, assets: stats.assets,
    pos: { x: +cam.x.toFixed(2), z: +cam.z.toFixed(2), r: +Math.hypot(cam.x, cam.z).toFixed(2), yawDeg: Math.round((yaw * 180) / Math.PI) },
    jsHeapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
    hw: navigator.hardwareConcurrency || null,
  };
}
function post(event) {
  if (posts >= 120) return;
  posts++;
  fetch("/stats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snapshot(event)), keepalive: true }).catch(() => {});
}
setInterval(() => firstFrame && post("periodic"), 5000);
document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && post("hidden"));
canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); setMsg("WebGL context lost"); post("contextlost"); });
window.addEventListener("error", (e) => { setMsg("error: " + e.message); post("error: " + e.message); });

const mb = (b) => (b / 1e6).toFixed(2);
function hudText() {
  const fs = frameStats();
  const total = Object.values(stats.assets).reduce((s, a) => s + (a.transfer || a.bytes), 0);
  const assets = Object.entries(stats.assets).map(([n, a]) => n + " " + mb(a.bytes) + (a.transfer && a.transfer !== a.bytes ? "→" + mb(a.transfer) + "gz" : "") + (a.px ? " " + a.px : "")).join(" · ");
  const ri = renderer.info;
  const load = Object.entries(stats.load).map(([k, v]) => k + " " + v).join(" · ");
  return [
    DAY + " · " + (dayDef?.modes?.[stats.mode]?.label || stats.mode || "…") + " · " + (view3d ? "3D" : "PANO"),
    "fps " + fps.toFixed(1) + " · frame " + fs.avg.toFixed(1) + " ms p95 " + fs.p95.toFixed(1) + " max " + fs.max.toFixed(0),
    glInfo.renderer + " · " + glInfo.version.slice(0, 10) + " · maxTex " + glInfo.maxTexture + " · dpr " + glInfo.devicePixelRatio + "→" + glInfo.pixelRatio + " · " + canvas.width + "×" + canvas.height,
    "draw " + ri.render.calls + " · tris " + ri.render.triangles.toLocaleString() + " · verts " + (stats.mesh.verts || 0).toLocaleString() + (stats.mesh.cut ? " · cut " + stats.mesh.cut.toLocaleString() : "") + " · tex " + ri.memory.textures,
    "dl " + mb(total) + " MB: " + assets,
    "ms: " + load,
    "pos " + cam.x.toFixed(2) + "," + cam.z.toFixed(2) + " · " + Math.hypot(cam.x, cam.z).toFixed(2) + "/" + walk.radius + " m · eye " + camY.toFixed(2),
  ].join("\n");
}
setInterval(() => { if (!hudEl.classList.contains("off")) hudEl.textContent = hudText(); }, 500);

// ---------- loop ----------
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  dts.push((now - last));
  if (dts.length > 240) dts.shift();
  last = now;
  frames++;
  if (now - fpsT >= 1000) { fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; }

  if (script) stepScript(now / 1000);
  else {
    let fwd = -stick.vy, str = stick.vx;
    if (keys.has("KeyW")) fwd += 1;
    if (keys.has("KeyS")) fwd -= 1;
    if (keys.has("KeyA")) str -= 1;
    if (keys.has("KeyD")) str += 1;
    if (keys.has("ArrowLeft")) yaw += dt * 1.2;
    if (keys.has("ArrowRight")) yaw -= dt * 1.2;
    if (keys.has("ArrowUp")) pitch = Math.min(1.45, pitch + dt);
    if (keys.has("ArrowDown")) pitch = Math.max(-1.45, pitch - dt);
    if (fwd || str) {
      const sp = 1.3 * dt, sy = Math.sin(yaw), cy = Math.cos(yaw);
      tryMove((-sy * fwd + cy * str) * sp, (-cy * fwd - sy * str) * sp);
    }
  }
  const targetY = floorY(cam.x, cam.z) + walk.eye;
  camY += (targetY - camY) * Math.min(1, dt * 10);
  camera.position.set(cam.x, camY + scriptBob, cam.z);
  camera.rotation.set(pitch, yaw, 0);
  panoGroup.position.copy(camera.position);
  renderer.render(scene, camera);
  if (!firstFrame && stats.mode) {
    firstFrame = true;
    stats.load.firstFrame = Math.round(performance.now());
    setTimeout(() => post("load"), 1500);
  }
}

async function main() {
  const t = performance.now();
  manifest = await (await fetch("/manifest.json")).json();
  dayDef = manifest.days[DAY];
  if (!dayDef) throw new Error("no day '" + DAY + "' in manifest; have " + Object.keys(manifest.days).join(", "));
  stats.load.manifest = Math.round(performance.now() - t);
  yaw = ((dayDef.startYaw || 0) * Math.PI) / 180;
  pitch = ((dayDef.startPitch || 0) * Math.PI) / 180;
  const mode = qs.get("mode") && dayDef.modes[qs.get("mode")] ? qs.get("mode") : dayDef.defaultMode || Object.keys(dayDef.modes)[0];
  await loadMode(mode);
  camY = floorY(0, 0) + walk.eye;
  if (qs.get("view") === "pano") setView3d(false);
  renderer.setAnimationLoop(loop);
  if (qs.get("auto") === "demo") setTimeout(demo, 1200);
  if (qs.get("auto") === "rec") setTimeout(record, 1500);
}
main().catch((e) => { setMsg("failed: " + (e.message || e)); post("error: " + (e.message || e)); console.error(e); });
