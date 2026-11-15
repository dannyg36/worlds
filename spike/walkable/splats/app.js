import * as THREE from "three";
import { SparkRenderer, SplatMesh, PackedSplats, utils } from "@sparkjsdev/spark";

const T_MODULE = performance.now();
const qs = new URLSearchParams(location.search);
const cfg = {
  day: qs.get("day") || "hackathon",
  src: qs.get("src") || "pano",
  bench: qs.get("bench"),
  set: qs.get("set") || "synthetic",
  step: Number(qs.get("step") || 0),
  n: Number(qs.get("n") || 0),
  lod: qs.get("lod") === "1",
  dpr: Number(qs.get("dpr")) || Math.min(window.devicePixelRatio || 1, 2),
  auto: qs.get("auto") === "1",
  hud: qs.get("hud") !== "0",
  rec: Number(qs.get("rec") || 0),
  stdev: Number(qs.get("stdev")) || 0,
  mode: qs.get("mode"),
  file: qs.get("file"),
  radius: Number(qs.get("radius")) || 0,
  offline: Number(qs.get("offline") || 0),
  fps: Number(qs.get("fps") || 24),
  name: qs.get("name") || "",
};
const $ = (id) => document.getElementById(id);
const session = Math.random().toString(36).slice(2, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n, d = 1) => (n == null || !isFinite(n) ? "–" : Number(n).toFixed(d));
const mb = (b) => (b / 1e6).toFixed(1) + " MB";

function post(event, data = {}) {
  const body = JSON.stringify({ event, session, query: location.search, t_ms: Math.round(performance.now()), ...data });
  try {
    if (event === "pagehide" && navigator.sendBeacon) {
      navigator.sendBeacon("stats", new Blob([body], { type: "application/json" }));
      return;
    }
    fetch("stats", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: body.length < 60000 }).catch(() => {});
  } catch {}
}
window.addEventListener("error", (e) => post("error", { message: String(e.message), source: e.filename, line: e.lineno }));
window.addEventListener("unhandledrejection", (e) => post("error", { message: String(e.reason?.message ?? e.reason) }));
document.addEventListener("gesturestart", (e) => e.preventDefault());

const loadingEl = $("loading");
function setLoading(text, frac, meta) {
  if (text != null) loadingEl.querySelector(".t").textContent = text;
  if (frac != null) loadingEl.querySelector(".p i").style.width = Math.round(Math.min(1, frac) * 100) + "%";
  if (meta != null) loadingEl.querySelector(".m").textContent = meta;
}
function fail(msg) {
  loadingEl.classList.remove("done");
  setLoading("Could not load this world", 0, msg);
  post("error", { message: msg });
}

// ---------- renderer ----------
const canvas = $("c");
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
} catch (e) {
  fail("WebGL2 unavailable: " + e.message);
  throw e;
}
renderer.setPixelRatio(cfg.dpr);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.02, 2000);
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 78 : 60;
  camera.updateProjectionMatrix();
}
resize();
window.addEventListener("resize", resize);
canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); post("contextlost", summary()); fail("WebGL context lost (GPU memory pressure?)"); });

function deviceInfo() {
  const gl = renderer.getContext();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const exts = gl.getSupportedExtensions() || [];
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad/.test(ua);
  const s3tc = exts.includes("WEBGL_compressed_texture_s3tc");
  return {
    ua,
    screen: screen.width + "x" + screen.height,
    viewport: innerWidth + "x" + innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    renderDpr: cfg.dpr,
    drawingBuffer: gl.drawingBufferWidth + "x" + gl.drawingBufferHeight,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemory: navigator.deviceMemory ?? null,
    maxTouchPoints: navigator.maxTouchPoints ?? null,
    webgl: typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext ? "webgl2" : "webgl1",
    glVersion: gl.getParameter(gl.VERSION),
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    max3dTextureSize: gl.getParameter(gl.MAX_3D_TEXTURE_SIZE),
    maxArrayLayers: gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS),
    compressedTextureExts: exts.filter((e) => /compressed/i.test(e)),
    extCount: exts.length,
    simulatorHint: ios && s3tc ? "iOS UA but S3TC/BC textures exposed: GPU looks like a Mac (simulator?)" : ios ? "no BC/S3TC textures: consistent with a real iPhone GPU" : "not iOS",
  };
}
const device = deviceInfo();

