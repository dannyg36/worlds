// Outdoor parts: pond, dock, boat, bridge, fountain, campfire, tent, picnic blanket, beach umbrella,
// surfboard, sandcastle, hill, flower bed.
// Most of each part is ONE merged vertex-coloured clay mesh (Batch). Water, textured cloth, flames and
// sparks are separate meshes. Built at the origin, floor at y = 0, facing +z, in metres.
import { THREE, mat, glowMat, shade, cachedTex, canvasTex, checkTex } from "../core.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const TAU = Math.PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const { lerp, clamp } = THREE.MathUtils;
const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
const pair = (v, d) => (Array.isArray(v) && Number(v[0]) > 0 && Number(v[1]) > 0 ? [Number(v[0]), Number(v[1])] : Number(v) > 0 ? [Number(v), Number(v)] : d);
const hexes = (v, d) => (Array.isArray(v) && v.length ? v : typeof v === "string" && v !== "none" ? [v] : d);
const isDark = (t) => ["dusk", "night", "snow"].includes(t);
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
const _c = new THREE.Color(), _t = new THREE.Color();
const jitter = (r, hex, l = 0.05) => _t.set(hex).offsetHSL((r() - 0.5) * 0.015, (r() - 0.5) * 0.06, (r() - 0.5) * l).getHex();
// Quaternion from yaw (about y) then pitch (about x): pitch -0.5 tips a +z-pointing piece upward.
const qYX = (yaw, pitch = 0, roll = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, "YXZ"));
const UP = V(0, 1, 0);

const GREYS = ["#8f8a80", "#a39d91", "#7d786f", "#b2aa99", "#968c7c"];
const GRASS = ["#4d7d2c", "#5f8f34", "#729f3c", "#86b04a"];

// ---------- materials ----------
let vc1, vc2, waterM;
function vcMat(double = false) {
  if (!vc1) {
    vc1 = mat("#ffffff", { rough: 0.88 }).clone();
    vc1.vertexColors = true;
    vc2 = vc1.clone();
    vc2.side = THREE.DoubleSide;
  }
  return double ? vc2 : vc1;
}
// Glossy water: low roughness, no metalness, colour from vertices (deep middle, lighter edge).
// The clay normal map doubles as soft ripples and breaks up the sun's highlight.
function waterMat() {
  if (!waterM) {
    waterM = mat("#ffffff", { rough: 0.2 }).clone();
    waterM.vertexColors = true;
    waterM.normalScale.set(0.25, 0.25);
    waterM.envMapIntensity = 0.7;
  }
  return waterM;
}
const streamMat = () => mat("#a6d8dc", { rough: 0.15, clay: false, transparent: true, opacity: 0.75 });

const dotTex = () =>
  cachedTex("outdoors-dot", () =>
    canvasTex(64, 64, (c, w) => {
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.3, "rgba(255,255,255,0.55)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, w, w);
    }, { repeat: [1, 1] }),
  );
// Soft dots. PointsMaterial size ~ world size / 0.27 at the default camera. GTAO ignores Points.
function points(pts, worldSize, color, additive = true, opacity = 1) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const m = new THREE.PointsMaterial({ size: worldSize / 0.27, map: dotTex(), color, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  return new THREE.Points(geo, m);
}

// ---------- geometry helpers ----------
const RB = (w, h, d, r = Math.min(w, h, d) * 0.25) => new RoundedBoxGeometry(w, h, d, 1, Math.max(1e-4, Math.min(r, Math.min(w, h, d) / 2 - 1e-4)));
const BX = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const CY = (rt, rb, h, seg = 10, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const SP = (seg = 8, rings = 6) => new THREE.SphereGeometry(1, seg, rings);
const LA = (pts, seg = 16) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
const TUBE = (pts, r, seg = 16, radial = 6, closed = false) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => (p.isVector3 ? p : V(...p))), closed), seg, r, radial, closed);

function lumpy(g, amt, seed) {
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const n = Math.sin(x * 3.1 + seed) * Math.sin(y * 2.7 + seed * 1.7) * Math.sin(z * 3.3 + seed * 0.3 + 1) + 0.45 * Math.sin(x * 7.3 - seed) * Math.sin(y * 6.1 + seed * 2.1 + 2) * Math.sin(z * 6.9 - seed);
    const k = 1 + amt * n;
    P.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}
const geoCache = {};
const cached = (k, make) => (geoCache[k] ??= make());
// One of four lumpy pebble shapes (unit radius, 56 tris).
function stone(r) {
  const k = Math.floor(r() * 4);
  return cached("stone" + k, () => lumpy(SP(7, 5), 0.2, k * 3.7 + 1));
}
const blade = () => cached("blade", () => new THREE.ConeGeometry(1, 1, 4, 1).translate(0, 0.5, 0));
const petal = () => cached("petal", () => SP(5, 3));

