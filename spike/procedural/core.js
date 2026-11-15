// Shared helpers for the diorama kit. Part modules import from here.
// Contract: a part builder is (p, ctx) => { group, top? }.
//  - Build at the origin, floor at y = 0, facing +z. main.js applies at/rot/scale/y/on.
//  - `top` is the local y of the surface that `on` children sit on.
//  - Shadows are switched on for every mesh by main.js; builders don't need to.
//  - Use ctx.rand() for variation so scenes are deterministic.
//  - Use ctx.addLight(localPos, color, intensity, distance) for glowing things; main.js caps the count.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export { THREE };

export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvasTex(w, h, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A soft lumpy normal map that gives every clay surface a hand-made feel.
let clayNormal;
function getClayNormal() {
  if (clayNormal) return clayNormal;
  const n = 128;
  const r = rng(7);
  const hgt = new Float32Array(n * n);
  for (let o = 0; o < 4; o++) {
    const s = 4 << o;
    const g = [];
    for (let i = 0; i < (s + 1) * (s + 1); i++) g.push(r());
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const fx = (x / n) * s, fy = (y / n) * s;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        const v = (i, j) => g[(j % s) * (s + 1) + (i % s)];
        const a = v(x0, y0) * (1 - tx) + v(x0 + 1, y0) * tx;
        const b = v(x0, y0 + 1) * (1 - tx) + v(x0 + 1, y0 + 1) * tx;
        hgt[y * n + x] += (a * (1 - ty) + b * ty) / (1 << o);
      }
  }
  clayNormal = canvasTex(n, n, (ctx) => {
    const img = ctx.createImageData(n, n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const hx = hgt[y * n + ((x + 1) % n)] - hgt[y * n + ((x - 1 + n) % n)];
        const hy = hgt[((y + 1) % n) * n + x] - hgt[((y - 1 + n) % n) * n + x];
        const nx = -hx * 3, ny = -hy * 3, nz = 1;
        const l = Math.hypot(nx, ny, nz);
        const i = (y * n + x) * 4;
        img.data[i] = (nx / l * 0.5 + 0.5) * 255;
        img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
        img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
  }, { repeat: [2, 2], srgb: false });
  return clayNormal;
}

const matCache = new Map();
// Matte clay material. opts: rough, metal, map, emissive, emissiveIntensity, transparent, opacity, side, clay (normal noise, default true), flat
export function mat(color = "#cccccc", opts = {}) {
  // Build the key by hand: JSON.stringify would call Texture.toJSON and serialise the whole canvas.
  const key = color + Object.keys(opts).sort().map((k) => k + "=" + (opts[k]?.isTexture ? opts[k].uuid : String(opts[k]))).join(";");
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({
    color: opts.map ? "#ffffff" : color,
    roughness: opts.rough ?? 0.82,
    metalness: opts.metal ?? 0,
    map: opts.map ?? null,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    flatShading: !!opts.flat,
  });
  if (opts.map && opts.tint) m.color.set(opts.tint);
  if (opts.emissive) {
    m.emissive.set(opts.emissive);
    m.emissiveIntensity = opts.emissiveIntensity ?? 1;
  }
  if (opts.clay !== false && !opts.transparent) {
    m.normalMap = getClayNormal();
    m.normalScale.set(0.35, 0.35);
  }
  matCache.set(key, m);
  return m;
}

// Glowing material for bulbs, flames, screens. Intensity > 1 feeds the bloom pass.
export function glowMat(color = "#ffd28a", intensity = 4) {
  return mat(color, { emissive: color, emissiveIntensity: intensity, clay: false, rough: 0.4 });
}

// See-through glass for wine glasses, windows, bottles.
export function glassMat(color = "#dfefff", opacity = 0.35) {
  return mat(color, { transparent: true, opacity, rough: 0.25, clay: false });
}

const asMat = (m) => (m && m.isMaterial ? m : mat(m));

// Geometry helpers: all return a Mesh centred on the origin unless noted.
export function rbox(w, h, d, m, r = Math.min(w, h, d) * 0.18) {
  r = Math.min(r, Math.min(w, h, d) / 2 - 1e-4);
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.max(r, 1e-4)), asMat(m));
}
export function box(w, h, d, m) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), asMat(m));
}
export function cyl(rTop, rBot, h, m, seg = 20) {
  return new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), asMat(m));
}
export function sph(r, m, seg = 20) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, Math.round(seg * 0.7))), asMat(m));
}
export function cap(r, len, m, seg = 14) {
  return new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, seg), asMat(m));
}
export function cone(r, h, m, seg = 20) {
  return new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), asMat(m));
}
export function torus(r, tube, m, seg = 24, arc = Math.PI * 2) {
  return new THREE.Mesh(new THREE.TorusGeometry(r, tube, 10, seg, arc), asMat(m));
}
// pts: [[radius, y], ...] from bottom to top. Bottom of the shape is at its lowest y.
export function lathe(pts, m, seg = 24) {
  return new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), asMat(m));
}
// Tube along points [[x,y,z], ...] (smooth curve).
export function tube(pts, radius, m, seg = 32) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  return new THREE.Mesh(new THREE.TubeGeometry(curve, seg, radius, 8, false), asMat(m));
}

// Add a mesh/object to a parent at a position and rotation (radians). Returns the child.
export function put(parent, obj, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  obj.position.set(x, y, z);
  obj.rotation.set(rx, ry, rz);
  parent.add(obj);
  return obj;
}

export function group() {
  return new THREE.Group();
}

// Small colour utilities.
export function shade(hex, amt) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + amt)));
  return "#" + c.getHexString();
}
export function pick(r, arr) {
  return arr[Math.floor(r() * arr.length) % arr.length];
}

// Shared textures, made once.
const texCache = new Map();
export function cachedTex(key, make) {
  if (!texCache.has(key)) texCache.set(key, make());
  return texCache.get(key);
}
// Gingham / checker tablecloth.
export function checkTex(c1 = "#c8312f", c2 = "#f7f1e6", n = 8) {
  return cachedTex("check" + c1 + c2 + n, () =>
    canvasTex(256, 256, (ctx, w) => {
      ctx.fillStyle = c2;
      ctx.fillRect(0, 0, w, w);
      const s = w / n;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = c1;
      for (let i = 0; i < n; i += 2) {
        ctx.fillRect(i * s, 0, s, w);
        ctx.fillRect(0, i * s, w, s);
      }
    }),
  );
}
export function stripeTex(c1, c2, n = 8, vertical = true) {
  return cachedTex("stripe" + c1 + c2 + n + vertical, () =>
    canvasTex(256, 256, (ctx, w) => {
      ctx.fillStyle = c2;
      ctx.fillRect(0, 0, w, w);
      ctx.fillStyle = c1;
      const s = w / n;
      for (let i = 0; i < n; i += 2) vertical ? ctx.fillRect(i * s, 0, s, w) : ctx.fillRect(0, i * s, w, s);
    }),
  );
}