const spark = new SparkRenderer({ renderer, ...(cfg.stdev ? { maxStdDev: cfg.stdev } : {}) });
scene.add(spark);

// Wrap Spark's sort driver to time each depth-readback + worker sort round trip.
const sortStats = { count: 0, recent: [], firstAt: null };
{
  const orig = spark.driveSort.bind(spark);
  spark.driveSort = async function () {
    const before = spark.lastSortTime;
    const t0 = performance.now();
    await orig();
    if (spark.lastSortTime !== before) {
      const t1 = performance.now();
      sortStats.count++;
      sortStats.recent.push({ t: t1, ms: t1 - t0 });
      if (sortStats.recent.length > 300) sortStats.recent.shift();
      if (sortStats.firstAt == null && loadState.initAt != null) sortStats.firstAt = t1;
    }
  };
}

// ---------- frame stats ----------
const frames = []; // { t, dt, cpu }
let lastFrameT = null;
function windowStats(ms = 5000) {
  const now = performance.now();
  const fr = frames.filter((f) => f.t >= now - ms);
  if (fr.length < 2) return null;
  const dts = fr.map((f) => f.dt).sort((a, b) => a - b);
  const span = fr[fr.length - 1].t - fr[0].t;
  const pick = (q) => dts[Math.min(dts.length - 1, Math.floor(q * dts.length))];
  const sorts = sortStats.recent.filter((s) => s.t >= now - ms);
  return {
    fps: ((fr.length - 1) / span) * 1000,
    frame_ms_avg: dts.reduce((s, x) => s + x, 0) / dts.length,
    frame_ms_p50: pick(0.5),
    frame_ms_p95: pick(0.95),
    frame_ms_max: dts[dts.length - 1],
    long_frames_over_50ms: dts.filter((x) => x > 50).length,
    cpu_ms_avg: fr.reduce((s, f) => s + f.cpu, 0) / fr.length,
    sort_ms_avg: sorts.length ? sorts.reduce((s, x) => s + x.ms, 0) / sorts.length : null,
    sorts_per_s: (sorts.length / ms) * 1000,
    frames: fr.length,
  };
}

// ---------- view / controls ----------
const view = { mode: "walk", eye: new THREE.Vector3(0, 0, 0), radius: 1.5, target: new THREE.Vector3(), dist: 3, minDist: 0.3, maxDist: 20 };
let yaw = 0, pitch = 0;
const pos = new THREE.Vector3();
const euler = new THREE.Euler(0, 0, 0, "YXZ");
const stickEl = $("stick"), knobEl = $("knob");
const stick = { id: null, x: 0, y: 0, cx: 0, cy: 0 };
const looks = new Map();
let pinchDist = null;
let lastInputAt = 0;
const keys = new Set();

