import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GroundedSkybox } from "three/addons/objects/GroundedSkybox.js";

const ADDONS = "https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/";
const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const Y = new THREE.Vector3(0, 1, 0);
const FORWARD_YAW = -Math.PI / 2;

const session = {
  id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
  boots: Number(localStorage.getItem("skybox.boots") || 0) + 1,
  prevClean: localStorage.getItem("skybox.clean") !== "0",
};
localStorage.setItem("skybox.boots", String(session.boots));
localStorage.setItem("skybox.clean", "0");

const state = {
  day: params.get("day") || "hackathon",
  mode: params.get("mode") === "stand" ? "stand" : "orbit",
  scale: params.get("scale") === "life" ? "life" : "table",
  hud: params.get("hud") !== "0",
};

const errors = [];
function showError(msg) {
  errors.push(String(msg).slice(0, 300));
  $("err").textContent = errors.slice(-3).join("\n");
  postStats("error");
}
addEventListener("error", (e) => showError(e.message || e.error));
addEventListener("unhandledrejection", (e) => showError(e.reason?.message || e.reason));

const canvas = $("c");
const msaa = params.get("aa") !== "0";
const renderer = new THREE.WebGLRenderer({ canvas, antialias: msaa, powerPreference: "high-performance" });
const dprCap = Number(params.get("dpr")) || 2;
renderer.setPixelRatio(Math.min(devicePixelRatio, dprCap));
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = Number(params.get("exposure")) || 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const gl = renderer.getContext();
const dbg = gl.getExtension("WEBGL_debug_renderer_info");
const glInfo = {
  version: gl.getParameter(gl.VERSION),
  glsl: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
  vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
  renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
  maxCubeMap: gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE),
  maxRenderbuffer: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
  maxSamples: gl.getParameter(gl.MAX_SAMPLES),
  maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
  precision: renderer.capabilities.precision,
  msaa,
};

const scene = new THREE.Scene();
scene.environmentIntensity = Number(params.get("env")) || 1;
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 400);
const pmrem = new THREE.PMREMGenerator(renderer);

const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

const world = new THREE.Group();
scene.add(world);

const occluder = new THREE.Mesh(
  new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
);
occluder.renderOrder = -1;
world.add(occluder);

const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.2, depthWrite: false }));
shadowCatcher.receiveShadow = true;
shadowCatcher.position.y = 0.003;
world.add(shadowCatcher);

function radialAlphaTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgb(255,255,255)");
  grad.addColorStop(0.45, "rgb(190,190,190)");
  grad.addColorStop(1, "rgb(0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const contact = new THREE.Mesh(
  new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: radialAlphaTexture(), transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }),
);
contact.position.y = 0.005;
contact.renderOrder = 1;
world.add(contact);

const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.06, 1, 48), new THREE.MeshStandardMaterial({ color: 0xece5da, roughness: 0.82 }));
pedestal.castShadow = true;
pedestal.receiveShadow = true;
world.add(pedestal);

const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.enablePan = false;
orbit.minDistance = 0.8;
orbit.maxDistance = 5;
orbit.maxPolarAngle = THREE.MathUtils.degToRad(84);
orbit.autoRotate = params.get("spin") !== "0";
orbit.autoRotateSpeed = 0.7;
orbit.addEventListener("start", () => {
  orbit.autoRotate = false;
  interactions++;
});

let manifest, dayCfg, pano, dio, skybox;
let interactions = 0;
let ready = false;
const metrics = { ttff: null, firstRenderMs: null, bootAt: performance.now() };
const player = { pos: new THREE.Vector3(0, 1.6, 0), vel: new THREE.Vector3() };
const look = { yaw: FORWARD_YAW, pitch: -0.1, yawOffset: 0 };
const joy = { x: 0, y: 0 };
const keys = new Set();
const gyro = { active: false, has: false, alpha: 0, beta: 0, gamma: 0, orient: 0, events: 0, permission: "n/a", aligned: false };

