// Renders a scene spec (SCHEMA.md) as a clay diorama.
// URL params: scene=<name in scenes/> | gallery=<module name>, yaw, elev, dist, size, post=0, orbit=1
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Soft vignette and fine grain: the "film still" finish.
const FilmFinish = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.35 }, grain: { value: 0.035 } },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float vignette; uniform float grain; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5));
      c.rgb *= mix(1.0, smoothstep(0.85, 0.25, d), vignette);
      c.rgb += (hash(vUv * 1000.0) - 0.5) * grain;
      gl_FragColor = c;
    }`,
};
// Clamp HDR colour and drop NaNs before bloom, so one hot specular pixel can't black out the frame.
const Clamp = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: FilmFinish.vertexShader,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (c.r != c.r || c.g != c.g || c.b != c.b) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 6.0), c.a);
    }`,
};
import { mat, rng, canvasTex, cyl, rbox, put, sph } from "./core.js";

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? Number(q.get(k)) : d);
const SIZE = num("size", 0);
const W = SIZE || innerWidth, H = SIZE || innerHeight;

const MODULES = ["furniture", "people", "structures", "nature", "props"];
const registry = {};
const moduleParts = {};
await Promise.all(
  MODULES.map(async (m) => {
    try {
      const mod = await import(`./parts/${m}.js?v=${Date.now()}`);
      moduleParts[m] = Object.keys(mod.parts);
      Object.assign(registry, mod.parts);
    } catch (e) {
      console.warn("module failed", m, e.message);
      moduleParts[m] = [];
    }
  }),
);

// ---------- time of day ----------
const TIMES = {
  dawn: { sun: "#ffb79a", sunI: 1.6, elev: 10, az: -60, hemi: ["#9fb4ff", "#5a4a50"], hemiI: 0.5, env: 0.35, bg: ["#f6c9b8", "#7c86b8"], bloom: 0.5, exp: 1.0 },
  morning: { sun: "#fff1d6", sunI: 2.6, elev: 35, az: -45, hemi: ["#cfe3ff", "#6b5a4a"], hemiI: 0.6, env: 0.5, bg: ["#f3ead8", "#bcd3ea"], bloom: 0.3, bt: 1.4, exp: 1.0 },
  noon: { sun: "#ffffff", sunI: 3.0, elev: 62, az: -30, hemi: ["#d6e8ff", "#6b5a4a"], hemiI: 0.7, env: 0.6, bg: ["#f4efe6", "#c9dcef"], bloom: 0.25, bt: 1.6, exp: 1.0 },
  "golden-hour": { sun: "#ffad5c", sunI: 3.2, elev: 16, az: -55, hemi: ["#ffd9a8", "#5a3d34"], hemiI: 0.55, env: 0.35, bg: ["#ffd8a8", "#e58f6a"], bloom: 0.55, bt: 1.25, exp: 1.0 },
  dusk: { sun: "#ff9a6b", sunI: 0.9, elev: 8, az: -60, hemi: ["#6f78c9", "#3a2a2a"], hemiI: 0.55, env: 0.22, bg: ["#3b3f78", "#c97a72"], bloom: 0.9, exp: 1.05 },
  night: { sun: "#9fb2ff", sunI: 0.45, elev: 40, az: 30, hemi: ["#3b4a8a", "#1a1420"], hemiI: 0.45, env: 0.12, bg: ["#0f1530", "#2b2f5a"], bloom: 1.1, exp: 1.1 },
  overcast: { sun: "#e8eef5", sunI: 1.2, elev: 55, az: -30, hemi: ["#dfe6ee", "#5f6266"], hemiI: 1.0, env: 0.7, bg: ["#e3e7ec", "#a9b3bf"], bloom: 0.2, bt: 1.4, exp: 1.0 },
  rain: { sun: "#b9c6d6", sunI: 0.7, elev: 50, az: -30, hemi: ["#a7b6c8", "#3d4248"], hemiI: 0.9, env: 0.45, bg: ["#7d8da1", "#3e4a5c"], bloom: 0.6, exp: 1.05 },
  snow: { sun: "#c9d8ff", sunI: 0.6, elev: 35, az: -40, hemi: ["#aebfe8", "#3a3a4a"], hemiI: 0.7, env: 0.3, bg: ["#27305a", "#6b78a8"], bloom: 0.9, exp: 1.05 },
};