function setMode(mode) {
  view.mode = mode;
  stickEl.classList.toggle("hidden", mode !== "walk");
  $("hint").textContent = mode === "walk" ? "drag to look · stick to walk" : "drag to orbit · pinch to zoom";
}
function applyCamera() {
  if (view.mode === "orbit") {
    const cp = Math.cos(pitch);
    camera.position.set(view.target.x + view.dist * Math.sin(yaw) * cp, view.target.y + view.dist * Math.sin(pitch), view.target.z + view.dist * Math.cos(yaw) * cp);
    camera.lookAt(view.target);
  } else {
    camera.position.copy(pos);
    euler.set(pitch, yaw, 0, "YXZ");
    camera.quaternion.setFromEuler(euler);
  }
}
canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
  lastInputAt = performance.now();
  if (looks.size === 2) {
    const [a, b] = [...looks.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
});
canvas.addEventListener("pointermove", (e) => {
  const p = looks.get(e.pointerId);
  if (!p) return;
  lastInputAt = performance.now();
  if (looks.size >= 2) {
    p.x = e.clientX; p.y = e.clientY;
    const [a, b] = [...looks.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist && view.mode === "orbit") view.dist = THREE.MathUtils.clamp(view.dist * (pinchDist / d), view.minDist, view.maxDist);
    pinchDist = d;
    return;
  }
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  const k = view.mode === "orbit" ? 0.008 : 0.0045;
  if (view.mode === "orbit") {
    yaw -= dx * k;
    pitch = THREE.MathUtils.clamp(pitch + dy * k, -0.2, 1.35);
  } else {
    yaw += dx * k;
    pitch = THREE.MathUtils.clamp(pitch + dy * k, -1.4, 1.4);
  }
});
const endLook = (e) => { looks.delete(e.pointerId); if (looks.size < 2) pinchDist = null; };
canvas.addEventListener("pointerup", endLook);
canvas.addEventListener("pointercancel", endLook);
canvas.addEventListener("wheel", (e) => { if (view.mode === "orbit") view.dist = THREE.MathUtils.clamp(view.dist * Math.exp(e.deltaY * 0.001), view.minDist, view.maxDist); }, { passive: true });
stickEl.addEventListener("pointerdown", (e) => {
  stickEl.setPointerCapture(e.pointerId);
  const r = stickEl.getBoundingClientRect();
  Object.assign(stick, { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2 });
  moveStick(e);
});
function moveStick(e) {
  if (e.pointerId !== stick.id) return;
  lastInputAt = performance.now();
  let dx = (e.clientX - stick.cx) / 50, dy = (e.clientY - stick.cy) / 50;
  const l = Math.hypot(dx, dy);
  if (l > 1) { dx /= l; dy /= l; }
  stick.x = dx; stick.y = dy;
  knobEl.style.transform = "translate(" + dx * 35 + "px," + dy * 35 + "px)";
}
stickEl.addEventListener("pointermove", moveStick);
const endStick = (e) => { if (e.pointerId !== stick.id) return; stick.id = null; stick.x = stick.y = 0; knobEl.style.transform = ""; };
stickEl.addEventListener("pointerup", endStick);
stickEl.addEventListener("pointercancel", endStick);
window.addEventListener("keydown", (e) => keys.add(e.code));
window.addEventListener("keyup", (e) => keys.delete(e.code));

function updateControls(dt, t) {
  if (cfg.auto || (performance.now() - lastInputAt > 8000 && view.mode === "orbit")) {
    yaw += (view.mode === "orbit" ? 0.25 : 0.3) * dt * (cfg.auto ? 1 : 0.6);
    if (cfg.auto && view.mode === "walk") {
      pitch = Math.sin(t * 0.35) * 0.12;
      pos.set(view.eye.x + Math.sin(t * 0.4) * view.radius * 0.45, view.eye.y, view.eye.z + Math.sin(t * 0.23) * view.radius * 0.35);
    }
  }
  if (view.mode !== "walk") return;
  let mf = -stick.y, ms = stick.x;
  if (keys.has("KeyW") || keys.has("ArrowUp")) mf += 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) mf -= 1;
  if (keys.has("KeyD")) ms += 1;
  if (keys.has("KeyA")) ms -= 1;
  if (keys.has("ArrowLeft")) yaw += 1.6 * dt;
  if (keys.has("ArrowRight")) yaw -= 1.6 * dt;
  if (!mf && !ms) return;
  const speed = 1.4 * dt;
  pos.x += (Math.cos(yaw) * ms - Math.sin(yaw) * mf) * speed;
  pos.z += (-Math.sin(yaw) * ms - Math.cos(yaw) * mf) * speed;
  const dx = pos.x - view.eye.x, dz = pos.z - view.eye.z, d = Math.hypot(dx, dz);
  if (d > view.radius) { pos.x = view.eye.x + (dx / d) * view.radius; pos.z = view.eye.z + (dz / d) * view.radius; }
  pos.y = view.eye.y;
}

// ---------- loading ----------
const loadState = { bytes: 0, fetchMs: null, initMs: null, initAt: null, firstFrameAt: null, numSplats: 0, label: "", kind: "", file: null };

async function fetchBytes(url) {
  const t0 = performance.now();
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  const total = Number(res.headers.get("X-Raw-Length") || res.headers.get("Content-Length") || 0);
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    setLoading(null, total ? got / total : 0, "downloading " + mb(got) + (total ? " / " + mb(total) : ""));
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  return { buf, ms: performance.now() - t0 };
}