const draco = new DRACOLoader().setDecoderPath(ADDONS + "libs/draco/gltf/");
const gltfLoader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
const texLoader = new THREE.TextureLoader();
const assetUrl = (file) => "assets/" + file;

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function analyzePano(ctx, W, H) {
  const { data } = ctx.getImageData(0, 0, W, H);
  const GW = 64, GH = 32, cw = W / GW, ch = H / GH;
  const lum = new Float32Array(GW * GH);
  const col = new Float32Array(GW * GH * 3);
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = Math.floor(gy * ch); y < (gy + 1) * ch; y += 2) {
        for (let x = Math.floor(gx * cw); x < (gx + 1) * cw; x += 2) {
          const i = (y * W + x) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
      }
      const k = gy * GW + gx;
      col[k * 3] = r / n / 255; col[k * 3 + 1] = g / n / 255; col[k * 3 + 2] = b / n / 255;
      lum[k] = 0.2126 * srgbToLinear(col[k * 3]) + 0.7152 * srgbToLinear(col[k * 3 + 1]) + 0.0722 * srgbToLinear(col[k * 3 + 2]);
    }
  }
  let mean = 0;
  for (const v of lum) mean += v;
  mean /= lum.length;
  let best = -1, bx = 0, by = 1;
  for (let gy = 1; gy < GH * 0.55; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += lum[(gy + dy) * GW + ((gx + dx + GW) % GW)];
      if (s > best) { best = s; bx = gx; by = gy; }
    }
  }
  const peak = best / 9;
  const u = (bx + 0.5) / GW, v = (by + 0.5) / GH;
  const theta = 2 * Math.PI * u - Math.PI;
  const lat = Math.max(Math.PI * (0.5 - v), THREE.MathUtils.degToRad(42));
  const sunDir = new THREE.Vector3(Math.cos(lat) * Math.cos(theta), Math.sin(lat), Math.cos(lat) * Math.sin(theta)).normalize();
  const k = by * GW + bx;
  const sunColor = new THREE.Color().setRGB(col[k * 3], col[k * 3 + 1], col[k * 3 + 2], THREE.SRGBColorSpace);
  const hsl = sunColor.getHSL({});
  sunColor.setHSL(hsl.h, Math.min(hsl.s, 0.45), 0.75);
  let seam = 0, adj = 0;
  for (let y = Math.floor(H * 0.1); y < H * 0.9; y++) {
    const a = y * W * 4, b = (y * W + W - 1) * 4, c = (y * W + (W >> 1)) * 4;
    for (let q = 0; q < 3; q++) {
      seam += Math.abs(data[a + q] - data[b + q]);
      adj += Math.abs(data[c + q] - data[c + 4 + q]);
    }
  }
  return { sunDir, sunColor, peak, mean, contrast: peak / Math.max(mean, 1e-4), seamRatio: seam / Math.max(adj, 1), sunUV: [u, v] };
}

async function loadPano(p) {
  const t0 = performance.now();
  const res = await fetch(assetUrl(p.file));
  if (!res.ok) throw new Error("pano " + p.file + ": HTTP " + res.status + " (run fetch-assets.mjs)");
  const blob = await res.blob();
  const t1 = performance.now();
  const objectUrl = URL.createObjectURL(blob);
  let tex;
  try {
    tex = await texLoader.loadAsync(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  const t2 = performance.now();
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const small = document.createElement("canvas");
  small.width = 1024;
  small.height = 512;
  const ctx = small.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(tex.image, 0, 0, small.width, small.height);
  const analysis = analyzePano(ctx, small.width, small.height);
  const envSrc = new THREE.CanvasTexture(small);
  envSrc.colorSpace = THREE.SRGBColorSpace;
  envSrc.mapping = THREE.EquirectangularReflectionMapping;
  const envRT = pmrem.fromEquirectangular(envSrc);
  envSrc.dispose();
  const t3 = performance.now();
  return { meta: p, tex, envRT, analysis, bytes: blob.size, width: tex.image.width, height: tex.image.height, ms: { fetch: t1 - t0, decode: t2 - t1, pmrem: t3 - t2 } };
}

function estimateTop(holder, footprint, height) {
  holder.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const hits = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r = footprint * 0.5 * (i % 2 ? 0.45 : 0.62);
    ray.set(new THREE.Vector3(Math.cos(a) * r, height + 1, Math.sin(a) * r), new THREE.Vector3(0, -1, 0));
    const h = ray.intersectObject(holder, true)[0];
    if (h) hits.push(h.point.y);
  }
  hits.sort((a, b) => a - b);
  return hits.length ? hits[Math.floor(hits.length * 0.4)] : height * 0.3;
}

async function loadDiorama(d) {
  const t0 = performance.now();
  const res = await fetch(assetUrl(d.file));
  if (!res.ok) throw new Error("diorama " + d.file + ": HTTP " + res.status + " (run fetch-assets.mjs)");
  const buf = await res.arrayBuffer();
  const t1 = performance.now();
  const gltf = await gltfLoader.parseAsync(buf, "");
  const t2 = performance.now();
  const model = gltf.scene;
  const stats = { meshes: 0, tris: 0, verts: 0, textures: [], textureBytes: 0 };
  const seen = new Set();
  model.traverse((o) => {
    if (!o.isMesh) return;
    stats.meshes++;
    o.castShadow = true;
    o.receiveShadow = true;
    const g = o.geometry;
    stats.verts += g.attributes.position.count;
    stats.tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    for (const m of [].concat(o.material)) {
      for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap"]) {
        const t = m[key];
        if (!t || !t.image || seen.has(t)) continue;
        seen.add(t);
        t.anisotropy = 4;
        stats.textures.push(key + " " + t.image.width + "x" + t.image.height);
        stats.textureBytes += t.image.width * t.image.height * 4 * 1.33;
      }
    }
  });
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -box.min.y, -center.z);
  const holder = new THREE.Group();
  holder.add(model);
  const footprint = Math.max(size.x, size.z);
  let mixer = null;
  if (gltf.animations.length) {
    mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) mixer.clipAction(clip).play();
  }
  const topY = estimateTop(holder, footprint, size.y);
  world.add(holder);
  return { meta: d, holder, footprint, height: size.y, topY, mixer, stats, bytes: buf.byteLength, ms: { fetch: t1 - t0, parse: t2 - t1 } };
}

