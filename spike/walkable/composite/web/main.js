import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GroundedSkybox } from "three/addons/objects/GroundedSkybox.js";
import { computeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
import { buildGround, describeGround, lightPreset, parsePalette, parsePlace, layoutWorld, scatterDecor, hashString } from "./world.js";
import { Input, Player, makeAvatar, makeTour } from "./controls.js";
import { Perf, glInfo, gpuEstimate, recordCanvas } from "./hud.js";

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const qs = new URLSearchParams(location.search);
const day = qs.get("day") || "hackathon";
const label = qs.get("label") || "";
const quality = qs.get("q") || "high";
const $ = (id) => document.getElementById(id);
const session = Math.random().toString(36).slice(2, 10);
const loads = Number(sessionStorage.getItem("composite-loads") || 0) + 1;
sessionStorage.setItem("composite-loads", String(loads));
const errors = [];
window.addEventListener("error", (e) => errors.push(String(e.message).slice(0, 300)));
window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason?.message ?? e.reason).slice(0, 300)));

const marks = { script_start_ms: Math.round(performance.now()) };
const assetStats = [];
const parseMs = {};
let expectedAssets = 1;
let statsPosted = 0;
let statsStatus = "";

function progress(text) {
  const bytes = assetStats.reduce((s, a) => s + a.bytes, 0);
  $("bar").firstElementChild.style.width = Math.round((100 * assetStats.length) / Math.max(1, expectedAssets)) + "%";
  $("loadinfo").textContent = (text ? text + "\n" : "") + assetStats.length + "/" + expectedAssets + " files · " + (bytes / 1048576).toFixed(1) + " MB";
}

async function fetchAsset(file) {
  const url = "assets/" + file;
  const t = performance.now();
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ": HTTP " + res.status + " (run fetch-assets.mjs?)");
  const buf = await res.arrayBuffer();
  const rt = performance.getEntriesByName(new URL(url, location.href).href).at(-1);
  assetStats.push({ file, bytes: buf.byteLength, encoded: rt?.encodedBodySize || null, transfer: rt?.transferSize || null, ms: Math.round(performance.now() - t) });
  progress();
  return buf;
}

const canvas = $("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== "low", powerPreference: "high-performance" });
const dprCap = Number(qs.get("dpr") || (quality === "low" ? 1 : 2));
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, dprCap));
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = qs.has("shadows") ? qs.get("shadows") !== "0" : quality !== "low";
renderer.shadowMap.type = THREE.PCFShadowMap;
const gl = glInfo(renderer);

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);
gltfLoader.setKTX2Loader(new KTX2Loader().setTranscoderPath("https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/libs/basis/").detectSupport(renderer));

function horizonColor(image) {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 32;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, 64, 32);
  const d = ctx.getImageData(0, 14, 64, 3).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i];
    g += d[i + 1];
    b += d[i + 2];
  }
  const n = d.length / 4;
  return new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
}

const ray = new THREE.Raycaster();
ray.firstHitOnly = true;
const DOWN = new THREE.Vector3(0, -1, 0);
const tmpOrigin = new THREE.Vector3();
const tmpN = new THREE.Vector3();
function raycastDown(object, x, z, fromY = 60) {
  ray.set(tmpOrigin.set(x, fromY, z), DOWN);
  ray.far = 200;
  const hit = ray.intersectObject(object, true)[0];
  if (!hit) return null;
  const ny = hit.face ? Math.abs(tmpN.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).y) : 1;
  return { y: hit.point.y, normalY: ny };
}

function makeTemplate(root, sizeM, frontYawDeg) {
  const inner = new THREE.Group();
  inner.add(root);
  inner.rotation.y = THREE.MathUtils.degToRad(frontYawDeg || 0);
  const holder = new THREE.Group();
  holder.add(inner);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder, true);
  const size = box.getSize(new THREE.Vector3());
  const s = sizeM / Math.max(size.x, size.y, size.z, 1e-6);
  inner.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  holder.scale.setScalar(s);
  holder.updateMatrixWorld(true);
  return { object: holder, size: size.multiplyScalar(s) };
}