function makeSynthetic(n) {
  // A 9 x 3.2 x 9 m room seen from the middle, plus a table and a few balls: realistic overdraw for an indoor world.
  const W = 9, H = 3.2, floorY = -1.6;
  const quads = [
    { c: [0, floorY, 0], u: [W, 0, 0], v: [0, 0, W], q: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], col: (x, z) => [0.55 + 0.1 * ((Math.floor(x * 2) + Math.floor(z * 0.5)) & 1), 0.38, 0.22] },
    { c: [0, floorY + H, 0], u: [W, 0, 0], v: [0, 0, W], q: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], col: () => [0.85, 0.83, 0.8] },
    { c: [0, floorY + H / 2, -W / 2], u: [W, 0, 0], v: [0, H, 0], q: [0, 0, 0, 1], col: (x, y) => [0.2 + 0.6 * (y > 0.3 && Math.abs(x) < 3 ? 1 : 0), 0.5, 0.7] },
    { c: [0, floorY + H / 2, W / 2], u: [W, 0, 0], v: [0, H, 0], q: [0, 0, 0, 1], col: () => [0.7, 0.62, 0.5] },
    { c: [-W / 2, floorY + H / 2, 0], u: [0, 0, W], v: [0, H, 0], q: [0, Math.SQRT1_2, 0, Math.SQRT1_2], col: (z) => [0.3, 0.45 + 0.2 * Math.sin(z * 3), 0.4] },
    { c: [W / 2, floorY + H / 2, 0], u: [0, 0, W], v: [0, H, 0], q: [0, Math.SQRT1_2, 0, Math.SQRT1_2], col: () => [0.75, 0.55, 0.35] },
    { c: [0, floorY + 0.75, -1.6], u: [3, 0, 0], v: [0, 0, 1], q: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], col: () => [0.45, 0.28, 0.15] },
  ];
  const balls = Array.from({ length: 12 }, (_, i) => ({ c: [Math.cos(i * 2.1) * 3, floorY + 0.4 + (i % 3) * 0.5, Math.sin(i * 2.1) * 3], r: 0.25 + (i % 4) * 0.1, col: [0.3 + 0.6 * ((i * 37) % 10) / 10, 0.3 + 0.6 * ((i * 53) % 10) / 10, 0.4] }));
  const areas = [...quads.map((q) => Math.hypot(...q.u) * Math.hypot(...q.v)), ...balls.map((b) => 4 * Math.PI * b.r * b.r)];
  const total = areas.reduce((s, a) => s + a, 0);
  const cum = [];
  areas.reduce((s, a, i) => (cum[i] = (s + a) / total), 0);
  const sigma = 0.75 * Math.sqrt(total / n);
  const arr = new Uint32Array(n * 4);
  const tmpQ = new THREE.Quaternion(), zAxis = new THREE.Vector3(0, 0, 1), nrm = new THREE.Vector3();
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    const r = rnd();
    let k = 0;
    while (k < cum.length - 1 && cum[k] < r) k++;
    const jit = 0.9 + 0.2 * rnd();
    let x, y, z, qx, qy, qz, qw, col;
    if (k < quads.length) {
      const q = quads[k], a = rnd() - 0.5, b = rnd() - 0.5;
      x = q.c[0] + q.u[0] * a + q.v[0] * b; y = q.c[1] + q.u[1] * a + q.v[1] * b; z = q.c[2] + q.u[2] * a + q.v[2] * b;
      [qx, qy, qz, qw] = q.q;
      col = q.col(a * Math.hypot(...q.u), b * Math.hypot(...q.v));
    } else {
      const bl = balls[k - quads.length];
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      nrm.set(s * Math.cos(th), u, s * Math.sin(th));
      x = bl.c[0] + nrm.x * bl.r; y = bl.c[1] + nrm.y * bl.r; z = bl.c[2] + nrm.z * bl.r;
      tmpQ.setFromUnitVectors(zAxis, nrm);
      qx = tmpQ.x; qy = tmpQ.y; qz = tmpQ.z; qw = tmpQ.w;
      col = bl.col.map((c) => c * (0.7 + 0.3 * nrm.y));
    }
    utils.setPackedSplat(arr, i, x, y, z, sigma * jit, sigma * jit, sigma * 0.08, qx, qy, qz, qw, 0.92, col[0] * jit, col[1] * jit, col[2] * jit);
  }
  return new PackedSplats({ packedArray: arr, numSplats: n });
}