function dayNumber(key, fallback) {
  const v = params.get(key);
  return v !== null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : (dayCfg[key] ?? fallback);
}

function buildSkybox() {
  if (skybox) {
    scene.remove(skybox);
    skybox.geometry.dispose();
    skybox.material.dispose();
  }
  const height = dayNumber("pano_height", 1.6);
  const radius = dayNumber("pano_radius", 20);
  skybox = new GroundedSkybox(pano.tex, height, radius, 96);
  skybox.material.toneMapped = false;
  skybox.material.fog = false;
  skybox.position.y = height - 0.01;
  skybox.renderOrder = -2;
  scene.add(skybox);
  const floorR = height / Math.tan(Math.asin(Math.min(0.99, (1.5 * height) / radius)));
  occluder.scale.setScalar(Math.min(floorR, radius * 0.95));
  camera.far = radius * 3;
  camera.updateProjectionMatrix();
  player.pos.y = height;
  return { height, radius, floorR };
}

function applyPlacement() {
  if (!dio || !pano) return;
  pedestal.visible = false;
  contact.visible = true;
  const pos = new THREE.Vector3();
  let scale, shadowR;
  if (state.mode === "orbit") {
    scale = 1.2 / dio.footprint;
    pos.set(0, 0, 0);
    contact.scale.setScalar(0.95);
    contact.position.set(0, 0.005, 0);
    shadowR = 1.6;
  } else if (state.scale === "table") {
    const fp = 0.85, ped = 0.8, ahead = 2.3;
    scale = fp / dio.footprint;
    pos.set(ahead, ped, 0);
    pedestal.visible = true;
    pedestal.scale.set(fp * 0.5, ped, fp * 0.5);
    pedestal.position.set(ahead, ped / 2, 0);
    contact.scale.setScalar(0.75);
    contact.position.set(ahead, 0.005, 0);
    shadowR = 2.2;
  } else {
    const R = dayCfg.island_radius_m || 6;
    scale = (2 * R) / dio.footprint;
    pos.set(R + 1.5, -dio.topY * scale, 0);
    contact.visible = false;
    shadowR = R * 1.35;
  }
  dio.holder.scale.setScalar(scale);
  dio.holder.position.copy(pos);
  shadowCatcher.scale.setScalar(shadowR * 2.4);
  shadowCatcher.position.set(pos.x, 0.003, pos.z);
  const a = pano.analysis;
  const target = new THREE.Vector3(pos.x, Math.max(0, pos.y), pos.z);
  sun.target.position.copy(target);
  sun.position.copy(target).addScaledVector(a.sunDir, shadowR * 4);
  sun.color.copy(a.sunColor);
  sun.intensity = Number(params.get("sun")) || THREE.MathUtils.clamp(0.6 + 0.35 * (a.contrast - 1), 0.7, 2.6);
  const sc = sun.shadow.camera;
  sc.left = -shadowR; sc.right = shadowR; sc.top = shadowR; sc.bottom = -shadowR;
  sc.near = 0.1; sc.far = shadowR * 10;
  sc.updateProjectionMatrix();
  sun.shadow.needsUpdate = true;
}