async function textureFrom(buf, type) {
  const url = URL.createObjectURL(new Blob([buf], { type }));
  const tex = await new THREE.TextureLoader().loadAsync(url);
  URL.revokeObjectURL(url);
  return tex;
}

async function pixelsFrom(buf) {
  const bmp = await createImageBitmap(new Blob([buf], { type: "image/png" }));
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return { w: bmp.width, h: bmp.height, data: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
}

const cardMode = qs.get("cards") || "relief";
async function makeCardTemplate(card, sizeM) {
  const [imgBuf, depthBuf] = await Promise.all([fetchAsset(card.image), card.depth && cardMode === "relief" ? fetchAsset(card.depth) : null]);
  const map = await textureFrom(imgBuf, "image/png");
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const aspect = card.width / card.height;
  const w = aspect >= 1 ? sizeM : sizeM * aspect;
  const h = aspect >= 1 ? sizeM / aspect : sizeM;
  const relief = depthBuf ? Math.min(0.55, Math.max(0.08, Math.min(w, h) * Number(qs.get("relief") || 0.28))) : 0;
  const segX = relief ? Math.max(12, Math.round(72 * Math.min(1, aspect))) : 1;
  const segY = relief ? Math.max(12, Math.round(72 * Math.min(1, 1 / aspect))) : 1;
  const geo = new THREE.PlaneGeometry(w, h, segX, segY).translate(0, h / 2, 0);
  if (relief) {
    const d = await pixelsFrom(depthBuf);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = Math.min(d.w - 1, Math.round(uv.getX(i) * (d.w - 1)));
      const y = Math.min(d.h - 1, Math.round((1 - uv.getY(i)) * (d.h - 1)));
      pos.setZ(i, (d.data[(y * d.w + x) * 4] / 255) * relief);
    }
    geo.computeVertexNormals();
  }
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: Number(qs.get("cardGlow") || 0.22) });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });
  const holder = new THREE.Group();
  holder.add(mesh);
  holder.userData.card = true;
  if (cardMode === "billboard") holder.userData.billboard = true;
  return { object: holder, size: new THREE.Vector3(w, h, Math.max(0.12, relief)), card: true, topFrac: card.top_frac ?? 0.6 };
}

async function makeSpriteTemplate(file, sizeM) {
  const buf = await fetchAsset(file);
  const url = URL.createObjectURL(new Blob([buf], { type: "image/png" }));
  const map = await new THREE.TextureLoader().loadAsync(url);
  URL.revokeObjectURL(url);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const aspect = map.image.width / map.image.height;
  const h = aspect > 1 ? sizeM / aspect : sizeM;
  const w = h * aspect;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0), new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }));
  mesh.castShadow = true;
  const holder = new THREE.Group();
  holder.add(mesh);
  holder.userData.billboard = true;
  return { object: holder, size: new THREE.Vector3(w, h, w * 0.6) };
}

function prepModel(root, needsBvh) {
  root.traverse((m) => {
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if ("metalness" in mat) {
        mat.metalness = Math.min(mat.metalness ?? 0, 0.15);
        mat.roughness = Math.max(mat.roughness ?? 1, 0.55);
      }
      mat.envMapIntensity = 0.9;
    }
    if (needsBvh) m.geometry.computeBoundsTree();
  });
}

let world, set, setName, spec;
let scene, camera, player, avatar, ground, placed = [], billboards = [], hero = null, input, tour = null;
let mode = qs.get("view") || "3p";
let layoutMs = 0;
let firstFrameAt = null;
const perf = new Perf();