// ---------- base surfaces ----------
function surfaceTex(kind, r) {
  const draw = {
    cobblestone(ctx, w) {
      ctx.fillStyle = "#6f675e"; ctx.fillRect(0, 0, w, w);
      const n = 10, s = w / n;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const off = (y % 2) * s * 0.5;
        const l = 52 + r() * 22, hue = 25 + r() * 15;
        ctx.fillStyle = `hsl(${hue},${10 + r() * 12}%,${l}%)`;
        const jx = r() * 2, jy = r() * 2;
        // Draw twice across the right edge so the texture wraps without a seam.
        for (const wrap of [0, -w]) {
          ctx.beginPath();
          ctx.roundRect(x * s + off + 2 + jx + wrap, y * s + 2 + jy, s - 5, s - 5, s * 0.3);
          ctx.fill();
        }
      }
    },
    grass(ctx, w) {
      ctx.fillStyle = "#5f9a45"; ctx.fillRect(0, 0, w, w);
      for (let i = 0; i < 5000; i++) {
        ctx.fillStyle = `hsl(${90 + r() * 30},${40 + r() * 20}%,${30 + r() * 25}%)`;
        ctx.fillRect(r() * w, r() * w, 1.5, 3 + r() * 3);
      }
    },
    wood(ctx, w) {
      const n = 8, s = w / n;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = `hsl(28,${35 + r() * 15}%,${36 + r() * 12}%)`;
        ctx.fillRect(0, i * s, w, s - 2);
        ctx.strokeStyle = "rgba(60,30,10,0.18)";
        for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.moveTo(0, i * s + r() * s); ctx.bezierCurveTo(w * 0.3, i * s + r() * s, w * 0.6, i * s + r() * s, w, i * s + r() * s); ctx.stroke(); }
        ctx.fillStyle = "rgba(40,20,5,0.5)"; ctx.fillRect(r() * w, i * s, 2, s - 2);
      }
    },
    tile(ctx, w) {
      const n = 8, s = w / n;
      ctx.fillStyle = "#e9e0cf"; ctx.fillRect(0, 0, w, w);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        ctx.fillStyle = `hsl(18,${45 + r() * 15}%,${50 + r() * 10}%)`;
        ctx.fillRect(x * s + 2, y * s + 2, s - 4, s - 4);
      }
    },
    sand(ctx, w) {
      ctx.fillStyle = "#e6cf9c"; ctx.fillRect(0, 0, w, w);
      for (let i = 0; i < 6000; i++) { ctx.fillStyle = `hsla(40,40%,${55 + r() * 30}%,0.6)`; ctx.fillRect(r() * w, r() * w, 2, 2); }
    },
    snow(ctx, w) {
      ctx.fillStyle = "#eef3fb"; ctx.fillRect(0, 0, w, w);
      for (let i = 0; i < 3000; i++) { ctx.fillStyle = `hsla(220,40%,${85 + r() * 15}%,0.7)`; ctx.fillRect(r() * w, r() * w, 3, 3); }
    },
    asphalt(ctx, w) {
      ctx.fillStyle = "#4a4d52"; ctx.fillRect(0, 0, w, w);
      for (let i = 0; i < 6000; i++) { ctx.fillStyle = `hsla(220,5%,${25 + r() * 30}%,0.7)`; ctx.fillRect(r() * w, r() * w, 2, 2); }
    },
    carpet(ctx, w) {
      ctx.fillStyle = "#7a3b3b"; ctx.fillRect(0, 0, w, w);
      for (let i = 0; i < 6000; i++) { ctx.fillStyle = `hsla(0,40%,${20 + r() * 20}%,0.5)`; ctx.fillRect(r() * w, r() * w, 2, 2); }
    },
    water(ctx, w) {
      const g = ctx.createLinearGradient(0, 0, w, w); g.addColorStop(0, "#2f8fb8"); g.addColorStop(1, "#1b5f8a");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      for (let i = 0; i < 80; i++) { const x = r() * w, y = r() * w; ctx.beginPath(); ctx.arc(x, y, 6 + r() * 10, 0.2, 1.4); ctx.stroke(); }
    },
  }[kind] ?? null;
  const rep = { cobblestone: 5, tile: 4, wood: 3, grass: 3, carpet: 2 }[kind] ?? 3;
  return draw ? canvasTex(512, 512, draw, { repeat: [rep, rep] }) : null;
}