function setMode(mode, opts = {}) {
  state.mode = mode;
  orbit.enabled = mode === "orbit";
  const h = dayNumber("pano_height", 1.6);
  if (mode === "orbit") {
    camera.fov = 55;
    camera.aspect = innerWidth / innerHeight;
    const d = orbitFitDistance();
    orbit.target.set(0, 0.3, 0);
    orbit.maxDistance = d * 1.8;
    const el = THREE.MathUtils.degToRad(22);
    camera.position.set(-Math.cos(el) * d, 0.3 + Math.sin(el) * d, 0.12 * d);
    orbit.update();
  } else {
    camera.fov = 70;
    if (!opts.keepPose) {
      player.pos.set(0, h, 0);
      look.yaw = FORWARD_YAW;
      look.pitch = state.scale === "table" ? -0.28 : -0.12;
    }
  }
  camera.updateProjectionMatrix();
  applyPlacement();
  updateUi();
  setTimeout(() => postStats("mode"), 3000);
}

function orbitFitDistance() {
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  return THREE.MathUtils.clamp(0.78 / Math.sin(Math.min(vfov, hfov) / 2), 1.6, 6.5);
}

function setScale(scale) {
  state.scale = scale;
  if (state.mode === "stand") {
    player.pos.set(0, dayNumber("pano_height", 1.6), 0);
    look.yaw = FORWARD_YAW;
    look.pitch = scale === "table" ? -0.28 : -0.12;
  }
  applyPlacement();
  updateUi();
}

const zee = new THREE.Vector3(0, 0, 1);
const qScreen = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const qTmp = new THREE.Quaternion();
const qYaw = new THREE.Quaternion();
const eul = new THREE.Euler();
function deviceQuaternion(out) {
  eul.set(gyro.beta, gyro.alpha, -gyro.gamma, "YXZ");
  out.setFromEuler(eul);
  out.multiply(qScreen);
  out.multiply(qTmp.setFromAxisAngle(zee, -gyro.orient));
  return out;
}
function onOrientation(e) {
  if (e.alpha === null) return;
  gyro.events++;
  gyro.has = true;
  gyro.alpha = THREE.MathUtils.degToRad(e.alpha);
  gyro.beta = THREE.MathUtils.degToRad(e.beta);
  gyro.gamma = THREE.MathUtils.degToRad(e.gamma);
  gyro.orient = THREE.MathUtils.degToRad(screen.orientation?.angle ?? window.orientation ?? 0);
}
async function toggleGyro() {
  if (gyro.active) {
    gyro.active = false;
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
    look.yaw = e.y;
    look.pitch = e.x;
    updateUi();
    return;
  }
  try {
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      gyro.permission = await DeviceOrientationEvent.requestPermission();
      if (gyro.permission !== "granted") throw new Error("motion permission " + gyro.permission);
    } else {
      gyro.permission = "implicit";
    }
    addEventListener("deviceorientation", onOrientation);
    gyro.active = true;
    gyro.aligned = false;
    if (state.mode !== "stand") setMode("stand");
  } catch (err) {
    showError("gyro: " + (err.message || err));
  }
  updateUi();
}

const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
function updateStand(dt) {
  if (gyro.active && gyro.has) {
    deviceQuaternion(qTmp.identity());
    if (!gyro.aligned) {
      const e = new THREE.Euler().setFromQuaternion(qTmp, "YXZ");
      look.yawOffset = look.yaw - e.y;
      gyro.aligned = true;
    }
    camera.quaternion.copy(qTmp).premultiply(qYaw.setFromAxisAngle(Y, look.yawOffset));
  } else {
    camera.rotation.set(look.pitch, look.yaw, 0, "YXZ");
  }
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  fwd.normalize();
  right.crossVectors(fwd, Y).normalize();
  let f = -joy.y, s = joy.x;
  if (keys.has("KeyW") || keys.has("ArrowUp")) f += 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) f -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) s += 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) s -= 1;
  const speed = state.scale === "life" ? 2.6 : 1.5;
  player.vel.set(0, 0, 0).addScaledVector(fwd, f).addScaledVector(right, s);
  if (player.vel.lengthSq() > 1) player.vel.normalize();
  player.pos.addScaledVector(player.vel, speed * dt);
  const R = state.scale === "life" ? (dayCfg.island_radius_m || 6) + 2 : dayNumber("walk_radius", 6);
  const cx = state.scale === "life" ? (dayCfg.island_radius_m || 6) + 1.5 : 0;
  const dx = player.pos.x - cx, dz = player.pos.z;
  const r = Math.hypot(dx, dz);
  if (r > R) {
    player.pos.x = cx + (dx * R) / r;
    player.pos.z = (dz * R) / r;
  }
  camera.position.copy(player.pos);
}