async function init() {
  const tw = performance.now();
  world = await (await fetch("worlds/" + day + ".json", { cache: "no-cache" })).json();
  marks.world_json_ms = Math.round(performance.now() - tw);
  setName = qs.get("set") || world.default_set;
  set = world.sets[setName];
  if (!set) throw new Error("unknown set '" + setName + "'; have " + Object.keys(world.sets).join(", "));
  spec = world.spec;
  $("loadtitle").textContent = spec.title || day;
  expectedAssets = Object.keys(set.objects).length + (world.panorama ? 1 : 0);
  progress();

  const ids = spec.objects.map((o) => o.id);
  const needBvh = new Set();
  for (const o of spec.objects) {
    const r = parsePlace(o.place, ids, o.id);
    if (r.ref) needBvh.add(r.ref);
    if (r.kind === "over-water") needBvh.add(o.id);
  }

  const tAssets = performance.now();
  const panoPromise = world.panorama
    ? fetchAsset(world.panorama.file).then(async (buf) => {
        const type = /\.png$/i.test(world.panorama.file) ? "image/png" : /\.webp$/i.test(world.panorama.file) ? "image/webp" : "image/jpeg";
        const url = URL.createObjectURL(new Blob([buf], { type }));
        const tex = await new THREE.TextureLoader().loadAsync(url);
        URL.revokeObjectURL(url);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.mapping = THREE.EquirectangularReflectionMapping;
        return tex;
      })
    : Promise.resolve(null);
  const modelPromises = spec.objects.map(async (o) => {
    const a = set.objects[o.id];
    if (!a) return null;
    if (a.sprite) return [o.id, await makeSpriteTemplate(a.sprite, o.size_m)];
    if (a.card) return [o.id, await makeCardTemplate(a.card, o.size_m)];
    const buf = await fetchAsset(a.file);
    const t = performance.now();
    const gltf = await gltfLoader.parseAsync(buf, "assets/" + a.file.replace(/[^/]+$/, ""));
    parseMs[o.id] = Math.round(performance.now() - t);
    prepModel(gltf.scene, needBvh.has(o.id));
    return [o.id, makeTemplate(gltf.scene, o.size_m, a.front_yaw_deg ?? set.front_yaw_deg ?? 0)];
  });
  const [pano, ...models] = await Promise.all([panoPromise, ...modelPromises]);
  marks.assets_ms = Math.round(performance.now() - tAssets);
  const templates = new Map(models.filter(Boolean));

  scene = new THREE.Scene();
  const palette = parsePalette(spec.palette);
  const L = lightPreset(spec.time_of_day);
  renderer.toneMappingExposure = Number(qs.get("exposure") || L.exposure);
  const kind = describeGround(spec.ground);
  const backdrop = qs.get("backdrop") || world.backdrop || (kind.indoor ? "grounded" : "sphere");
  const floating = backdrop === "float" || (backdrop === "sphere" && !kind.water);
  const panoYaw = THREE.MathUtils.degToRad(Number(qs.get("panoYaw") ?? world.panorama?.yaw_deg ?? 0));
  let horizon = new THREE.Color(L.hemiSky);
  if (pano) {
    horizon = horizonColor(pano.image);
    if (backdrop === "grounded") {
      const h = Number(qs.get("panoH") || world.panorama.height_m || 1.7);
      const sky = new GroundedSkybox(pano, h, Number(qs.get("panoR") || world.panorama.radius_m || 40), 96);
      sky.position.y = h - 0.02;
      sky.rotation.y = Math.PI / 2 + panoYaw;
      scene.add(sky);
    } else {
      scene.background = pano;
      scene.backgroundRotation.y = -Math.PI / 2 - panoYaw;
    }
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(pano).texture;
    pmrem.dispose();
    scene.environmentRotation.y = -Math.PI / 2 - panoYaw;
    scene.environmentIntensity = L.env;
  } else {
    scene.background = new THREE.Color(L.hemiSky);
  }

  ground = buildGround({ spec, palette, seed: hashString(day), floating });
  scene.add(ground.group);
  if (kind.water) scene.fog = new THREE.Fog(horizon, 30, 260);

  const hemi = new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemiI);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(L.sun, L.sunI);
  const elev = THREE.MathUtils.degToRad(L.elev);
  const az = THREE.MathUtils.degToRad(Number(qs.get("sunAz") ?? world.sun_azimuth_deg ?? (kind.indoor ? 205 : 160)));
  sun.position.set(Math.sin(az) * Math.cos(elev) * 30, Math.sin(elev) * 30, Math.cos(az) * Math.cos(elev) * 30);
  sun.castShadow = renderer.shadowMap.enabled;
  const S = ground.R + 2.5;
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 90 });
  const sm = quality === "high" ? 2048 : 1024;
  sun.shadow.mapSize.set(sm, sm);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const R = ground.R;
  let spawn = kind.indoor ? { x: 0, z: R * 0.74 } : { x: 0, z: R * 0.6 };
  for (let k = 0; k < 20 && !ground.isLand(spawn.x, spawn.z); k++) spawn = { x: spawn.x, z: spawn.z + 0.4 };

  const tl = performance.now();
  const lay = layoutWorld({ objects: spec.objects, templates, ground, seed: hashString(day + ":" + setName), raycastDown, spawn, faceSpawn: set.kind === "cards" && cardMode !== "billboard" });
  layoutMs = Math.round(performance.now() - tl);
  placed = lay.placed;
  hero = lay.hero;
  if (qs.get("decor") !== "0") scene.add(scatterDecor({ ground, placed, palette, seed: hashString(day) }));
  const tints = [null, [0.58, 0.35], [0.02, 0.3], [0.13, 0.35], [0.8, 0.25]];
  for (const p of placed) {
    if (p.isPerson && p.index > 0) {
      const [h, s] = tints[p.index % tints.length];
      p.object.traverse((m) => {
        if (m.isMesh) {
          m.material = m.material.clone();
          m.material.color = new THREE.Color().setHSL(h, s, 0.82);
        }
      });
    }
    if (p.object.userData.billboard) {
      billboards.push(p);
      p.anim = p.anim === "cheer" || p.anim === "bob" ? p.anim : null;
    }
    p.baseY = p.object.position.y;
    p.sy = p.object.scale.y;
    if (!p.anim && !p.object.userData.billboard) {
      p.object.matrixAutoUpdate = false;
      p.object.updateMatrix();
    }
    scene.add(p.object);
  }

  camera = new THREE.PerspectiveCamera(innerWidth < innerHeight ? 72 : 58, innerWidth / innerHeight, 0.05, 1500);
  input = new Input(canvas, $("joy"), $("knob"));
  player = new Player({
    ground,
    colliders: placed.filter((p) => p.collider).map((p) => p.collider),
    walkables: placed.filter((p) => p.walkable).map((p) => ({ object: p.object, x: p.x, z: p.z, yaw: p.yaw, hx: p.hx, hz: p.hz })),
    raycastDown,
    spawn,
    yaw: Math.PI,
  });
  const accent = [...palette].sort((a, b) => b.color.getHSL({}).s - a.color.getHSL({}).s)[0]?.color;
  avatar = makeAvatar(accent && accent.getHSL({}).s > 0.35 ? accent : new THREE.Color(0xf27d6b));
  scene.add(avatar);
  if (qs.get("tour") === "1") tour = makeTour(ground, placed.find((p) => p.id === hero), spawn);

  $("caption").innerHTML = '<div class="t"></div><div class="s"></div>';
  $("caption").querySelector(".t").textContent = spec.title || day;
  $("caption").querySelector(".s").textContent = [spec.time_of_day, spec.weather].filter(Boolean).join(" · ");
  setTimeout(() => ($("caption").style.opacity = 0), 6000);
  setTimeout(() => ($("hint").style.opacity = 0), 9000);
  window.addEventListener("resize", onResize);
  $("b-view").onclick = () => {
    mode = mode === "3p" ? "1p" : mode === "1p" ? "orbit" : "3p";
    $("b-view").textContent = mode === "orbit" ? "ORB" : mode.toUpperCase();
  };
  $("b-view").textContent = mode === "orbit" ? "ORB" : mode.toUpperCase();
  let hudState = qs.get("hud") || "full";
  const applyHud = () => {
    $("hud").classList.toggle("hidden", hudState === "off");
  };
  applyHud();
  $("b-hud").onclick = () => {
    hudState = hudState === "full" ? "mini" : hudState === "mini" ? "off" : "full";
    applyHud();
    updateHud(true);
  };
  $("hud").dataset.state = hudState;
  $("b-hud").addEventListener("click", () => ($("hud").dataset.state = hudState));
  $("b-rec").onclick = async () => {
    const b = $("b-rec");
    if (b.classList.contains("on")) return;
    b.classList.add("on");
    try {
      const r = await recordCanvas(canvas, Number(qs.get("rec") || 12), day + "-" + setName + "-" + (label || "clip"), (s) => (b.textContent = s));
      b.textContent = "saved";
      statsStatus = "clip " + r.file;
    } catch (e) {
      b.textContent = "REC ✗";
      errors.push("rec: " + String(e?.message ?? e));
    }
    b.classList.remove("on");
    setTimeout(() => (b.textContent = "REC"), 2500);
  };
  if (qs.get("capture")) captureFrames(Number(qs.get("capture")), qs.get("session") || day + "-" + setName);
  else renderer.setAnimationLoop(frame);
}