// h = half-size of the base; it shrinks to wrap the content so the diorama stays dense.
function buildBase(base = {}, r, h = 4.75) {
  const g = new THREE.Group();
  const shape = base.shape ?? "round";
  const map = surfaceTex(base.surface ?? "grass", r);
  if (map) map.repeat.multiplyScalar(h / 4.75);
  const topMat = mat("#fff", { map, rough: 0.9 });
  const rimMat = mat("#6b4428", { rough: 0.7 });
  if (shape === "round") {
    put(g, cyl(h, h, 0.12, topMat, 96), 0, -0.06, 0);
    put(g, cyl(h + 0.1, h + 0.1, 0.18, mat("#5a4a3c"), 96), 0, -0.2, 0);
    put(g, cyl(h + 0.25, h + 0.4, 0.55, rimMat, 96), 0, -0.55, 0);
  } else {
    put(g, rbox(2 * h, 0.12, 2 * h, topMat, 0.04), 0, -0.06, 0);
    put(g, rbox(2 * h + 0.3, 0.6, 2 * h + 0.3, rimMat, 0.08), 0, -0.42, 0);
  }
  g.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  return g;
}

// ---------- weather ----------
function weather(kind, scene, r) {
  if (kind !== "snow" && kind !== "rain") return;
  const n = kind === "snow" ? 1400 : 900;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 6;
    pos.set([Math.cos(a) * d, r() * 7, Math.sin(a) * d], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const sprite = canvasTex(32, 32, (ctx) => {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
  });
  const m = new THREE.PointsMaterial({ size: kind === "snow" ? 0.07 : 0.03, map: sprite, transparent: true, depthWrite: false, color: kind === "snow" ? "#ffffff" : "#bcd0ea", opacity: kind === "snow" ? 0.95 : 0.6 });
  scene.add(new THREE.Points(geo, m));
}

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(SIZE ? 1 : Math.min(devicePixelRatio, 2));
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 200);
const stats = { objects: 0, unknown: [], errors: [], buildMs: 0, lights: 0 };

let spec;
if (q.has("gallery")) {
  const names = q.get("gallery") === "all" ? Object.keys(registry) : moduleParts[q.get("gallery")] ?? [];
  const cols = Math.ceil(Math.sqrt(names.length));
  const step = 9 / Math.max(cols, 1);
  spec = {
    title: "gallery", time: q.get("time") ?? "golden-hour", base: { shape: "square", surface: "wood" },
    objects: names.map((t, i) => ({ type: t, at: [-4.5 + step * (0.5 + (i % cols)), -4.5 + step * (0.5 + Math.floor(i / cols))], ...(t === "string-lights" ? { points: [[-0.6, 1.4, 0], [0.6, 1.4, 0]] } : {}) })),
  };
  if (q.has("label")) spec.labels = true;
} else {
  const name = q.get("scene") ?? "birthday-dinner.image";
  spec = await (await fetch(`scenes/${name}.json?v=${Date.now()}`)).json();
}

const t0 = performance.now();
if (q.has("time")) spec.time = q.get("time");
const time = TIMES[spec.time] ?? TIMES["golden-hour"];
const r = rng(1234);
renderer.toneMappingExposure = time.exp;

const bgTex = canvasTex(4, 256, (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, time.bg[1]); g.addColorStop(1, time.bg[0]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}, { repeat: [1, 1] });
scene.background = bgTex;
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = time.env;
// Optional 360° backdrop: ?pano=<name> loads pano/<name>.jpg behind the diorama.
if (q.has("pano")) {
  const pano = await new THREE.TextureLoader().loadAsync(`pano/${q.get("pano")}.jpg`);
  pano.mapping = THREE.EquirectangularReflectionMapping;
  pano.colorSpace = THREE.SRGBColorSpace;
  scene.background = pano;
  scene.backgroundBlurriness = num("blur", 0.04);
  scene.backgroundIntensity = num("bgi", 0.9);
}