function buildBar(manifest, entries, current) {
  const bar = $("bar");
  bar.innerHTML = "";
  const btn = (label, on, onclick) => {
    const b = document.createElement("button");
    b.textContent = label;
    if (on) b.className = "on";
    b.onclick = onclick;
    bar.appendChild(b);
    return b;
  };
  const go = (patch) => {
    const p = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(patch)) v == null ? p.delete(k) : p.set(k, v);
    location.search = p.toString();
  };
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.src)) continue;
    seen.add(e.src);
    btn(e.short || e.src, current && e.src === current.src, () => go({ src: e.src, bench: null }));
  }
  for (const d of manifest.days ?? ["hackathon", "santa-cruz"]) btn(d === "santa-cruz" ? "Santa Cruz" : d[0].toUpperCase() + d.slice(1), d === cfg.day, () => go({ day: d }));
  if (current && current.view?.mode === "orbit") btn("Walk in", false, (ev) => { const walk = view.mode !== "walk"; enterMode(walk ? "walk" : "orbit"); ev.target.className = walk ? "on" : ""; });
  btn("HUD", cfg.hud, (ev) => { cfg.hud = !cfg.hud; $("hud").classList.toggle("off", !cfg.hud); ev.target.className = cfg.hud ? "on" : ""; });
  btn("● 10s", false, () => recordClip(10, (current?.id || "bench") + "-manual"));
}

let mesh = null;
let walkSetup = null;
function enterMode(mode) {
  if (mode === "walk" && walkSetup) {
    view.eye.copy(walkSetup.eye);
    view.radius = walkSetup.radius;
    pos.copy(walkSetup.eye);
    yaw = walkSetup.yaw;
    pitch = 0;
  }
  if (mode === "orbit") { yaw = 0.6; pitch = 0.45; }
  setMode(mode);
}

function raycastDown(x, z, top, bottom) {
  const rc = new THREE.Raycaster(new THREE.Vector3(x, top, z), new THREE.Vector3(0, -1, 0), 0, top - bottom);
  try {
    const hits = rc.intersectObject(mesh, false);
    return hits.length ? hits[0].point.y : null;
  } catch {
    return null;
  }
}