async function captureFrames(count, sessionName) {
  $("hud").classList.add("hidden");
  $("buttons").style.display = "none";
  $("hint").style.display = "none";
  const step = 1 / 30;
  let fake = performance.now();
  const realNow = performance.now.bind(performance);
  performance.now = () => fake;
  for (let i = 0; i < count; i++) {
    fake += step * 1000;
    frame();
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.88));
    await fetch("frame?session=" + encodeURIComponent(sessionName) + "&i=" + i, { method: "POST", body: blob });
    document.title = "captured " + (i + 1) + "/" + count;
  }
  performance.now = realNow;
  document.title = "capture done " + count;
}

function onResize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = innerWidth < innerHeight ? 72 : 58;
  camera.updateProjectionMatrix();
}

let lastFrameAt = null;
const startAt = performance.now();
let lastHud = 0;
let renderInfo = { calls: 0, triangles: 0 };
function frame() {
  const now = performance.now();
  const dt = lastFrameAt == null ? 1 / 60 : Math.min(0.05, (now - lastFrameAt) / 1000);
  lastFrameAt = now;
  const t = (now - startAt) / 1000;
  perf.tick(now);
  if (tour && input.touched) tour = null;
  const auto = tour ? tour.step(player, dt) : null;
  player.update(dt, input, mode, auto);
  player.applyCamera(camera, mode, dt, avatar);
  ground.update(t);
  for (const p of placed) {
    if (!p.anim) continue;
    if (p.anim === "cheer") p.object.position.y = p.baseY + Math.abs(Math.sin(t * 3.4 + p.phase)) * 0.08;
    else if (p.anim === "bob") {
      p.object.position.y = p.baseY + Math.sin(t * 1.4 + p.phase) * 0.07;
      p.object.rotation.z = Math.sin(t * 0.9 + p.phase) * 0.05;
    } else if (p.anim === "sway") p.object.rotation.z = Math.sin(t * 0.8 + p.phase) * 0.015;
    else if (p.anim === "breathe") p.object.scale.y = p.sy * (1 + Math.sin(t * 2.2 + p.phase) * 0.02);
  }
  for (const b of billboards) b.object.rotation.y = Math.atan2(camera.position.x - b.object.position.x, camera.position.z - b.object.position.z);
  renderer.render(scene, camera);
  renderInfo = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  if (!firstFrameAt) {
    firstFrameAt = performance.now();
    $("loading").style.opacity = 0;
    setTimeout(() => $("loading").remove(), 700);
    for (const s of [5, 15, 30, 60, 120, 180]) setTimeout(() => postStats("t+" + s + "s"), s * 1000);
    setInterval(() => postStats("interval"), 60000);
    const bench = Number(qs.get("bench") || 0);
    if (bench) setTimeout(() => postStats("bench-" + bench + "s"), bench * 1000);
  }
  if (now - lastHud > 500) {
    lastHud = now;
    updateHud();
  }
}