// A disc of concentric rings: at(t, a) -> [x, y, z] for t in 0..1 (centre to rim), angle a.
// colorAt(t, a) -> THREE.Color bakes vertex colours. Faces point up.
function radialGeo(n, rings, at, colorAt) {
  const pos = [], uv = [], col = [], idx = [];
  const push = (t, a) => {
    const p = at(t, a);
    pos.push(p[0], p[1], p[2]);
    uv.push(p[0] * 0.8, p[2] * 0.8);
    if (colorAt) {
      const c = colorAt(t, a);
      col.push(c.r, c.g, c.b);
    }
  };
  push(0, 0);
  for (let i = 1; i <= rings; i++) for (let j = 0; j < n; j++) push(i / rings, (j / n) * TAU);
  for (let j = 0; j < n; j++) idx.push(0, 1 + ((j + 1) % n), 1 + j);
  for (let i = 1; i < rings; i++) {
    const o = 1 + (i - 1) * n;
    for (let j = 0; j < n; j++) {
      const a = o + j, b = o + ((j + 1) % n), c = a + n, d = b + n;
      idx.push(a, d, c, a, b, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  if (colorAt) g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Reverse the winding and normals (inner skins).
function flip(src) {
  const g = src.index ? src.toNonIndexed() : src.clone();
  for (const k of Object.keys(g.attributes)) {
    const A = g.attributes[k].array, n = g.attributes[k].itemSize;
    for (let i = 0; i < g.attributes[k].count; i += 3)
      for (let c = 0; c < n; c++) {
        const t = A[(i + 1) * n + c];
        A[(i + 1) * n + c] = A[(i + 2) * n + c];
        A[(i + 2) * n + c] = t;
      }
  }
  const N = g.attributes.normal.array;
  for (let i = 0; i < N.length; i++) N[i] = -N[i];
  return g;
}

// Collect coloured pieces and merge them into one vertex-coloured mesh.
const KEEP = new Set(["position", "normal", "uv", "color"]);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = V(), _s = V();
class Batch {
  geos = [];
  // color: hex, or null to keep the geometry's own vertex colours. rot: [x, y, z] radians or a Quaternion.
  // grad darkens toward the piece's local bottom (fake occlusion); fn(x, y, z) in local coords may return a colour.
  add(src, color, pos = [0, 0, 0], rot = [0, 0, 0], scl = 1, { grad = 0.25, fn } = {}) {
    const g = src.index ? src.toNonIndexed() : src.clone();
    for (const k of Object.keys(g.attributes)) if (!KEEP.has(k)) g.deleteAttribute(k);
    g.morphAttributes = {};
    g.clearGroups();
    if (!g.attributes.normal) g.computeVertexNormals();
    g.computeBoundingBox();
    const P = g.attributes.position, own = color == null ? g.attributes.color : null;
    const y0 = g.boundingBox.min.y, yr = g.boundingBox.max.y - y0 || 1;
    const col = new Float32Array(P.count * 3), c0 = new THREE.Color(color ?? "#ffffff");
    for (let i = 0; i < P.count; i++) {
      if (own) _c.fromBufferAttribute(own, i);
      else if (fn) _c.set(fn(P.getX(i), P.getY(i), P.getZ(i)) ?? c0);
      else _c.copy(c0);
      const f = 1 - grad + grad * ((P.getY(i) - y0) / yr);
      col[i * 3] = _c.r * f;
      col[i * 3 + 1] = _c.g * f;
      col[i * 3 + 2] = _c.b * f;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    if (rot.isQuaternion) _q.copy(rot);
    else _q.setFromEuler(_e.set(rot[0], rot[1], rot[2]));
    Array.isArray(pos) ? _p.fromArray(pos) : _p.copy(pos);
    typeof scl === "number" ? _s.setScalar(scl) : _s.fromArray(scl);
    g.applyMatrix4(_m.compose(_p, _q, _s));
    if (!g.attributes.uv) {
      const uv = new Float32Array(P.count * 2);
      for (let i = 0; i < P.count; i++) {
        uv[i * 2] = (P.getX(i) + P.getY(i) * 0.5) * 1.5;
        uv[i * 2 + 1] = (P.getZ(i) + P.getY(i) * 0.5) * 1.5;
      }
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    }
    this.geos.push(g);
    return this;
  }
  // A closed cylinder from a to c; fn sees local coords with +y toward c.
  stick(a, c, r, color, { seg = 8, open = false, grad = 0.15, fn, r2 = r } = {}) {
    const A = V(...a), C = V(...c), len = A.distanceTo(C);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, C.clone().sub(A).normalize());
    return this.add(CY(r2, r, len, seg, open), color, A.add(C).multiplyScalar(0.5), q, 1, { grad, fn });
  }
  mesh(double = false) {
    const geo = mergeGeometries(this.geos, false);
    geo.computeBoundingSphere();
    return new THREE.Mesh(geo, vcMat(double));
  }
}

// Merge plain geometries (same attribute set) into one mesh with a given material.
function merged(geos, m) {
  const g = mergeGeometries(geos.map((x) => (x.index ? x.toNonIndexed() : x)), false);
  return new THREE.Mesh(g, m);
}

// A lumpy organic outline: radius multiplier around the circle.
const outline = (s0, amp = 1) => (a) => 1 + amp * (0.07 * Math.sin(3 * a + s0) + 0.05 * Math.sin(5 * a + s0 * 1.7) + 0.035 * Math.sin(2 * a - s0));

// Five-petal daisy facing up, tilted a little.
function daisy(b, r, p, color, s, centre = "#f2c230") {
  const q = qYX(r() * TAU, (r() - 0.5) * 0.5);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU;
    const off = V(Math.sin(a) * s * 0.55, 0, Math.cos(a) * s * 0.55).applyQuaternion(q);
    b.add(petal(), jitter(r, color, 0.04), p.clone().add(off), q.clone().multiply(qYX(a, -0.25)), [s * 0.34, s * 0.16, s * 0.55], { grad: 0.15 });
  }
  b.add(petal(), centre, p.clone().add(V(0, s * 0.1, 0)), q, [s * 0.26, s * 0.2, s * 0.26], { grad: 0.2 });
}

// ---------- pond ----------
function pond(p, ctx) {
  const r = ctx.rand, [w, d] = pair(p.size, [2.4, 1.7]);
  const rx = w / 2, rz = d / 2, f = outline(r() * 10);
  const edge = (a, k) => [Math.cos(a) * rx * f(a) * k, Math.sin(a) * rz * f(a) * k];
  const g = new THREE.Group(), b = new Batch();
  // Muddy bank under the stones, then the water just below y = 0.02.
  b.add(radialGeo(48, 1, (t, a) => { const [x, z] = edge(a, t * 1.08); return [x, 0, z]; }), "#5d5442", [0, 0.004, 0], [0, 0, 0], 1, { grad: 0 });
  const deep = new THREE.Color(p.color ?? "#24636d"), shallow = new THREE.Color(p.color ? shade(p.color, 0.15) : "#5d9f96");
  const wg = radialGeo(48, 4, (t, a) => { const [x, z] = edge(a, t * 0.98); return [x, 0, z]; }, (t) => _c.copy(deep).lerp(shallow, Math.pow(t, 1.8)));
  const water = new THREE.Mesh(wg, waterMat());
  water.position.y = 0.014;
  g.add(water);

  // Chunky stone rim, spaced by arc length, with a few smaller pebbles outside.
  for (let a = 0; a < TAU; ) {
    const sz = 0.14 + r() * 0.12, [x, z] = edge(a, 1.0 + r() * 0.05);
    b.add(stone(r), jitter(r, pick(r, GREYS), 0.08), [x, sz * 0.16, z], [(r() - 0.5) * 0.5, r() * TAU, (r() - 0.5) * 0.5], [sz * 0.6, sz * 0.4, sz * 0.5], { grad: 0.4 });
    if (r() < 0.3) {
      const s2 = sz * 0.5, [x2, z2] = edge(a + 0.04, 1.12);
      b.add(stone(r), jitter(r, pick(r, GREYS), 0.08), [x2, s2 * 0.12, z2], [0, r() * TAU, 0], [s2 * 0.6, s2 * 0.4, s2 * 0.5], { grad: 0.4 });
    }
    a += (sz * 0.8) / Math.max(0.05, Math.hypot(rx * Math.sin(a), rz * Math.cos(a)) * f(a));
  }

  // Lily pads (one in flower) and a couple of ripple rings.
  const nPads = 3 + Math.floor(r() * 3), notch = 0.55;
  for (let i = 0; i < nPads; i++) {
    const a = r() * TAU, [x, z] = edge(a, 0.3 + r() * 0.42), pr = 0.08 + r() * 0.06;
    b.add(new THREE.CylinderGeometry(pr, pr, 0.014, 14, 1, false, notch / 2, TAU - notch), jitter(r, pick(r, ["#4f8f37", "#5f9f3f", "#6aa845"]), 0.06), [x, 0.022, z], [0, r() * TAU, 0], 1, { grad: 0.4 });
    if (i === 0) {
      for (let k = 0; k < 12; k++) {
        const inner = k >= 7, pa = (k / (inner ? 5 : 7)) * TAU + (inner ? 0.3 : 0);
        const q = qYX(pa, inner ? -0.9 : -0.45);
        const dir = V(0, 0, 1).applyQuaternion(q);
        b.add(petal(), inner ? "#f6d2df" : "#ee9cbc", V(x, 0.04, z).addScaledVector(dir, inner ? 0.02 : 0.03), q, inner ? [0.016, 0.01, 0.034] : [0.02, 0.011, 0.045], { grad: 0.3 });
      }
      b.add(petal(), "#f2c230", [x, 0.055, z], [0, 0, 0], 0.014);
    } else if (i < 3) {
      b.add(new THREE.TorusGeometry(pr * 1.7, 0.005, 3, 24), "#9fcfc8", [x, 0.017, z], [Math.PI / 2, 0, 0], 1, { grad: 0 });
    }
  }

  // Reeds and cattails at the edge.
  for (let c = 0; c < 2; c++) {
    const a = r() * TAU, [cx, cz] = edge(a, 0.86);
    for (let i = 0; i < 9; i++) {
      const h = 0.3 + r() * 0.42, x = cx + (r() - 0.5) * 0.2, z = cz + (r() - 0.5) * 0.2;
      b.add(blade(), jitter(r, pick(r, GRASS)), [x, 0, z], [(r() - 0.5) * 0.4, r() * TAU, (r() - 0.5) * 0.4], [0.014, h, 0.014], { grad: 0.4 });
      if (i < 3) {
        b.stick([x, 0, z], [x, h + 0.12, z], 0.005, "#5f8a34", { seg: 4, open: true });
        b.add(new THREE.CapsuleGeometry(0.022, 0.08, 2, 6), "#6b4428", [x, h + 0.09, z], [0, 0, 0], 1, { grad: 0.2 });
      }
    }
  }
  g.add(b.mesh());
  return { group: g, top: 0.02 };
}

// ---------- dock ----------
// Runs along z, centred on the origin. Posts reach down to y = -1 so it can stand in water past an island edge.
function dock(p, ctx) {
  const r = ctx.rand, L = num(p.length, 3), W = num(p.width, 1.1), H = 0.36, T = 0.05;
  const wood = p.color ?? "#9b7049", dark = shade(wood, -0.14), rope = "#d8c28e";
  const g = new THREE.Group(), b = new Batch();
  const n = Math.max(3, Math.round(L / 0.19)), pitch = L / n;
  for (let i = 0; i < n; i++)
    b.add(RB(W + (r() - 0.5) * 0.05, T, pitch - 0.024, 0.012), jitter(r, wood, 0.09), [(r() - 0.5) * 0.03, H - T / 2 + (r() - 0.5) * 0.008, -L / 2 + pitch * (i + 0.5)], [(r() - 0.5) * 0.03, (r() - 0.5) * 0.025, (r() - 0.5) * 0.03], 1, { grad: 0.15 });
  for (const sx of [-1, 1]) b.add(BX(0.07, 0.11, L - 0.04), dark, [sx * (W / 2 - 0.14), H - T - 0.055, 0], [0, 0, 0], 1, { grad: 0.3 });
  const np = Math.max(2, Math.round(L / 1.1) + 1);
  for (let k = 0; k < np; k++) {
    const z = lerp(-L / 2 + 0.07, L / 2 - 0.07, k / (np - 1)), end = k === 0 || k === np - 1;
    b.add(BX(W, 0.08, 0.08), dark, [0, H - T - 0.15, z]);
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 + 0.035), topY = H + (end ? 0.26 : 0.05), bot = -1;
      b.add(CY(0.062, 0.068, topY - bot, 9), jitter(r, shade(wood, -0.07), 0.06), [x, (topY + bot) / 2, z], [0, r() * 3, 0], 1, { grad: 0.55 });
      b.add(cached("cap", () => new THREE.SphereGeometry(1, 9, 2, 0, TAU, 0, Math.PI / 2)), shade(wood, 0.02), [x, topY, z], [0, 0, 0], [0.062, 0.03, 0.062]);
      if (k === np - 1) for (const yy of [0.1, 0.15]) b.add(new THREE.TorusGeometry(0.07, 0.017, 4, 10), jitter(r, rope, 0.04), [x, H + yy, z], [Math.PI / 2, 0, r()], 1, { grad: 0.2 });
    }
  }
  // A coil of rope on the deck near the far end.
  const cz = L / 2 - 0.35, cx = W / 2 - 0.28;
  for (const [rr, yy] of [[0.11, 0.015], [0.08, 0.035], [0.05, 0.05]]) b.add(new THREE.TorusGeometry(rr, 0.02, 4, 12), rope, [cx, H + yy, cz], [Math.PI / 2, 0, 0], 1, { grad: 0.3 });
  g.add(b.mesh());
  return { group: g, top: H };
}

// ---------- boat ----------
// Hull from a lower hemisphere: pinched bow (+z), flat transom (-z), fuller sections, rising sheer.
function hullPt(x, y, z, sheer) {
  const bow = Math.max(0, z);
  x *= 1 - 0.5 * Math.pow(bow, 1.5);
  if (z < -0.78) z = -0.78 + (z + 0.78) * 0.2;
  y = -Math.pow(Math.max(0, -y), 0.8);
  const rim = 1 + y;
  y += rim * (sheer * bow * bow + 0.05 * Math.max(0, -z));
  return [x, y, z];
}
function hullGeo(L, W, D, sheer) {
  const g = new THREE.SphereGeometry(1, 20, 7, 0, TAU, Math.PI / 2, Math.PI / 2);
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const [x, y, z] = hullPt(P.getX(i), P.getY(i), P.getZ(i), sheer);
    P.setXYZ(i, (x * W) / 2, y * D, (z * L) / 2);
  }
  g.computeVertexNormals();
  return g;
}
// Triangular sail between A (tack), B (clew) and C (head), billowing along x.
function sailGeo(A, B, C, bil, n = 6) {
  const pos = [], idx = [], row = [];
  let k = 0;
  for (let i = 0; i <= n; i++) {
    row.push(k);
    for (let j = 0; j <= n - i; j++, k++) {
      const u = j / n, v = i / n, w = 1 - u - v, bv = bil * 27 * u * v * w;
      pos.push(A[0] + u * (B[0] - A[0]) + v * (C[0] - A[0]) + bv, A[1] + u * (B[1] - A[1]) + v * (C[1] - A[1]), A[2] + u * (B[2] - A[2]) + v * (C[2] - A[2]));
    }
  }
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n - i; j++) {
      const a = row[i] + j, b = a + 1, c = row[i + 1] + j;
      idx.push(a, b, c);
      if (j < n - i - 1) idx.push(b, c + 1, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function boat(p, ctx) {
  const r = ctx.rand, sail = p.kind === "sail";
  const L = sail ? 2.4 : 2.0, W = sail ? 1.0 : 0.9, D = 0.36, sheer = 0.14, rim = D - 0.07; // hull sits 7 cm into the water
  const hullC = p.color ?? (sail ? "#2f5f8f" : "#c65b3c"), band = sail ? "#f3ecdc" : "#f1e3c4", inside = "#c99c68", trim = "#7a5235";
  const g = new THREE.Group(), b = new Batch(), b2 = new Batch();
  const rimY = (z) => { const zu = z / (L / 2), bow = Math.max(0, zu); return D * (sheer * bow * bow + 0.05 * Math.max(0, -zu)); };
  b.add(hullGeo(L, W, D, sheer), hullC, [0, rim, 0], [0, 0, 0], 1, { grad: 0.3, fn: (x, y, z) => (y > rimY(z) - 0.075 ? band : y > rimY(z) - 0.095 ? shade(hullC, -0.12) : hullC) });
  const IW = 0.85, IL = 0.9;
  b.add(flip(hullGeo(L * IL, W * IW, D * IW, sheer)), inside, [0, rim, 0], [0, 0, 0], 1, { grad: 0.45 });
  // Flat gunwale strip closing the gap between the skins, plus a rounded lip.
  const rp = (ph, sw, sl, sd) => { const [x, y, z] = hullPt(-Math.cos(ph), 0, Math.sin(ph), sheer); return [(x * W * sw) / 2, rim + y * D * sd, (z * L * sl) / 2]; };
  const strip = [], N = 40, lip = [];
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * TAU, a1 = ((i + 1) / N) * TAU;
    const o0 = rp(a0, 1, 1, 1), o1 = rp(a1, 1, 1, 1), i0 = rp(a0, IW, IL, IW), i1 = rp(a1, IW, IL, IW);
    strip.push(...o0, ...o1, ...i0, ...o1, ...i1, ...i0);
    lip.push(V(...rp(a0, 0.985, 0.99, 1)));
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.Float32BufferAttribute(strip, 3));
  b.add(sg, trim, [0, 0.004, 0], [0, 0, 0], 1, { grad: 0 });
  b.add(TUBE(lip, 0.026, 48, 6, true), trim, [0, 0, 0], [0, 0, 0], 1, { grad: 0.2 });
  // Thwarts sized to the inner hull.
  const halfW = (zu) => (W / 2) * IW * 0.97 * Math.sqrt(Math.max(0, 1 - zu * zu)) * (1 - 0.5 * Math.pow(Math.max(0, zu), 1.5));
  const seatY = rim - 0.08;
  for (const zu of sail ? [-0.5, 0.0] : [-0.5, 0.0, 0.5]) b.add(RB(halfW(zu) * 2, 0.04, 0.17, 0.012), jitter(r, "#a77c52", 0.05), [0, seatY, zu * IL * (L / 2)], [0, 0, 0], 1, { grad: 0.2 });
  if (!sail) {
    for (const sx of [-1, 1]) {
      const yaw = sx * 0.07, c = V(sx * 0.15, seatY + 0.045, 0.02), d = V(Math.sin(yaw), 0, Math.cos(yaw));
      b.add(CY(0.017, 0.017, 1.25, 7), "#b48a5a", c, qYX(yaw, Math.PI / 2), 1, { grad: 0 });
      b.add(RB(0.11, 0.014, 0.3, 0.006), "#b48a5a", c.clone().addScaledVector(d, -0.72), qYX(yaw), 1, { grad: 0 });
      b.add(CY(0.022, 0.022, 0.1, 7), "#6e4a2e", c.clone().addScaledVector(d, 0.6), qYX(yaw, Math.PI / 2), 1, { grad: 0 });
    }
  } else {
    const zm = 0.28 * (L / 2), top = 2.2, boomY = rim + 0.42, Lb = 0.45 * L, spar = "#8a6a48";
    b.add(CY(0.026, 0.034, top - (rim - D * 0.75), 8), spar, [0, (top + rim - D * 0.75) / 2, zm]);
    b.add(CY(0.022, 0.022, Lb, 8), spar, [0, boomY, zm - Lb / 2], [Math.PI / 2, 0, 0]);
    b.add(SP(8, 6), "#d8463a", [0, top + 0.02, zm], [0, 0, 0], 0.035);
    b.stick([0, top - 0.25, zm + 0.02], [0, rim + 0.06, (L / 2) * 0.97], 0.006, "#d9cdb2", { seg: 4, open: true });
    const sc = p.sail ?? "#f4eddc";
    b2.add(sailGeo([0, boomY + 0.03, zm - 0.04], [0, boomY + 0.03, zm - Lb + 0.04], [0, top - 0.06, zm - 0.04], 0.12), sc, [0, 0, 0], [0, 0, 0], 1, { grad: 0.12, fn: (x, y) => (Math.abs(y - (boomY + 0.45)) < 0.06 ? hullC : sc) });
    b2.add(sailGeo([0, rim + 0.12, (L / 2) * 0.9], [0.02, boomY - 0.02, zm + 0.12], [0, top - 0.3, zm + 0.05], 0.08), sc, [0, 0, 0], [0, 0, 0], 1, { grad: 0.12 });
    b2.add(sailGeo([0, top - 0.02, zm], [0, top - 0.06, zm - 0.24], [0, top + 0.1, zm], 0, 2), "#d8463a", [0, 0, 0], [0, 0, 0], 1, { grad: 0 });
    g.add(b2.mesh(true));
  }
  g.add(b.mesh());
  return { group: g, top: seatY + 0.02 };
}

// ---------- bridge ----------
// Spans along x so its arched profile faces +z (the viewer). `top` is the deck height at the crown.
function bridge(p, ctx) {
  const r = ctx.rand, L = num(p.length, 2.4), W = num(p.width, 0.9), A = clamp(0.16 * L, 0.22, 0.6), T = 0.05;
  const wood = p.color ?? "#a0724a", dark = shade(wood, -0.12);
  const y = (x) => 0.05 + A * (1 - Math.pow((2 * x) / L, 2)); // deck top
  const g = new THREE.Group(), b = new Batch();
  const n = Math.max(6, Math.round(L / 0.13)), pitch = L / n;
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + pitch * (i + 0.5), slope = Math.atan((-8 * A * x) / (L * L));
    b.add(BX(pitch - 0.022, T, W + (r() - 0.5) * 0.05), jitter(r, wood, 0.09), [x, y(x) - T / 2, (r() - 0.5) * 0.02], [0, 0, slope + (r() - 0.5) * 0.04], 1, { grad: 0.2 });
  }
  const segs = 10;
  for (const sz of [-1, 1])
    for (let i = 0; i < segs; i++) {
      const x0 = -L / 2 + (L * i) / segs, x1 = x0 + L / segs, xm = (x0 + x1) / 2;
      b.add(BX(Math.hypot(x1 - x0, y(x1) - y(x0)) + 0.012, 0.12, 0.07), dark, [xm, y(xm) - T - 0.06, sz * (W / 2 - 0.06)], [0, 0, Math.atan2(y(x1) - y(x0), x1 - x0)], 1, { grad: 0.3 });
    }
  const np = 5, rh = 0.55, x0 = -L / 2 + 0.08, x1 = L / 2 - 0.08;
  for (const sz of [-1, 1]) {
    const zz = sz * (W / 2 - 0.03);
    for (let k = 0; k < np; k++) {
      const x = lerp(x0, x1, k / (np - 1)), end = k === 0 || k === np - 1, base = y(x) - T, ph = rh + T + (end ? 0.06 : 0);
      if (end) {
        b.add(RB(0.085, ph, 0.085, 0.015), dark, [x, base + ph / 2, zz], [0, 0, 0], 1, { grad: 0.3 });
        b.add(SP(8, 6), wood, [x, base + ph + 0.025, zz], [0, 0, 0], 0.05);
      } else b.add(BX(0.06, ph, 0.06), dark, [x, base + ph / 2, zz], [0, 0, 0], 1, { grad: 0.3 });
    }
    const top = [], mid = [];
    for (let i = 0; i <= 8; i++) {
      const x = lerp(x0, x1, i / 8);
      top.push(V(x, y(x) + rh - 0.01, zz));
      mid.push(V(x, y(x) + rh * 0.5, zz));
    }
    b.add(TUBE(top, 0.03, 20, 6), wood, [0, 0, 0], [0, 0, 0], 1, { grad: 0.1 });
    b.add(TUBE(mid, 0.018, 16, 5), shade(wood, -0.05), [0, 0, 0], [0, 0, 0], 1, { grad: 0.1 });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const s = 0.2 + r() * 0.06;
    b.add(stone(r), jitter(r, pick(r, GREYS), 0.08), [sx * (L / 2 - 0.05), s * 0.12, sz * (W / 2 + 0.06)], [0, r() * TAU, 0], [s * 0.6, s * 0.4, s * 0.5], { grad: 0.4 });
  }
  g.add(b.mesh());
  return { group: g, top: y(0) };
}