const joyEl = $("joy"), knobEl = $("knob");
const pointers = new Map();
function joyHome() {
  return { x: Math.max(80, innerWidth * 0.2), y: innerHeight - 190 };
}
function placeJoy(x, y) {
  joyEl.style.left = x + "px";
  joyEl.style.top = y + "px";
}
function setKnob(dx, dy) {
  knobEl.style.transform = "translate(" + dx + "px," + dy + "px)";
}
canvas.addEventListener("pointerdown", (e) => {
  if (state.mode !== "stand") return;
  canvas.setPointerCapture(e.pointerId);
  const hasJoy = [...pointers.values()].some((p) => p.kind === "joy");
  const isJoy = !hasJoy && e.clientX < innerWidth * 0.5 && e.clientY > innerHeight * 0.5;
  pointers.set(e.pointerId, { kind: isJoy ? "joy" : "look", x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY });
  if (isJoy) {
    placeJoy(e.clientX, e.clientY);
    setKnob(0, 0);
    joyEl.className = "live";
  }
  interactions++;
  stopTour();
});
canvas.addEventListener("pointermove", (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  if (p.kind === "look") {
    const k = (0.0045 * camera.fov) / 70;
    const dx = (e.clientX - p.x) * k, dy = (e.clientY - p.y) * k;
    if (gyro.active && gyro.has) look.yawOffset += dx;
    else {
      look.yaw += dx;
      look.pitch = THREE.MathUtils.clamp(look.pitch + dy, -1.45, 1.45);
    }
  } else {
    const dx = e.clientX - p.x0, dy = e.clientY - p.y0;
    const m = Math.hypot(dx, dy), max = 52, s = m > max ? max / m : 1;
    joy.x = (dx * s) / max;
    joy.y = (dy * s) / max;
    setKnob(dx * s, dy * s);
  }
  p.x = e.clientX;
  p.y = e.clientY;
});
function endPointer(e) {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  pointers.delete(e.pointerId);
  if (p.kind === "joy") {
    joy.x = joy.y = 0;
    setKnob(0, 0);
    const h = joyHome();
    placeJoy(h.x, h.y);
    joyEl.className = state.mode === "stand" ? "hint" : "";
  }
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
addEventListener("keydown", (e) => keys.add(e.code));
addEventListener("keyup", (e) => keys.delete(e.code));
document.addEventListener("gesturestart", (e) => e.preventDefault());

function onResize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  if (!pointers.size) {
    const h = joyHome();
    placeJoy(h.x, h.y);
  }
}
addEventListener("resize", onResize);
visualViewport?.addEventListener("resize", onResize);

const frames = [];
let lastFrame = performance.now();
let longFrames = 0;
function frameStats(windowMs) {
  const now = performance.now();
  const recent = frames.filter((f) => now - f.t <= windowMs).map((f) => f.dt);
  if (!recent.length) return { fps: 0, avg: 0, p50: 0, p95: 0, max: 0, n: 0 };
  const sorted = [...recent].sort((a, b) => a - b);
  const sum = recent.reduce((s, v) => s + v, 0);
  return {
    fps: +((recent.length * 1000) / Math.max(sum, 1)).toFixed(1),
    avg: +(sum / recent.length).toFixed(2),
    p50: +sorted[Math.floor(sorted.length * 0.5)].toFixed(2),
    p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
    max: +sorted[sorted.length - 1].toFixed(2),
    n: recent.length,
  };
}

function estGpuMB() {
  let b = 0;
  if (pano) {
    b += Math.min(pano.width, glInfo.maxTexture) * Math.min(pano.height, glInfo.maxTexture / 2) * 4 * 1.33;
    b += pano.envRT.width * pano.envRT.height * 8;
  }
  if (dio) b += dio.stats.textureBytes;
  b += sun.shadow.mapSize.x * sun.shadow.mapSize.y * 4;
  const px = renderer.domElement.width * renderer.domElement.height;
  b += px * 8 * (msaa ? 4 : 1) + px * 4;
  return b / 1e6;
}