async function loadAsset(manifest) {
  const entries = manifest.assets.filter((a) => a.src && (a.day === cfg.day || a.day === "*"));
  let entry = null;
  if (cfg.bench === "synthetic" || (cfg.bench === "suite" && cfg.n > 0) || (cfg.bench === "suite" && !cfg.file && !qs.get("src"))) {
    buildBar(manifest, entries, null);
    const n = cfg.n || (cfg.bench === "suite" ? SUITES[cfg.set]?.[cfg.step]?.n : 0) || 1e6;
    if (cfg.bench === "suite") $("bar").style.display = "none";
    setLoading("Generating " + (n / 1e6).toFixed(2) + "M synthetic splats…", 0.5, "");
    await sleep(30);
    const t0 = performance.now();
    const packedSplats = makeSynthetic(n);
    loadState.fetchMs = 0;
    loadState.genMs = performance.now() - t0;
    loadState.label = "synthetic room " + (n / 1e6).toFixed(2) + "M";
    loadState.kind = "synthetic";
    mesh = new SplatMesh({ packedSplats, ...(cfg.lod ? { lod: true } : {}) });
    view.eye.set(0, 0, 0);
    view.radius = 2;
  } else {
    entry = cfg.file
      ? { id: "file", src: "file", path: cfg.file, label: cfg.file.split("/").pop(), kind: "local-file", local: true, view: { mode: "walk", radius: cfg.radius || 1.5 } }
      : entries.find((a) => a.src === cfg.src && a.day === cfg.day) || entries.find((a) => a.src === cfg.src) || entries.find((a) => a.day === cfg.day) || entries[0];
    if (!entry) throw new Error("no splat asset for day=" + cfg.day + " in manifest.json (run fetch-assets.mjs?)");
    buildBar(manifest, entries, entry);
    if (cfg.bench === "suite") $("bar").style.display = "none";
    loadState.label = entry.label || entry.id;
    loadState.kind = entry.kind;
    loadState.file = entry.path;
    setLoading("Loading " + loadState.label, 0, "");
    const { buf, ms } = await fetchBytes((entry.local ? "" : "assets/") + entry.path);
    loadState.bytes = buf.length;
    loadState.fetchMs = ms;
    setLoading("Decoding splats…", 1, mb(buf.length) + " in " + fmt(ms / 1000, 1) + " s");
    mesh = new SplatMesh({ fileBytes: buf, fileName: entry.path.split("/").pop(), ...(cfg.lod ? { lod: true } : {}) });
  }
  const tInit0 = performance.now();
  const v = entry?.view ?? {};
  if (v.rotateX180) mesh.quaternion.set(1, 0, 0, 0);
  if (v.quat) mesh.quaternion.fromArray(v.quat);
  if (v.scale) mesh.scale.setScalar(v.scale);
  if (v.position) mesh.position.fromArray(v.position);
  if (v.bg) scene.background = new THREE.Color(v.bg);
  if (v.maxStdDev && !cfg.stdev) spark.maxStdDev = v.maxStdDev;
  scene.add(mesh);
  await mesh.initialized;
  loadState.initAt = performance.now();
  loadState.initMs = loadState.initAt - tInit0;
  loadState.numSplats = mesh.packedSplats?.numSplats ?? mesh.numSplats ?? 0;
  mesh.updateMatrixWorld(true);

  const mode = cfg.mode || v.mode || "walk";
  if (v.eye) view.eye.fromArray(v.eye);
  if (v.radius) view.radius = v.radius;
  if (cfg.radius) view.radius = cfg.radius;
  yaw = THREE.MathUtils.degToRad(v.yaw ?? 0);
  pitch = THREE.MathUtils.degToRad(v.pitch ?? 0);
  pos.copy(view.eye);
  if (v.mode === "orbit") {
    const box = mesh.getBoundingBox(true).applyMatrix4(mesh.matrixWorld);
    const size = box.getSize(new THREE.Vector3());
    box.getCenter(view.target);
    const r = 0.5 * Math.max(size.x, size.y, size.z);
    view.dist = r * 2.6; view.minDist = r * 0.6; view.maxDist = r * 6;
    // Walk-in: scale the diorama so its footprint matches the scene spec's island, then stand on its floor.
    const islandM = v.islandDiameterM ?? 12;
    const s = islandM / Math.max(size.x, size.z);
    mesh.scale.multiplyScalar(s);
    mesh.position.sub(view.target).multiplyScalar(s).add(view.target);
    mesh.updateMatrixWorld(true);
    const box2 = mesh.getBoundingBox(true).applyMatrix4(mesh.matrixWorld);
    const c2 = box2.getCenter(new THREE.Vector3()), s2 = box2.getSize(new THREE.Vector3());
    const sx = c2.x, sz = c2.z + s2.z * 0.22;
    const hits = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]].map(([ox, oz]) => raycastDown(sx + ox, sz + oz, box2.max.y + 1, box2.min.y - 1)).filter((h) => h != null).sort((a, b) => a - b);
    const floorY = hits.length ? hits[Math.floor(hits.length / 2)] : box2.min.y + s2.y * 0.35;
    walkSetup = { eye: new THREE.Vector3(sx, floorY + 1.6, sz), radius: islandM * 0.42, yaw: 0, floorY, scale: s };
    mesh.scale.multiplyScalar(1 / s);
    mesh.position.sub(view.target).multiplyScalar(1 / s).add(view.target);
    mesh.updateMatrixWorld(true);
    enterMode(mode);
    view.walkScale = s;
  } else {
    setMode(mode);
  }
  post("load", { ...loadState, entry: entry?.id ?? "synthetic", device });
}
function syncWalkScale() {
  if (!walkSetup || !mesh) return;
  const want = view.mode === "walk" ? walkSetup.scale : 1;
  if (Math.abs(mesh.scale.x - want) < 1e-6) return;
  const f = want / mesh.scale.x;
  mesh.scale.multiplyScalar(f);
  mesh.position.sub(view.target).multiplyScalar(f).add(view.target);
}