// ---------- fountain ----------
function fountain(p, ctx) {
  const r = ctx.rand, R = 0.85, stoneC = p.color ?? "#c4baa8";
  const g = new THREE.Group(), b = new Batch();
  b.add(LA([[R + 0.14, 0], [R + 0.14, 0.05], [R + 0.02, 0.07], [R, 0.1], [R - 0.02, 0.36], [R - 0.13, 0.36], [R - 0.13, 0.12], [0.001, 0.12]], 32), stoneC, [0, 0, 0], [0, 0, 0], 1, { grad: 0.35 });
  const nc = 14, arc = (TAU * (R - 0.065)) / nc;
  for (let i = 0; i < nc; i++) {
    const a = (i / nc) * TAU;
    b.add(RB(arc * 0.94, 0.08, 0.19, 0.025), jitter(r, stoneC, 0.07), [Math.cos(a) * (R - 0.065), 0.4, Math.sin(a) * (R - 0.065)], [0, Math.PI / 2 - a + (r() - 0.5) * 0.04, 0], 1, { grad: 0.3 });
  }
  b.add(LA([[0.2, 0.1], [0.2, 0.18], [0.13, 0.24], [0.1, 0.32], [0.085, 0.7], [0.12, 0.76], [0.14, 0.8]], 16), shade(stoneC, -0.03), [0, 0, 0], [0, 0, 0], 1, { grad: 0.3 });
  b.add(LA([[0.06, 0.78], [0.2, 0.8], [0.34, 0.9], [0.4, 0.96], [0.39, 1.0], [0.34, 0.995], [0.3, 0.95], [0.001, 0.95]], 24), stoneC, [0, 0, 0], [0, 0, 0], 1, { grad: 0.3 });
  b.add(LA([[0.07, 0.95], [0.08, 1.0], [0.05, 1.06], [0.065, 1.12], [0.06, 1.16], [0.03, 1.2], [0.001, 1.22]], 12), shade(stoneC, 0.03), [0, 0, 0], [0, 0, 0], 1, { grad: 0.2 });
  g.add(b.mesh());

  // Water in both basins.
  const deep = new THREE.Color("#2f7f8c"), light = new THREE.Color("#6fb5b2");
  const pool = (rad, yy, n, rings) => radialGeo(n, rings, (t, a) => [Math.cos(a) * rad * t, yy, Math.sin(a) * rad * t], (t) => _c.copy(deep).lerp(light, t * t));
  g.add(merged([pool(R - 0.13, 0.31, 36, 3), pool(0.33, 0.975, 20, 2)], waterMat()));

  // Spout, little arcs into the top bowl, and streams spilling over its lip.
  const jets = [CY(0.012, 0.018, 0.12, 8).translate(0, 1.27, 0), SP(8, 5).scale(0.03, 0.022, 0.03).translate(0, 1.335, 0)];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU, c = Math.cos(a), s = Math.sin(a);
    jets.push(TUBE([[0, 1.33, 0], [c * 0.09, 1.37, s * 0.09], [c * 0.19, 1.25, s * 0.19], [c * 0.25, 0.98, s * 0.25]], 0.007, 10, 4));
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + 0.2, c = Math.cos(a), s = Math.sin(a);
    jets.push(TUBE([[c * 0.395, 0.995, s * 0.395], [c * 0.46, 0.85, s * 0.46], [c * 0.51, 0.6, s * 0.51], [c * 0.53, 0.31, s * 0.53]], 0.011, 10, 5));
  }
  g.add(merged(jets, streamMat()));
  const drops = [];
  for (let i = 0; i < 70; i++) {
    const a = r() * TAU, top = i < 20;
    const rr = top ? 0.05 + r() * 0.2 : 0.48 + r() * 0.12, yy = top ? 1.0 + r() * 0.4 : 0.33 + r() * 0.14;
    drops.push(Math.cos(a) * rr, yy, Math.sin(a) * rr);
  }
  g.add(points(drops, 0.018, "#e6f6f8", false, 0.9));
  return { group: g, top: 0.44 };
}