let tour = null;
function startTour() {
  tour = { t0: performance.now(), phase: -1 };
  setScale("table");
  setMode("orbit");
  orbit.autoRotate = true;
  orbit.autoRotateSpeed = 4;
  updateUi();
}
function stopTour() {
  if (!tour) return;
  tour = null;
  orbit.autoRotateSpeed = 0.7;
  updateUi();
}
function updateTour(now) {
  const t = (now - tour.t0) / 1000;
  const h = dayNumber("pano_height", 1.6);
  if (t < 7) return;
  if (tour.phase < 1) {
    tour.phase = 1;
    orbit.autoRotate = false;
    state.scale = "table";
    setMode("stand");
  }
  if (t < 15) {
    look.yaw = FORWARD_YAW + ((t - 7) / 8) * Math.PI * 2;
    look.pitch = -0.08 - 0.1 * Math.sin(((t - 7) / 8) * Math.PI);
    return;
  }
  if (t < 19) {
    look.yaw = FORWARD_YAW;
    look.pitch = -0.32;
    player.pos.set(Math.min(1.2, ((t - 15) / 4) * 1.2), h, 0);
    return;
  }
  if (tour.phase < 2) {
    tour.phase = 2;
    setScale("life");
  }
  if (t < 28) {
    const k = (t - 19) / 9;
    look.yaw = FORWARD_YAW + Math.sin(k * Math.PI * 2) * 0.5;
    look.pitch = -0.1;
    player.pos.set(k * ((dayCfg.island_radius_m || 6) + 1.5), h, Math.sin(k * Math.PI) * 1.5);
    return;
  }
  stopTour();
  setScale("table");
  setMode("orbit");
}

let recording = null;
async function record(seconds) {
  if (recording) return;
  if (!canvas.captureStream || typeof MediaRecorder === "undefined") {
    showError("recording not supported here");
    return;
  }
  const stream = canvas.captureStream(30);
  const types = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported?.(t)) || "";
  const rec = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 8_000_000 } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  recording = { until: performance.now() + seconds * 1000, mimeType: rec.mimeType || mimeType };
  updateUi();
  rec.start(1000);
  setTimeout(() => rec.state !== "inactive" && rec.stop(), seconds * 1000);
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  const blob = new Blob(chunks, { type: recording.mimeType || "video/webm" });
  recording = null;
  updateUi();
  const name = state.day + "-" + (pano?.meta.id ?? "pano") + "-" + state.mode;
  const res = await fetch("clip?name=" + encodeURIComponent(name), { method: "POST", headers: { "content-type": blob.type }, body: blob });
  const out = await res.json().catch(() => ({}));
  $("err").textContent = "clip uploaded: " + (out.file || res.status) + " " + ((blob.size / 1e6).toFixed(1) + " MB");
}