function payload(reason) {
  const nav = performance.getEntriesByType("navigation")[0];
  return {
    session, reason, label, day, set: setName, loads, mode, quality, href: location.pathname + location.search,
    t_since_first_frame_s: firstFrameAt ? +((performance.now() - firstFrameAt) / 1000).toFixed(1) : null,
    device: { ua: navigator.userAgent, platform: navigator.platform, dpr: devicePixelRatio, screen: [screen.width, screen.height], viewport: [innerWidth, innerHeight], cores: navigator.hardwareConcurrency ?? null, memory_gb: navigator.deviceMemory ?? null, touch_points: navigator.maxTouchPoints },
    gl,
    render: { dpr: renderer.getPixelRatio(), canvas: [canvas.width, canvas.height], shadows: renderer.shadowMap.enabled, ...renderInfo, programs: renderer.info.programs?.length ?? null, ...(scene ? gpuEstimate(scene) : {}) },
    perf: { last2s: perf.window(2000), last10s: perf.window(10000), frames: perf.total, long_frames_over_50ms: perf.long },
    load: {
      ttfb_ms: nav ? Math.round(nav.responseStart) : null, dom_content_loaded_ms: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      ...marks, layout_ms: layoutMs, first_frame_ms: firstFrameAt ? Math.round(firstFrameAt) : null,
      asset_bytes: assetStats.reduce((s, a) => s + a.bytes, 0), asset_encoded_bytes: assetStats.reduce((s, a) => s + (a.encoded || 0), 0),
      assets: assetStats, parse_ms: parseMs,
    },
    world: { placed: placed.length, colliders: placed.filter((p) => p.collider).length, hero, overlapping: placed.filter((p) => p.overlaps > 0).map((p) => p.id + "#" + p.index) },
    js_heap_mb: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    errors,
  };
}