// ---------- campfire ----------
function flameGeo(rr, h, seed) {
  const g = LA([[0.001, 0], [rr * 0.8, h * 0.1], [rr, h * 0.28], [rr * 0.78, h * 0.5], [rr * 0.4, h * 0.76], [0.001, h]], 9);
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), t = y / h, a = t * 1.8 + seed, c = Math.cos(a), s = Math.sin(a);
    P.setXYZ(i, x * c - z * s + Math.sin(t * 3 + seed) * rr * 0.45 * t, y, x * s + z * c + Math.cos(t * 2.3 + seed) * rr * 0.3 * t);
  }
  g.computeVertexNormals();
  return g;
}
function campfire(p, ctx) {
  const r = ctx.rand, dark = isDark(ctx.time);
  const g = new THREE.Group(), b = new Batch();
  b.add(radialGeo(18, 1, (t, a) => [Math.cos(a) * 0.36 * t, 0, Math.sin(a) * 0.36 * t]), "#3a302a", [0, 0.006, 0], [0, 0, 0], 1, { grad: 0 });
  const ns = 10;
  for (let i = 0; i < ns; i++) {
    const a = (i / ns) * TAU + r() * 0.2, sz = 0.14 + r() * 0.05;
    b.add(stone(r), jitter(r, pick(r, GREYS), 0.07), [Math.cos(a) * 0.4, sz * 0.2, Math.sin(a) * 0.4], [(r() - 0.5) * 0.5, r() * TAU, (r() - 0.5) * 0.5], [sz * 0.6, sz * 0.45, sz * 0.55], { grad: 0.45 });
  }
  // Teepee of logs, charred toward the top, plus two lying across the base.
  const bark = "#5c3b25", charred = "#2b201a";
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.3, c = Math.cos(a), s = Math.sin(a);
    b.stick([c * 0.24, 0.0, s * 0.24], [c * 0.03, 0.42, s * 0.03], 0.034, bark, { seg: 7, grad: 0, fn: (x, y) => (y > 0.06 ? charred : jitter(r, bark, 0.06)), r2: 0.024 });
  }
  for (const [yaw, zz] of [[0.5, 0.06], [-0.9, -0.05]]) b.add(CY(0.045, 0.045, 0.56, 9), jitter(r, bark, 0.06), [0, 0.045, zz], qYX(yaw, Math.PI / 2), 1, { grad: 0.3, fn: (x, y) => (Math.abs(y) > 0.25 ? "#a7825a" : null) });
  g.add(b.mesh());

  // Embers and layered flames: wide yellow core, tall orange body, red tongues leaning out.
  const embers = [];
  for (let i = 0; i < 8; i++) {
    const a = r() * TAU, rr = 0.06 + r() * 0.2;
    embers.push(SP(6, 4).scale(0.03, 0.018, 0.03).translate(Math.cos(a) * rr, 0.02, Math.sin(a) * rr));
  }
  g.add(merged(embers, glowMat("#ff5a1a", 2.5)));
  const yellow = [flameGeo(0.14, 0.3, 0).translate(0, 0.04, 0)];
  const orange = [flameGeo(0.1, 0.66, 1.3).translate(0, 0.06, 0)];
  const red = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + r() * 0.4, h = 0.26 + r() * 0.2;
    const f = flameGeo(0.055, h, r() * 6).rotateZ(-0.35).rotateY(-a).translate(Math.cos(a) * 0.08, 0.06, Math.sin(a) * 0.08);
    (i % 2 ? red : orange).push(f);
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.5;
    yellow.push(flameGeo(0.05, 0.4, i * 2).translate(Math.cos(a) * 0.05, 0.08, Math.sin(a) * 0.05));
  }
  g.add(merged(yellow, glowMat("#ffd75e", 4.5)));
  g.add(merged(orange, glowMat("#ff8f26", 3.6)));
  g.add(merged(red, glowMat("#ff4f1c", 3)));
  const sparks = [];
  for (let i = 0; i < 28; i++) {
    const h = 0.55 + Math.pow(r(), 0.7) * 0.8, a = r() * TAU, rr = 0.04 + (h - 0.5) * 0.25 * r();
    sparks.push(Math.cos(a) * rr, h, Math.sin(a) * rr);
  }
  g.add(points(sparks, 0.022, new THREE.Color(3, 1.5, 0.4)));
  g.add(points([0, 0.3, 0], 0.9, new THREE.Color(1, 0.45, 0.12).multiplyScalar(dark ? 0.9 : 0.5)));
  ctx.addLight([0, 0.4, 0], "#ff8c3a", dark ? 6 : 2.2, 5);
  return { group: g };
}