function snapshot(reason) {
  const f1 = frameStats(1000), f5 = frameStats(5000);
  const info = renderer.info;
  return {
    session: session.id,
    reason,
    boots: session.boots,
    prev_clean_exit: session.prevClean,
    t_s: +((performance.now() - metrics.bootAt) / 1000).toFixed(1),
    day: state.day,
    pano: pano?.meta.id ?? null,
    mode: state.mode,
    scale: state.scale,
    tour: !!tour,
    recording: !!recording,
    gyro: { active: gyro.active, events: gyro.events, permission: gyro.permission },
    interactions,
    fps_1s: f1.fps,
    frame_ms_5s: f5,
    long_frames: longFrames,
    dpr: renderer.getPixelRatio(),
    device_dpr: devicePixelRatio,
    canvas_px: [renderer.domElement.width, renderer.domElement.height],
    viewport: [innerWidth, innerHeight],
    screen: [screen.width, screen.height],
    gl: glInfo,
    render: { calls: info.render.calls, triangles: info.render.triangles, textures: info.memory.textures, geometries: info.memory.geometries },
    est_gpu_mb: +estGpuMB().toFixed(1),
    pano_load: pano ? { file: pano.meta.file, bytes: pano.bytes, w: pano.width, h: pano.height, ms: mapRound(pano.ms), env_rt: [pano.envRT.width, pano.envRT.height], seam_ratio: +pano.analysis.seamRatio.toFixed(2), sun_contrast: +pano.analysis.contrast.toFixed(2), first_render_ms: pano.firstRenderMs ?? null } : null,
    glb_load: dio ? { file: dio.meta.file, bytes: dio.bytes, ms: mapRound(dio.ms), tris: dio.stats.tris, verts: dio.stats.verts, meshes: dio.stats.meshes, textures: dio.stats.textures } : null,
    ttff_ms: metrics.ttff,
    compile_ms: metrics.compileMs ?? null,
    nav: { hw: navigator.hardwareConcurrency ?? null, mem: navigator.deviceMemory ?? null, touch: navigator.maxTouchPoints ?? null, platform: navigator.platform ?? null, lang: navigator.language },
    errors: errors.slice(-5),
  };
}
function mapRound(o) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
}
function postStats(reason, beacon = false) {
  try {
    const body = JSON.stringify(snapshot(reason));
    if (beacon && navigator.sendBeacon) navigator.sendBeacon("stats", new Blob([body], { type: "application/json" }));
    else fetch("stats", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {}
}
addEventListener("pagehide", () => {
  localStorage.setItem("skybox.clean", "1");
  postStats("pagehide", true);
});

const kb = (b) => (b / 1e6).toFixed(2) + " MB";
function updateHud() {
  if (!state.hud) return;
  const f1 = frameStats(1000), f5 = frameStats(5000);
  const info = renderer.info;
  const lines = [
    "FPS " + f1.fps.toFixed(1) + "  frame " + f5.avg.toFixed(1) + " ms  p95 " + f5.p95.toFixed(1) + "  max " + f5.max.toFixed(0),
    String(glInfo.renderer).slice(0, 34) + " · " + String(glInfo.version).replace("WebGL ", "WebGL").slice(0, 12),
    "maxTex " + glInfo.maxTexture + " cube " + glInfo.maxCubeMap + " · MSAA " + (msaa ? "on" : "off"),
    "DPR " + renderer.getPixelRatio().toFixed(1) + "/" + devicePixelRatio + " · " + renderer.domElement.width + "x" + renderer.domElement.height,
    "calls " + info.render.calls + " · tris " + (info.render.triangles / 1000).toFixed(1) + "k · tex " + info.memory.textures,
  ];
  if (pano) lines.push("pano " + pano.meta.id + " " + pano.width + "x" + pano.height + " " + kb(pano.bytes), "  fetch " + Math.round(pano.ms.fetch) + " dec " + Math.round(pano.ms.decode) + " pmrem " + Math.round(pano.ms.pmrem) + " up " + Math.round(pano.firstRenderMs ?? 0) + " ms");
  if (dio) lines.push("glb " + kb(dio.bytes) + " · " + (dio.stats.tris / 1000).toFixed(0) + "k tris", "  fetch " + Math.round(dio.ms.fetch) + " parse " + Math.round(dio.ms.parse) + " ms · " + (dio.stats.textures[0] || "no tex"));
  lines.push("TTFF " + (metrics.ttff ? (metrics.ttff / 1000).toFixed(2) + " s" : "…") + " · compile " + (metrics.compileMs ?? "…") + " ms · GPU~" + estGpuMB().toFixed(0) + " MB");
  lines.push(state.mode + (state.mode === "stand" ? "/" + state.scale : "") + " · gyro " + (gyro.active ? "on " + gyro.events : "off") + " · boot " + session.boots + (recording ? " · REC" : ""));
  $("hud").textContent = lines.join("\n");
}

function updateUi() {
  for (const b of document.querySelectorAll("#modes button")) b.classList.toggle("on", b.dataset.mode === state.mode);
  for (const b of document.querySelectorAll("#scales button")) {
    b.classList.toggle("on", b.dataset.scale === state.scale);
    b.disabled = state.mode !== "stand";
  }
  $("gyro").classList.toggle("on", gyro.active);
  $("tour").classList.toggle("on", !!tour);
  $("rec").classList.toggle("on", !!recording);
  $("rec").textContent = recording ? "● " + Math.max(0, Math.ceil((recording.until - performance.now()) / 1000)) : "Rec";
  $("hudbtn").classList.toggle("on", state.hud);
  $("hud").classList.toggle("off", !state.hud);
  if (!pointers.size) joyEl.className = state.mode === "stand" ? "hint" : "";
}

function buildDayLinks() {
  const days = Object.keys(manifest.days).filter((d) => !manifest.days[d].hidden);
  $("days").innerHTML = "";
  for (const d of days) {
    const a = document.createElement("a");
    const q = new URLSearchParams(location.search);
    q.set("day", d);
    q.delete("pano");
    a.href = "?" + q.toString();
    a.textContent = manifest.days[d].short || d;
    if (d === state.day) a.className = "on";
    $("days").appendChild(a);
  }
  const sel = $("pano");
  sel.innerHTML = "";
  for (const p of dayCfg.panos) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.label + (p.width ? " · " + p.width + "×" + p.height : "");
    sel.appendChild(o);
  }
}

async function switchPano(id) {
  const meta = dayCfg.panos.find((p) => p.id === id) || dayCfg.panos[0];
  $("pano").value = meta.id;
  $("loading").classList.remove("done");
  $("loading").textContent = "Loading " + meta.label + "…";
  const next = await loadPano(meta);
  if (pano) {
    pano.tex.dispose();
    pano.envRT.dispose();
  }
  pano = next;
  scene.environment = pano.envRT.texture;
  const sky = buildSkybox();
  pano.sky = sky;
  pano.firstRenderPending = true;
  applyPlacement();
  if (state.mode === "stand") camera.position.copy(player.pos);
  $("loading").classList.add("done");
  const q = new URLSearchParams(location.search);
  q.set("pano", meta.id);
  history.replaceState(null, "", "?" + q.toString());
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = now - lastFrame;
  lastFrame = now;
  frames.push({ t: now, dt });
  if (frames.length > 900) frames.splice(0, frames.length - 900);
  if (dt > 50) longFrames++;
  if (!ready || !pano || !dio) return;
  if (dio.mixer) dio.mixer.update(Math.min(dt, 100) / 1000);
  if (tour) updateTour(now);
  if (state.mode === "orbit") orbit.update();
  else updateStand(Math.min(dt, 100) / 1000);
  const r0 = performance.now();
  renderer.render(scene, camera);
  const r1 = performance.now();
  if (pano.firstRenderPending) {
    pano.firstRenderPending = false;
    pano.firstRenderMs = r1 - r0;
    if (metrics.ttff === null) {
      metrics.ttff = Math.round(r1 - metrics.bootAt);
      setTimeout(() => postStats("loaded"), 1500);
    }
  }
  if (now - (frame.lastHud || 0) > 250) {
    frame.lastHud = now;
    updateHud();
    if (recording) updateUi();
  }
}

async function main() {
  const res = await fetch("manifest.json", { cache: "no-cache" });
  manifest = await res.json();
  dayCfg = manifest.days[state.day];
  if (!dayCfg) throw new Error("unknown day " + state.day + "; try " + Object.keys(manifest.days).join(", "));
  $("title").textContent = dayCfg.title || state.day;
  buildDayLinks();
  $("loading").textContent = "Loading " + (dayCfg.title || state.day) + "…";
  const wanted = params.get("pano") || dayCfg.default_pano || dayCfg.panos[0].id;
  const [_, d] = await Promise.all([switchPano(wanted), loadDiorama(dayCfg.diorama)]);
  dio = d;
  setMode(state.mode);
  $("loading").classList.remove("done");
  $("loading").textContent = "Compiling shaders…";
  const c0 = performance.now();
  await renderer.compileAsync(scene, camera);
  metrics.compileMs = Math.round(performance.now() - c0);
  $("loading").classList.add("done");
  ready = true;
  const h = joyHome();
  placeJoy(h.x, h.y);
  updateUi();
  setInterval(() => postStats("tick"), 5000);
  if (params.get("tour") === "1") startTour();
  const recSeconds = Number(params.get("rec"));
  if (recSeconds > 0) setTimeout(() => record(Math.min(recSeconds, 40)), 600);
}

for (const b of document.querySelectorAll("#modes button")) b.addEventListener("click", () => { stopTour(); setMode(b.dataset.mode); });
for (const b of document.querySelectorAll("#scales button")) b.addEventListener("click", () => { stopTour(); setScale(b.dataset.scale); });
$("gyro").addEventListener("click", toggleGyro);
$("tour").addEventListener("click", () => (tour ? stopTour() : startTour()));
$("rec").addEventListener("click", () => record(Number(params.get("recsec")) || 15));
$("hudbtn").addEventListener("click", () => { state.hud = !state.hud; updateUi(); });
$("pano").addEventListener("change", (e) => switchPano(e.target.value).catch((err) => showError(err.message)));

requestAnimationFrame(frame);
main().catch((e) => {
  $("loading").textContent = "Failed: " + (e.message || e);
  showError(e.message || e);
});