// ---------- HUD + stats ----------
function summary() {
  return { ...loadState, firstSortAt: sortStats.firstAt, stats5s: windowStats(5000), stats30s: windowStats(30000), activeSplats: spark.activeSplats ?? null, lod: cfg.lod, dpr: cfg.dpr, mode: view.mode, cam: camera.position.toArray().map((x) => +x.toFixed(2)), device };
}
function updateHud() {
  if (!cfg.hud) return;
  const w = windowStats(2000) || {};
  const nav = (t) => (t == null ? "–" : fmt(t / 1000, 2) + " s");
  $("hud").textContent = [
    "worlds · splats · " + cfg.day + " · " + (loadState.label || "…"),
    fmt(w.fps, 0) + " fps · " + fmt(w.frame_ms_avg) + " ms (p95 " + fmt(w.frame_ms_p95) + ") · sort " + fmt(w.sort_ms_avg, 0) + " ms × " + fmt(w.sorts_per_s, 1) + "/s",
    (loadState.numSplats / 1e6).toFixed(2) + "M splats (" + ((spark.activeSplats ?? 0) / 1e6).toFixed(2) + "M active) · LoD " + (cfg.lod ? "on" : "off") + " · dpr " + cfg.dpr + " · " + device.drawingBuffer,
    device.gpu + " · " + device.webgl + " · maxTex " + device.maxTextureSize + " · cores " + device.hardwareConcurrency,
    (loadState.bytes ? mb(loadState.bytes) + " · dl " + nav(loadState.fetchMs) + " · " : loadState.genMs != null ? "gen " + nav(loadState.genMs) + " · " : "") + "init " + nav(loadState.initMs) + " · first sorted frame " + nav(sortStats.firstAt),
    device.simulatorHint,
  ].join("\n");
}
setInterval(updateHud, 500);
setInterval(() => { if (loadState.initAt) post("sample", { stats5s: windowStats(5000), activeSplats: spark.activeSplats ?? null, numSplats: loadState.numSplats, mode: view.mode, label: loadState.label }); }, 5000);
window.addEventListener("pagehide", () => post("pagehide", summary()));
$("hud").classList.toggle("off", !cfg.hud);