// ---------- tent ----------
function tent(p, ctx) {
  const r = ctx.rand, c = p.color ?? "#d9773b", W = 1.6, D = 1.9, H = 1.2, T = 0.04;
  const g = new THREE.Group(), b = new Batch(), b2 = new Batch();
  const slant = Math.hypot(W / 2, H), ang = Math.atan2(H, W / 2);
  b.add(RB(W + 0.24, 0.025, D + 0.16, 0.01), "#5f6450", [0, 0.0125, 0], [0, 0, 0], 1, { grad: 0 });
  for (const sx of [-1, 1]) {
    const n = V(sx * Math.sin(ang), Math.cos(ang), 0).multiplyScalar(T / 2);
    b.add(RB(slant + 0.06, T, D + 0.1, 0.018), c, [sx * (W / 4) + n.x, H / 2 + n.y, 0], [0, 0, -sx * ang], 1, { grad: 0, fn: (x) => _t.set(c).offsetHSL(0, 0, -0.08 * (sx * x / slant + 0.5)).getHex() });
  }
  b.add(CY(0.03, 0.03, D + 0.12, 8), shade(c, -0.16), [0, H + 0.02, 0], [Math.PI / 2, 0, 0], 1, { grad: 0 });
  const tri = (x0, x1, apexX, h) => new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(x0, 0), new THREE.Vector2(x1, 0), new THREE.Vector2(apexX, h)]));
  b2.add(tri(-W / 2, W / 2, 0, H), shade(c, -0.04), [0, 0, -D / 2 + 0.03], [0, 0, 0], 1, { grad: 0.2 });
  // Front: dark doorway with the two flaps tied back.
  b2.add(tri(-W / 2 + 0.04, W / 2 - 0.04, 0, H - 0.04), "#2d221c", [0, 0, D / 2 - 0.08], [0, 0, 0], 1, { grad: 0 });
  const door = 0.3;
  b2.add(tri(-W / 2, -door, 0, H), shade(c, 0.05), [0, 0, D / 2 + 0.01], [0, 0, 0], 1, { grad: 0.2 });
  b2.add(tri(door, W / 2, 0, H), shade(c, 0.05), [0, 0, D / 2 + 0.01], [0, 0, 0], 1, { grad: 0.2 });
  for (const sx of [-1, 1]) {
    b.stick([sx * door, 0.02, D / 2 + 0.03], [0, H - 0.02, D / 2 + 0.03], 0.022, shade(c, -0.1), { seg: 6 });
    b.add(SP(6, 4), "#e9dcc0", [sx * door * 0.55, H * 0.45, D / 2 + 0.05], [0, 0, 0], 0.025);
  }
  // Poles, guy ropes and pegs.
  const pole = "#8a6a48", rope = "#e2d6b8";
  for (const sz of [-1, 1]) {
    const z = sz * (D / 2 + 0.07), peg = sz * (D / 2 + 0.6);
    b.add(CY(0.02, 0.02, H + 0.12, 6), pole, [0, (H + 0.12) / 2, z]);
    b.add(SP(6, 4), pole, [0, H + 0.13, z], [0, 0, 0], 0.03);
    b.stick([0, H + 0.08, z], [0, 0.03, peg], 0.006, rope, { seg: 4, open: true });
    b.add(CY(0.014, 0.008, 0.1, 5), "#cfcfc8", [0, 0.03, peg]);
    for (const sx of [-1, 1]) {
      b.stick([sx * W * 0.32, H * 0.36, z * 0.45], [sx * (W / 2 + 0.4), 0.03, z * 0.6], 0.005, rope, { seg: 4, open: true });
      b.add(CY(0.014, 0.008, 0.1, 5), "#cfcfc8", [sx * (W / 2 + 0.4), 0.03, z * 0.6]);
    }
  }
  g.add(b.mesh(), b2.mesh(true));
  return { group: g, top: H };
}