const hemi = new THREE.HemisphereLight(time.hemi[0], time.hemi[1], time.hemiI);
scene.add(hemi);
const sun = new THREE.DirectionalLight(time.sun, time.sunI);
const el = THREE.MathUtils.degToRad(time.elev), az = THREE.MathUtils.degToRad(time.az);
sun.position.set(Math.sin(az) * Math.cos(el) * 20, Math.sin(el) * 20, Math.cos(az) * Math.cos(el) * 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 50 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 3;
scene.add(sun);

weather(spec.time, scene, r);

// Shadow catcher under the plinth.
const catcher = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.ShadowMaterial({ opacity: 0.18 }));
catcher.rotation.x = -Math.PI / 2;
catcher.position.y = -0.83;
catcher.receiveShadow = true;
scene.add(catcher);

const MAX_LIGHTS = num("lights", 8);
const lightRequests = [];
const placed = {};
const deg = THREE.MathUtils.degToRad;

function buildObject(o, depth = 0) {
  const make = registry[o.type];
  let built;
  const ctx = {
    rand: rng(Math.floor((o.at?.[0] ?? 0) * 1000 + (o.at?.[1] ?? 0) * 7919 + stats.objects * 31)),
    time: spec.time,
    palette: spec.palette ?? [],
    addLight(pos, color = "#ffcc88", intensity = 1, distance = 4) {
      lightRequests.push({ obj: null, pos: pos.clone ? pos.clone() : new THREE.Vector3(...pos), color, intensity, distance, owner: o });
    },
  };
  const before = lightRequests.length;
  try {
    if (!make) throw new Error("unknown type " + o.type);
    built = make(o, ctx);
    if (built?.isObject3D) built = { group: built };
  } catch (e) {
    if (!make) stats.unknown.push(o.type); else stats.errors.push(`${o.type}: ${e.message}`);
    const ph = rbox(0.4, 0.4, 0.4, mat("#ff00ff"));
    ph.position.y = 0.2;
    const g = new THREE.Group(); g.add(ph);
    built = { group: g, top: 0.4 };
  }
  const g = built.group;
  // String-light points are absolute, so the strand itself stays at the origin.
  const absolute = o.type === "string-lights";
  const [x, z] = absolute ? [0, 0] : o.at ?? [0, 0];
  const parent = !absolute && o.on && placed[o.on];
  if (parent) {
    const local = new THREE.Vector3(x, (parent.top ?? 0) + (o.y ?? 0), z);
    parent.group.add(g);
    g.position.copy(local);
    // Undo the parent's scale so items keep their size.
    const s = parent.group.scale.x || 1;
    g.scale.setScalar((o.scale ?? 1) / s);
  } else {
    g.position.set(x, o.y ?? 0, z);
    g.scale.setScalar(o.scale ?? 1);
    scene.add(g);
  }
  g.rotation.y = absolute ? 0 : deg(o.rot ?? 0);
  if (absolute) g.position.y = 0;
  for (let i = before; i < lightRequests.length; i++) lightRequests[i].obj = g;
  if (o.id) placed[o.id] = { group: g, top: built.top ?? 0 };
  stats.objects++;
}

// Supports first, so `on` children can find their parent.
const objs = spec.objects ?? [];
const pending = [...objs];
for (let pass = 0; pass < 4 && pending.length; pass++) {
  for (let i = 0; i < pending.length; ) {
    const o = pending[i];
    if (!o.on || placed[o.on]) { buildObject(o); pending.splice(i, 1); } else i++;
  }
}
for (const o of pending) { stats.errors.push(`on: missing ${o.on}`); delete o.on; buildObject(o); }

// Point lights: merge nearby requests and keep the brightest few.
scene.updateMatrixWorld(true);
const merged = [];
for (const L of lightRequests) {
  const wp = L.pos.clone().applyMatrix4(L.obj.matrixWorld);
  const m = merged.find((M) => M.pos.distanceTo(wp) < 1.6);
  if (m) { m.pos.lerp(wp, L.intensity / (m.intensity + L.intensity)); m.intensity += L.intensity; m.distance = Math.max(m.distance, L.distance); }
  else merged.push({ pos: wp, color: L.color, intensity: L.intensity, distance: L.distance });
}
merged.sort((a, b) => b.intensity - a.intensity);
for (const M of merged.slice(0, MAX_LIGHTS)) {
  const pl = new THREE.PointLight(M.color, Math.min(M.intensity, 4), M.distance * 1.5, 1.6);
  pl.position.copy(M.pos);
  scene.add(pl);
  stats.lights++;
}