// ---------- recording ----------
async function recordClip(seconds, name) {
  if (!canvas.captureStream || typeof MediaRecorder === "undefined") { post("error", { message: "no MediaRecorder/captureStream" }); return; }
  const mime = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find((m) => MediaRecorder.isTypeSupported?.(m)) || "";
  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 8e6 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  $("rec").style.display = "block";
  rec.start(1000);
  await sleep(seconds * 1000);
  await new Promise((r) => { rec.onstop = r; rec.stop(); });
  $("rec").style.display = "none";
  const blob = new Blob(chunks, { type: rec.mimeType || mime || "video/webm" });
  const res = await fetch("clip?name=" + encodeURIComponent(name), { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
  post("clip-uploaded", { name, bytes: blob.size, mime: blob.type, status: res.status, stats: windowStats(seconds * 1000) });
}

// ---------- benchmark suite ----------
// ?bench=suite&set=<name>&step=0&run=<tag>&auto=1 walks through SUITES[set], reloading the page between steps so each
// configuration starts from a fresh tab. A step that was running when the page reloaded is reported as a crash.
const SUITES = {
  synthetic: [250e3, 500e3, 1e6, 2e6, 3e6, 4e6, 6e6, 8e6].map((n) => ({ bench: "suite", n })),
  real: [
    { src: "marble" },
    { src: "marble2m" },
    { src: "marble2m", lod: "1" },
    { file: "work/dev-box/dev-box-1280.spz" },
    { file: "work/dev-box/dev-box-1810.spz" },
    { file: "work/dev-box/dev-box-2560.spz" },
    { file: "work/dev-box/dev-box-2560.spz", lod: "1" },
  ],
  dpr: [{ n: 1e6, dpr: "1" }, { n: 1e6, dpr: "2" }, { n: 1e6, dpr: "3" }],
};
function benchUrl(step) {
  const def = SUITES[cfg.set][step];
  const p = new URLSearchParams({ bench: "suite", set: cfg.set, step: String(step), auto: "1", run: qs.get("run") || "r" });
  if (qs.get("dpr") && !def.dpr) p.set("dpr", qs.get("dpr"));
  for (const [k, v] of Object.entries(def)) if (k !== "bench") p.set(k, String(v));
  return "?" + p.toString();
}
async function runBenchStep() {
  const steps = SUITES[cfg.set] ?? [];
  const key = "splatbench:" + (qs.get("run") || "r") + ":" + cfg.set + ":" + cfg.step;
  let prev = null;
  try { prev = JSON.parse(localStorage.getItem(key) || "null"); } catch {}
  const next = () => {
    if (cfg.step + 1 >= steps.length) { post("bench-done", { set: cfg.set }); setLoading("Benchmark finished", 1, ""); loadingEl.classList.remove("done"); return; }
    location.replace(benchUrl(cfg.step + 1));
  };
  if (prev && prev.state === "started" && Date.now() - prev.t < 180000) {
    post("bench-crash", { set: cfg.set, step: cfg.step, def: steps[cfg.step], note: "page reloaded while this step was running (tab killed?)" });
    localStorage.setItem(key, JSON.stringify({ state: "crashed", t: Date.now() }));
    await sleep(1500);
    next();
    return;
  }
  localStorage.setItem(key, JSON.stringify({ state: "started", t: Date.now() }));
  post("bench-start", { set: cfg.set, step: cfg.step, def: steps[cfg.step] });
  await sleep(3000);
  frames.length = 0;
  sortStats.recent.length = 0;
  await sleep(12000);
  post("bench-result", { set: cfg.set, step: cfg.step, def: steps[cfg.step], ...summary(), stats: windowStats(12000) });
  localStorage.setItem(key, JSON.stringify({ state: "done", t: Date.now() }));
  await sleep(500);
  next();
}

// ---------- offline renderer (?offline=frames&fps=24&name=x) ----------
// Steps the auto camera path frame by frame, waits for Spark's sort to settle, and posts each frame as a JPEG,
// so a GPU-less machine can still produce a smooth video (stitch with ffmpeg).
async function renderOffline() {
  renderer.setAnimationLoop(null);
  spark.autoUpdate = false;
  cfg.auto = true;
  const name = cfg.name || (loadState.file || "synthetic").replace(/[^a-z0-9]+/gi, "_");
  const t0 = performance.now();
  for (let i = 0; i < cfg.offline; i++) {
    updateControls(i === 0 ? 0 : 1 / cfg.fps, i / cfg.fps);
    syncWalkScale();
    applyCamera();
    camera.updateMatrixWorld(true);
    for (let k = 0; k < 3; k++) {
      await spark.update({ scene, camera });
      for (let w = 0; w < 500 && spark.sorting; w++) await sleep(10);
      if (!spark.sortDirty) break;
    }
    renderer.render(scene, camera);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    await fetch("frame?name=" + encodeURIComponent(name) + "&i=" + i, { method: "POST", body: blob });
    $("hud").textContent = "offline render " + (i + 1) + "/" + cfg.offline;
  }
  post("offline-done", { name, frames: cfg.offline, seconds: (performance.now() - t0) / 1000 });
}

// ---------- main ----------
let t0 = null;
renderer.setAnimationLoop((time) => {
  const t = time / 1000;
  const dt = lastFrameT == null ? 0 : Math.min(0.1, t - lastFrameT);
  const c0 = performance.now();
  if (lastFrameT != null) {
    frames.push({ t: c0, dt: dt * 1000, cpu: 0 });
    if (frames.length > 4000) frames.splice(0, 1000);
  }
  lastFrameT = t;
  if (t0 == null) t0 = t;
  updateControls(dt, t - t0);
  syncWalkScale();
  applyCamera();
  renderer.render(scene, camera);
  if (frames.length) frames[frames.length - 1].cpu = performance.now() - c0;
  if (sortStats.firstAt && !loadState.firstFrameAt) {
    loadState.firstFrameAt = performance.now();
    loadingEl.classList.add("done");
  }
});

try {
  const manifest = await (await fetch("manifest.json", { cache: "no-store" })).json();
  post("hello", { device, t_module_ms: Math.round(T_MODULE), t_html_ms: Math.round(window.__T_HTML ?? 0) });
  await loadAsset(manifest);
  if (cfg.bench === "suite") runBenchStep();
  if (cfg.offline) { loadingEl.classList.add("done"); await renderOffline(); }
  if (cfg.rec) {
    while (!loadState.firstFrameAt) await sleep(100);
    await sleep(1000);
    recordClip(cfg.rec, (loadState.file || "synthetic").replace(/[^a-z0-9]+/gi, "_") + (cfg.auto ? "-auto" : ""));
  }
  setTimeout(() => post("summary30s", summary()), 30000);
} catch (e) {
  console.error(e);
  fail(String(e?.message ?? e));
}