// ---------- picnic blanket ----------
function picnicBlanket(p, ctx) {
  const r = ctx.rand, [w, d] = pair(p.size, [1.6, 1.3]), s0 = r() * 10;
  const geo = new THREE.PlaneGeometry(w, d, 18, 14);
  geo.rotateX(-Math.PI / 2);
  const P = geo.attributes.position, UV = geo.attributes.uv, check = 0.75; // metres per texture repeat (4 checks)
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), z = P.getZ(i);
    const e = Math.min(1 - Math.abs((2 * x) / w), 1 - Math.abs((2 * z) / d));
    const wr = 0.007 * Math.sin(x * 6 + s0) * Math.sin(z * 5 + s0 * 1.3) + 0.004 * Math.sin(x * 13 - z * 9 + s0);
    P.setY(i, 0.004 + clamp(e / 0.08, 0, 1) * (0.01 + wr));
    UV.setXY(i, (x + w / 2) / check, (z + d / 2) / check);
  }
  geo.computeVertexNormals();
  const g = new THREE.Group(), b = new Batch(), hem = shade(p.color ?? "#c8312f", -0.05);
  g.add(new THREE.Mesh(geo, mat("#ffffff", { map: checkTex(p.color ?? "#c8312f", "#f7f1e6", 8), rough: 0.95, side: THREE.DoubleSide })));
  // A rolled hem so it reads as thick cloth rather than a decal.
  for (const sz of [-1, 1]) b.add(RB(w + 0.03, 0.02, 0.03, 0.009), hem, [0, 0.01, (sz * d) / 2], [0, 0, 0], 1, { grad: 0.2 });
  for (const sx of [-1, 1]) b.add(RB(0.03, 0.02, d, 0.009), hem, [(sx * w) / 2, 0.01, 0], [0, 0, 0], 1, { grad: 0.2 });
  g.add(b.mesh());
  return { group: g, top: 0.015 };
}

// ---------- beach umbrella ----------
function beachUmbrella(p, ctx) {
  const r = ctx.rand, [c1, c2] = Array.isArray(p.stripes) && p.stripes.length >= 2 ? p.stripes : ["#e2483d", "#f6efe0"];
  const R = 1.0, apex = 0.32, poleTop = 1.95;
  const g = new THREE.Group(), k = new THREE.Group(), b = new Batch(), b2 = new Batch();
  k.rotation.set(0.1, 0, 0.08);
  g.add(k);
  b.add(CY(0.024, 0.024, poleTop + 0.2, 8), "#efe7d6", [0, poleTop / 2 - 0.1, 0], [0, 0, 0], 1, { grad: 0.2, fn: (x, y) => (Math.abs(y + 0.35) < 0.04 ? c1 : null) });
  // Canopy: eight panels sagging between the ribs, coloured per panel.
  const cg = radialGeo(32, 4, (t, a) => {
    const rib = Math.abs(Math.cos(4 * a));
    return [Math.cos(a) * R * t * (0.94 + 0.06 * rib), apex * (1 - Math.pow(t, 1.25)) - 0.05 * t * (1 - rib), Math.sin(a) * R * t * (0.94 + 0.06 * rib)];
  }).toNonIndexed();
  const P = cg.attributes.position, col = new Float32Array(P.count * 3), A = new THREE.Color(c1), B = new THREE.Color(c2);
  for (let i = 0; i < P.count; i += 3) {
    const cx = P.getX(i) + P.getX(i + 1) + P.getX(i + 2), cz = P.getZ(i) + P.getZ(i + 1) + P.getZ(i + 2);
    const panel = Math.floor((((Math.atan2(cz, cx) + TAU) % TAU) / TAU) * 8) % 2, c = panel ? A : B;
    for (let j = 0; j < 3; j++) col.set([c.r, c.g, c.b], (i + j) * 3);
  }
  cg.setAttribute("color", new THREE.BufferAttribute(col, 3));
  b2.add(cg, null, [0, poleTop - apex, 0], [0, 0, 0], 1, { grad: 0.12 });
  b.add(SP(8, 6), c1, [0, poleTop + 0.03, 0], [0, 0, 0], 0.045);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    b.add(SP(6, 4), i % 2 ? c2 : c1, [Math.cos(a) * R, poleTop - apex - 0.03, Math.sin(a) * R], [0, 0, 0], 0.028);
  }
  k.add(b.mesh(), b2.mesh(true));
  return { group: g };
}