scene.traverse((o) => {
  if (o.isMesh && o !== catcher) {
    const glow = o.material?.emissiveIntensity > 1;
    const glass = o.material?.transparent;
    o.castShadow = !glow && !glass;
    o.receiveShadow = !glow;
  }
});
// The diorama is static, so merge every mesh that shares a material into one draw call (merge=0 to skip).
function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const buckets = new Map();
  const victims = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || o === catcher) return;
    if (o.parent === root) return; // the base and loose meshes stay as they are
    const key = o.material.uuid + (o.castShadow ? "s" : "") + (o.receiveShadow ? "r" : "");
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color"].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const wantColor = !!o.material.vertexColors;
    if (wantColor && !g.attributes.color) g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
    if (!wantColor && g.attributes.color) g.deleteAttribute("color");
    if (g.attributes.color && g.attributes.color.itemSize !== 3) g.deleteAttribute("color");
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, cast: o.castShadow, recv: o.receiveShadow, geos: [] });
    buckets.get(key).geos.push(g);
    victims.push(o);
  });
  for (const v of victims) v.removeFromParent();
  for (const b of buckets.values()) {
    const geo = mergeGeometries(b.geos, false);
    if (!geo) continue;
    const m = new THREE.Mesh(geo, b.mat);
    m.castShadow = b.cast;
    m.receiveShadow = b.recv;
    root.add(m);
  }
  return buckets.size;
}

// Fit the base to the content (fit=0 keeps the full 9.5 m base).
const content = new THREE.Box3();
for (const c of scene.children) if (c.isGroup) content.expandByObject(c);
const fit = q.get("fit") !== "0" && !content.isEmpty();
const cx = fit ? (content.min.x + content.max.x) / 2 : 0;
const cz = fit ? (content.min.z + content.max.z) / 2 : 0;
let half = 4.75;
if (fit) {
  const ex = (content.max.x - content.min.x) / 2, ez = (content.max.z - content.min.z) / 2;
  const need = (spec.base?.shape ?? "round") === "round" ? Math.hypot(ex, ez) * 0.92 : Math.max(ex, ez);
  half = THREE.MathUtils.clamp(need + 0.45, 3, 5.5);
}
const baseGroup = buildBase(spec.base, r, half);
baseGroup.position.set(cx, 0, cz);
scene.add(baseGroup);
stats.baseHalf = +half.toFixed(2);
if (q.get("merge") !== "0") stats.mergedMeshes = mergeStatic(scene);
stats.buildMs = Math.round(performance.now() - t0);

// ---------- camera ----------
const yaw = deg(num("yaw", 0)), elev = deg(num("elev", 30)), dist = num("dist", THREE.MathUtils.clamp((fit ? content.getBoundingSphere(new THREE.Sphere()).radius : 6.5) * 3.3, 10, 24));
const target = new THREE.Vector3(cx + num("tx", 0), num("ty", 0.9), cz + num("tz", 0));
camera.position.set(target.x + Math.sin(yaw) * Math.cos(elev) * dist, Math.sin(elev) * dist + target.y, target.z + Math.cos(yaw) * Math.cos(elev) * dist);
camera.lookAt(target);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(target);
controls.enableDamping = true;
controls.update();

// ---------- post ----------
const usePost = q.get("post") !== "0";
let composer;
if (usePost) {
  composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera, W, H);
  ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1, scale: 1 });
  ao.blendIntensity = 0.85;
  composer.addPass(ao);
  composer.addPass(new ShaderPass(Clamp));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), time.bloom, 0.5, time.bt ?? 1.0));
  composer.addPass(new OutputPass());
  composer.addPass(new SMAAPass());
  composer.addPass(new ShaderPass(FilmFinish));
}

const triangles = () => renderer.info.render.triangles;
let frames = 0;
renderer.info.autoReset = false;
function loop() {
  controls.update();
  renderer.info.reset();
  usePost ? composer.render() : renderer.render(scene, camera);
  if (++frames === 3) {
    stats.triangles = triangles();
    stats.drawCalls = renderer.info.render.calls;
    window.stats = stats;
    window.ready = true;
    console.log("stats", JSON.stringify(stats));
  }
  if (q.get("still") !== "1" || frames < 4) requestAnimationFrame(loop);
}
loop();