function postStats(reason) {
  const body = JSON.stringify(payload(reason));
  fetch("stats", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: body.length < 60000 })
    .then((r) => {
      statsPosted += r.ok ? 1 : 0;
      statsStatus = r.ok ? "posted " + statsPosted : "post HTTP " + r.status;
    })
    .catch((e) => (statsStatus = "post failed: " + e.message));
}
window.addEventListener("pagehide", () => postStats("pagehide"));

function mb(b) {
  return (b / 1048576).toFixed(2) + " MB";
}

function updateHud(force) {
  const el = $("hud");
  if (el.classList.contains("hidden") && !force) return;
  const w = perf.window(1000) || {};
  const w10 = perf.window(10000) || {};
  const state = el.dataset.state || "full";
  const head = (w.fps ?? 0).toFixed(0) + " fps · " + (w.avg_ms ?? 0).toFixed(1) + " ms (p95 " + (w10.p95_ms ?? 0).toFixed(1) + ")";
  if (state === "mini") {
    el.textContent = head;
    return;
  }
  const g = scene ? gpuEstimate(scene) : {};
  const bytes = assetStats.reduce((s, a) => s + a.bytes, 0);
  const enc = assetStats.reduce((s, a) => s + (a.encoded || 0), 0);
  el.textContent = [
    "composite · " + day + " / " + setName,
    head + " · 10s " + (w10.fps ?? 0).toFixed(0) + " fps",
    (gl.renderer || "?") + " · " + (gl.webgl2 ? "WebGL2" : "WebGL1") + " · maxTex " + gl.max_texture,
    "canvas " + canvas.width + "×" + canvas.height + " @" + renderer.getPixelRatio().toFixed(2) + "x (dev " + devicePixelRatio + "x) · shadows " + (renderer.shadowMap.enabled ? "on" : "off"),
    "draws " + renderInfo.calls + " · tris " + (renderInfo.triangles / 1000).toFixed(0) + "k · verts " + ((g.vertices || 0) / 1000).toFixed(0) + "k",
    "tex " + g.textures + " ≈" + g.tex_mb + " MB (max " + g.biggest_texture + "px) · geo ≈" + g.geo_mb + " MB",
    "assets " + assetStats.length + " · " + mb(bytes) + (enc && enc !== bytes ? " (wire " + mb(enc) + ")" : "") + " · " + (marks.assets_ms ?? "?") + " ms",
    "first frame " + (firstFrameAt ? (firstFrameAt / 1000).toFixed(2) + " s" : "…") + " · layout " + layoutMs + " ms · objects " + placed.length,
    "view " + mode + " · stats " + (statsStatus || "pending") + (errors.length ? " · errors " + errors.length : ""),
  ].join("\n");
}

init().catch((e) => {
  console.error(e);
  errors.push(String(e?.stack ?? e).slice(0, 600));
  $("loadtitle").textContent = "World failed to load";
  $("loadinfo").textContent = String(e?.message ?? e);
  postStats("init-error");
});