// ---------- surfboard ----------
// Lying flat along x by default; `upright: true` (or pose: "upright") stands it nose-up in the sand, deck to +z.
function surfboard(p, ctx) {
  const r = ctx.rand, c = p.color ?? "#3aa6c4", L = 2.0, Wd = 0.56, T = 0.07;
  const upright = p.upright === true || p.pose === "upright" || p.pose === "stand";
  // Sphere with its poles at nose and tail, so the deck has a clean centre line for a crisp stripe.
  const geo = SP(16, 24).rotateX(Math.PI / 2);
  const P = geo.attributes.position, ang = new Float32Array(P.count);
  for (let i = 0; i < P.count; i++) ang[i] = Math.abs(Math.atan2(P.getX(i), P.getY(i)));
  geo.setAttribute("ang", new THREE.BufferAttribute(ang, 1));
  for (let i = 0; i < P.count; i++) {
    let x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    x *= z > 0 ? 1 - 0.5 * z * z : 1 - 0.15 * z * z;
    if (z < -0.94) z = -0.94 + (z + 0.94) * 0.3;
    P.setXYZ(i, (x * Wd) / 2, (y * T) / 2 + 0.07 * Math.pow(Math.max(0, z), 4), (z * L) / 2);
  }
  geo.computeVertexNormals();
  // Stripe = the two face columns either side of the deck's centre line.
  const flat = geo.toNonIndexed(), A = flat.attributes.ang, col = new Float32Array(A.count * 3);
  const C = new THREE.Color(c), S = new THREE.Color("#f6f1e6");
  for (let i = 0; i < A.count; i += 3) {
    const k = Math.max(A.getX(i), A.getX(i + 1), A.getX(i + 2)) < 0.4 ? S : C;
    for (let j = 0; j < 3; j++) col.set([k.r, k.g, k.b], (i + j) * 3);
  }
  flat.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const b = new Batch();
  b.add(flat, null, [0, 0, 0], [0, 0, 0], 1, { grad: 0.25 });
  b.add(RB(0.012, 0.12, 0.14, 0.005), shade(c, -0.2), [0, -0.07, -L / 2 + 0.16], [0.3, 0, 0], 1, { grad: 0 });
  const g = new THREE.Group(), inner = new THREE.Group();
  inner.add(b.mesh());
  if (upright) {
    const o = new THREE.Group();
    inner.rotation.x = -Math.PI / 2;
    o.add(inner);
    o.rotation.set(0, Math.PI, (r() - 0.5) * 0.15);
    o.position.y = L / 2 - 0.3;
    g.add(o);
    // A little heap of sand where it is stuck in.
    const s = new Batch();
    for (let i = 0; i < 4; i++) s.add(stone(r), jitter(r, "#dfc28c", 0.04), [(r() - 0.5) * 0.3, 0.01, (r() - 0.5) * 0.12], [0, r() * TAU, 0], [0.16, 0.06, 0.12], { grad: 0.2 });
    g.add(s.mesh());
  } else {
    inner.rotation.y = Math.PI / 2;
    inner.position.y = T / 2;
    g.add(inner);
  }
  return { group: g, top: upright ? 0 : T };
}

// ---------- sandcastle ----------
function sandcastle(p, ctx) {
  const r = ctx.rand, sand = p.color ?? "#e2c48c", wet = shade(sand, -0.12);
  const g = new THREE.Group(), b = new Batch();
  const J = () => jitter(r, sand, 0.05);
  b.add(new THREE.TorusGeometry(0.62, 0.07, 6, 28), wet, [0, 0, 0], [Math.PI / 2, 0, 0], [1, 1, 0.3], { grad: 0 });
  b.add(lumpy(new THREE.SphereGeometry(1, 16, 8), 0.06, 2), sand, [0, 0, 0], [0, 0, 0], [0.55, 0.12, 0.55], { grad: 0.2 });
  b.add(RB(0.52, 0.26, 0.52, 0.03), J(), [0, 0.2, 0], [0, 0, 0], 1, { grad: 0.2 });
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    const a = (i * Math.PI) / 2, along = (j - 1) * 0.13, c = Math.cos(a), s = Math.sin(a);
    b.add(BX(0.06, 0.06, 0.05), J(), [c * 0.235 - s * along, 0.355, s * 0.235 + c * along], [0, -a, 0], 1, { grad: 0.2 });
  }
  const tower = (x, z, rB, rT, h, y0) => {
    b.add(CY(rT, rB, h, 12), J(), [x, y0 + h / 2, z], [0, r() * TAU, 0], 1, { grad: 0.25 });
    b.add(new THREE.TorusGeometry((rB + rT) / 2 + 0.004, 0.01, 3, 12), J(), [x, y0 + h * 0.5, z], [Math.PI / 2, 0, 0], 1, { grad: 0 });
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU;
      b.add(BX(0.045, 0.05, 0.035), J(), [x + Math.cos(a) * rT * 0.8, y0 + h + 0.02, z + Math.sin(a) * rT * 0.8], [0, -a, 0], 1, { grad: 0.2 });
    }
    b.add(BX(0.03, 0.05, 0.01), "#9c7a4c", [x, y0 + h * 0.7, z + rT * 0.98], [0, 0, 0], 1, { grad: 0 });
  };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) tower(sx * 0.27, sz * 0.27, 0.115, 0.095, 0.38, 0.07);
  tower(0, 0, 0.13, 0.11, 0.26, 0.33);
  b.add(new THREE.ConeGeometry(0.1, 0.16, 12), J(), [0, 0.67, 0], [0, 0, 0], 1, { grad: 0.2 });
  b.add(new THREE.CircleGeometry(0.075, 10, 0, Math.PI), "#8a6a42", [0, 0.08, 0.262], [0, 0, 0], 1, { grad: 0 });
  b.add(CY(0.005, 0.005, 0.22, 4), "#8a6a48", [0, 0.82, 0]);
  b.add(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.12, -0.035), new THREE.Vector2(0, -0.07)])), "#e04a3a", [0.004, 0.93, 0], [0, 0, 0], 1, { grad: 0 });
  // Bucket tipped on its side, a spade and two shells.
  b.add(LA([[0.001, 0], [0.07, 0], [0.09, 0.15], [0.095, 0.16], [0.085, 0.16], [0.067, 0.012]], 14), "#e04a3a", [0.6, 0.09, 0.38], [0, 0, Math.PI / 2 + 0.1], 1, { grad: 0.2 });
  b.add(new THREE.TorusGeometry(0.09, 0.006, 4, 12, Math.PI), "#f2c230", [0.53, 0.09, 0.38], [0, Math.PI / 2, -0.2], 1, { grad: 0 });
  b.add(CY(0.012, 0.012, 0.28, 6), "#f2c230", [-0.55, 0.02, 0.4], qYX(0.6, Math.PI / 2), 1, { grad: 0 });
  b.add(RB(0.11, 0.014, 0.13, 0.006), "#3a8fd0", [-0.55 - Math.sin(0.6) * 0.19, 0.012, 0.4 - Math.cos(0.6) * 0.19], qYX(0.6), 1, { grad: 0 });
  for (const [x, z] of [[0.35, 0.7], [-0.2, 0.72]]) b.add(new THREE.SphereGeometry(1, 8, 4, 0, TAU, 0, Math.PI / 2), "#f1c6b4", [x, 0, z], [0, r() * TAU, 0], [0.04, 0.025, 0.035], { grad: 0.3, fn: (x2) => (Math.abs(Math.sin(x2 * 9)) > 0.8 ? "#d99a88" : null) });
  g.add(b.mesh());
  return { group: g, top: 0.33 };
}

// ---------- hill ----------
function hill(p, ctx) {
  const r = ctx.rand, R = num(p.size, 3) / 2, Hh = num(p.height, 0.8), s0 = r() * 10, f = outline(s0, 0.8);
  const base = p.color ?? "#5d9440", dark = new THREE.Color(shade(base, -0.08)), light = new THREE.Color(shade(base, 0.1));
  const hAt = (t, a) => (t >= 1 ? -0.03 : Hh * Math.pow(1 - t * t, 1.6) * (1 + 0.05 * Math.sin(a * 4 + s0) * t) + Hh * 0.03 * Math.sin(a * 5 + s0) * Math.sin(t * Math.PI));
  const at = (t, a) => [Math.cos(a) * R * f(a) * t * (t >= 1 ? 1.03 : 1), hAt(t, a), Math.sin(a) * R * f(a) * t * (t >= 1 ? 1.03 : 1)];
  const b = new Batch();
  b.add(radialGeo(40, 10, at, (t, a) => _c.copy(dark).lerp(light, Math.pow(1 - t, 0.8) * 0.8 + 0.2 * (0.5 + 0.5 * Math.sin(a * 3 + t * 6 + s0)))), null, [0, 0, 0], [0, 0, 0], 1, { grad: 0 });
  const onHill = (t, a, lift = 0) => { const q = at(t, a); return V(q[0], q[1] + lift, q[2]); };
  const tufts = Math.round(12 + R * R * 6);
  for (let i = 0; i < tufts; i++) {
    const c = onHill(0.15 + r() * 0.8, r() * TAU);
    for (let k = 0; k < 5; k++) {
      const a = r() * TAU;
      b.add(blade(), jitter(r, pick(r, GRASS)), [c.x + Math.cos(a) * 0.03, c.y - 0.01, c.z + Math.sin(a) * 0.03], [Math.sin(a) * 0.4, r() * TAU, Math.cos(a) * 0.4], [0.02, 0.1 + r() * 0.1, 0.02], { grad: 0.45 });
    }
  }
  const fl = hexes(p.flowers, ["#f6f1e6", "#f2c230", "#e86a8a"]);
  for (let i = 0; i < 18; i++) daisy(b, r, onHill(0.1 + r() * 0.8, r() * TAU, 0.035), pick(r, fl), 0.08);
  for (let i = 0; i < 2; i++) {
    const s = 0.2 + r() * 0.12, c = onHill(0.55 + r() * 0.3, r() * TAU);
    b.add(stone(r), jitter(r, pick(r, GREYS), 0.08), [c.x, c.y + s * 0.08, c.z], [0, r() * TAU, 0], [s * 0.6, s * 0.4, s * 0.5], { grad: 0.4 });
  }
  const g = new THREE.Group();
  g.add(b.mesh());
  return { group: g, top: Hh };
}

// ---------- flower bed ----------
function flowerBed(p, ctx) {
  const r = ctx.rand, [w, d] = pair(p.size, [1.4, 0.6]);
  const fl = hexes(p.flowers, ["#e2475a", "#f4c542", "#f3efe6", "#a764c9"]);
  const wood = p.color ?? "#8b6443", bh = 0.13, bt = 0.05;
  const g = new THREE.Group(), b = new Batch();
  for (const sz of [-1, 1]) b.add(RB(w, bh, bt, 0.012), jitter(r, wood, 0.06), [0, bh / 2, sz * (d / 2 - bt / 2)], [0, 0, 0], 1, { grad: 0.3 });
  for (const sx of [-1, 1]) b.add(RB(bt, bh, d - 2 * bt, 0.012), jitter(r, wood, 0.06), [sx * (w / 2 - bt / 2), bh / 2, 0], [0, 0, 0], 1, { grad: 0.3 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(BX(0.07, 0.17, 0.07), shade(wood, -0.08), [sx * (w / 2 - 0.03), 0.085, sz * (d / 2 - 0.03)], [0, 0, 0], 1, { grad: 0.3 });
  const iw = w - 2 * bt, id = d - 2 * bt;
  b.add(RB(iw, 0.1, id, 0.03), "#4a3426", [0, 0.06, 0], [0, 0, 0], 1, { grad: 0.2 });
  // Leafy mounds on a jittered grid, then flower heads poking out of them.
  const leaf = cached("bedleaf", () => lumpy(SP(7, 5), 0.12, 3));
  const sp = Math.max(0.15, Math.sqrt((iw * id) / 30)), cols = Math.max(2, Math.round(iw / sp)), rows = Math.max(1, Math.round(id / sp));
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = -iw / 2 + (iw * (i + 0.5 + (r() - 0.5) * 0.4)) / cols, z = -id / 2 + (id * (j + 0.5 + (r() - 0.5) * 0.4)) / rows, s = sp * (0.68 + r() * 0.22);
    b.add(leaf, jitter(r, pick(r, GRASS.slice(0, 3)), 0.06), [x, 0.12, z], [0, r() * TAU, 0], [s, s * 0.65, s], { grad: 0.45 });
  }
  const star = cached("star", () => radialGeo(10, 1, (t, a) => { const rr = t * (0.55 + 0.45 * Math.abs(Math.cos(2.5 * a))); return [Math.cos(a) * rr, t === 0 ? 0.25 : 0.12 * rr * rr, Math.sin(a) * rr]; }));
  const ball = cached("ball", () => SP(5, 4));
  const n = clamp(Math.round(iw * id * 110), 12, 110);
  for (let i = 0; i < n; i++) {
    const x = (r() - 0.5) * (iw - 0.05), z = (r() - 0.5) * (id - 0.05), y = 0.19 + r() * 0.06, c = pick(r, fl);
    if (r() < 0.7) {
      const s = 0.042 + r() * 0.014;
      b.add(star, jitter(r, c, 0.05), [x, y, z], [(r() - 0.5) * 0.5, r() * TAU, (r() - 0.5) * 0.5], s, { grad: 0, fn: (x2, y2) => (y2 > 0.2 ? (String(c).toLowerCase() === "#f4c542" ? "#e07a22" : "#f2c230") : null) });
    } else b.add(ball, jitter(r, c, 0.08), [x, y + 0.01, z], [0, 0, 0], 0.032 + r() * 0.01, { grad: 0.35 });
  }
  g.add(b.mesh());
  return { group: g, top: 0.15 };
}

export const parts = {
  pond,
  dock,
  boat,
  bridge,
  fountain,
  campfire,
  tent,
  "picnic-blanket": picnicBlanket,
  "beach-umbrella": beachUmbrella,
  surfboard,
  sandcastle,
  hill,
  "flower-bed": flowerBed,
};
