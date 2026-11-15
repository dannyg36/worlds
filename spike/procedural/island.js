// Island terrain and layout: plots on a ring, a winding path, an organic flat-topped island with clay strata,
// a beach, a stylised sea and a round wooden plinth. See ISLAND.md for the spec.
// buildIsland(spec, { rand, time }) -> { group, radius, plots, path, landmark, isFree, heightAt }
import * as THREE from "three";
import { mat, canvasTex, cachedTex } from "./core.js";
import { surfaceTex } from "./surfaces.js";

const TAU = Math.PI * 2;
const SIZES = { small: 2.0, medium: 2.6, large: 3.2 };
const GAP = 0.9; // min gap between plot circles
const PATH_HALF = 0.45;
const PATH_OFF = 0.3; // path centreline sits this far outside the plot circle, so its inner edge is just inside it
const LANDMARK_R = 1.6;
const PLOT_EDGE = 0.95; // flat top reaches at least this far beyond every plot circle
const PATH_EDGE = 1.25; // ...and this far beyond the path centreline
const WOBBLE = 0.08; // island outline noise (fraction of radius)
const SEA_Y = -0.74;
const FLOOR_Y = -1.0;

// Height profile beyond the flat top's edge: [distance past the edge, y, jitter amount]. Rows are shared between bands.
const PROFILE = [
  [0, 0, 0],
  [0.05, -0.035, 0],
  [0.09, -0.09, 0.03], // lip / topsoil boundary
  [0.16, -0.15, 0.04],
  [0.13, -0.22, 0.04],
  [0.21, -0.3, 0.05],
  [0.19, -0.38, 0.05],
  [0.27, -0.45, 0.05],
  [0.25, -0.52, 0.05],
  [0.33, -0.57, 0.05],
  [0.38, -0.62, 0.06], // cliff foot / beach
  [0.6, -0.645, 0.12],
  [0.9, -0.7, 0.16],
  [1.15, -0.77, 0.18], // waterline is around here
  [1.5, -0.88, 0.18],
  [1.95, -0.97, 0.14],
];
// Bands: [first row, last row, colour key]
const BANDS = [
  [0, 2, "lip"],
  [2, 4, "s0"],
  [4, 6, "s1"],
  [6, 8, "s2"],
  [8, 10, "s3"],
  [10, 13, "beach"],
  [13, 15, "wet"],
];

const BIOMES = {
  meadow: { top: ["#86b553", "#6ea446", "#9cc463"], lip: "#5f9a3e", beach: "#e6d09a", wet: "#b49a6a", strata: ["#5b3f2c", "#a4723f", "#c08a52", "#7d5236"], path: "dirt", dirt: ["#a98159", "#8e6a46"] },
  autumn: { top: ["#c99a43", "#d4843a", "#b98d3d"], lip: "#9a6e2c", beach: "#e3c995", wet: "#ad9265", strata: ["#5a3b2a", "#9c5f34", "#c07a45", "#74452d"], path: "dirt", dirt: ["#9f7550", "#86603f"] },
  snow: { top: ["#f3f6fb", "#dde6f4", "#c3d1ea"], lip: "#e8eef8", beach: "#e3eaf5", wet: "#9fb0c8", strata: ["#e2e9f4", "#7d828d", "#5f6270", "#949aa6"], path: "snow", dirt: ["#e9eef7", "#cdd8ea"] },
  beach: { top: ["#ecd7a2", "#e2c88e", "#a7c46d"], lip: "#d9bf86", beach: "#f2e2b6", wet: "#c6aa76", strata: ["#c99c62", "#ddb67e", "#b9864f", "#cfa36b"], path: "sand", dirt: ["#d5b781", "#c4a370"] },
  desert: { top: ["#e3b877", "#d4a160", "#ecc78f"], lip: "#cf9b5c", beach: "#ebd09c", wet: "#c4a070", strata: ["#b5653c", "#d08b52", "#a1512f", "#dba266"], path: "sand", dirt: ["#c99a63", "#b98a55"] },
  city: { top: ["#7aa94f", "#6b9a45", "#b4afa6"], lip: "#5e8d3e", beach: "#9d988f", wet: "#6f6c68", strata: ["#6f6a63", "#8b857b", "#5d5852", "#9a9286"], path: "cobble", dirt: ["#8f8a82", "#7b766f"] },
};

// ---------- small noise helpers (all seeded) ----------
function noise2(rand) {
  const N = 64, g = new Float32Array(N * N).map(() => rand());
  const v = (i, j) => g[(((j % N) + N) % N) * N + (((i % N) + N) % N)];
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), tx = s(x - x0), ty = s(y - y0);
    const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * tx;
    const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
}
// Periodic noise around a circle, in [-1, 1].
function ringNoise(rand, ks) {
  const t = ks.map((k) => [k, rand() * TAU, (0.5 + rand()) / k]);
  const norm = t.reduce((s, x) => s + x[2], 0);
  return (a) => t.reduce((s, [k, p, w]) => s + w * Math.sin(k * a + p), 0) / norm;
}
const col = (hex) => new THREE.Color(hex);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// Fine grey speckle that multiplies the vertex colours: the hand-made grain of clay.
function speckleTex() {
  return cachedTex("island-speckle", () => {
    let s = 9;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    return canvasTex(256, 256, (ctx, w) => {
      ctx.fillStyle = "#f2f2f2"; ctx.fillRect(0, 0, w, w);
      for (let i = 0; i < 2600; i++) {
        const l = 200 + r() * 55;
        ctx.fillStyle = `rgb(${l},${l},${l})`;
        ctx.beginPath(); ctx.arc(r() * w, r() * w, 0.8 + r() * 2.2, 0, TAU); ctx.fill();
      }
    });
  });
}

// ---------- layout ----------
function layout(spec, rand) {
  const vs = spec.vignettes ?? [];
  const n = vs.length;
  const rs = vs.map((v) => SIZES[v.size] ?? SIZES.medium);
  const rMax = Math.max(2, ...rs);
  const inner = spec.landmark ? LANDMARK_R + 0.25 : 0.4; // plot circles stay this far from the centre
  // Smaller plots sit further out, so the outer edges line up and the middle opens up for filler.
  const dist = (R, i) => R + (rMax - rs[i]) * 0.5;
  const needAngle = (R, i, j) => {
    const a = dist(R, i), b = dist(R, j), c = rs[i] + rs[j] + GAP;
    const cos = (a * a + b * b - c * c) / (2 * a * b);
    return cos < -1 ? Infinity : Math.acos(Math.min(1, cos));
  };
  const angles = (R) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(n > 1 ? needAngle(R, i, (i + 1) % n) : TAU);
    return out;
  };
  const total = (R) => angles(R).reduce((s, x) => s + x, 0);
  let lo = rMax + inner, R = lo;
  if (n > 1 && total(lo) > TAU) {
    let hi = lo + 30;
    for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (total(mid) > TAU) lo = mid; else hi = mid; }
    R = hi;
  }
  if (n === 1) R = 0;
  const need = angles(R);
  const slack = n > 1 ? (TAU - need.reduce((s, x) => s + x, 0)) / n : 0;
  const theta = [];
  let a = 0;
  for (let i = 0; i < n; i++) { theta.push(a); a += need[i] + slack; }
  let hero = vs.findIndex((v) => v.hero);
  if (hero < 0) hero = rs.indexOf(rMax);
  const shift = hero >= 0 ? -theta[hero] : 0;
  const plots = vs.map((v, i) => {
    const t = theta[i] + shift, d = n === 1 ? 0 : dist(R, i);
    return { x: Math.sin(t) * d, z: Math.cos(t) * d, rot: t, radius: rs[i], index: i };
  });
  return { plots, ring: R };
}

// Path control points: sweep around the front (outward side) of each plot, tucking in toward the centre between plots.
function pathPoints(plots) {
  const pts = [];
  const arcPt = (p, deg, off = PATH_OFF) => {
    const t = p.rot + (deg * Math.PI) / 180, d = p.radius + off;
    return new THREE.Vector3(p.x + Math.sin(t) * d, 0, p.z + Math.cos(t) * d);
  };
  plots.forEach((p, i) => {
    const first = i === 0, last = i === plots.length - 1;
    const steps = [-75, -50, -25, 0, 25, 50, 75].filter((d) => !(first && d < -50) && !(last && d > 50));
    for (const d of steps) pts.push(arcPt(p, d));
    if (!last) {
      // Gap point between this plot and the next, pushed out just enough to clear both circles.
      const q = plots[i + 1];
      const A = arcPt(p, 80), B = arcPt(q, -80);
      const m = A.clone().add(B).multiplyScalar(0.5);
      for (let k = 0; k < 30; k++) {
        const clear = Math.min(Math.hypot(m.x - p.x, m.z - p.z) - p.radius, Math.hypot(m.x - q.x, m.z - q.z) - q.radius);
        if (clear >= PATH_OFF + 0.05) break;
        const l = Math.hypot(m.x, m.z) || 1;
        m.x += (m.x / l) * 0.05; m.z += (m.z / l) * 0.05;
      }
      pts.push(m);
    }
  });
  return pts;
}

// ---------- build ----------
export function buildIsland(spec, ctx = {}) {
  const rand = ctx.rand ?? Math.random;
  const B = BIOMES[spec.biome] ?? BIOMES.meadow;
  const group = new THREE.Group();
  group.name = "island";

  const { plots } = layout(spec, rand);
  const landmark = spec.landmark ? { x: 0, z: 0, radius: LANDMARK_R } : null;

  // Path curve and dense samples.
  let curve = null, samples = [];
  if (plots.length >= 2) {
    curve = new THREE.CatmullRomCurve3(pathPoints(plots), false, "centripetal");
    const nS = Math.max(40, Math.round(curve.getLength() / 0.12));
    samples = curve.getSpacedPoints(nS);
  }
  const path = samples.filter((_, i) => i % 3 === 0 || i === samples.length - 1).map((p) => [+p.x.toFixed(3), +p.z.toFixed(3)]);

  // Island outline: radius(θ) = base * (1 + WOBBLE * n(θ)), with base just big enough to hold plots and path.
  const wob = ringNoise(rand, [2, 3, 4, 5]);
  const ANG = 360;
  const req = new Float32Array(ANG);
  const far = (ux, uz, cx, cz, rr) => {
    const p = cx * ux + cz * uz, perp2 = cx * cx + cz * cz - p * p;
    return perp2 > rr * rr ? 0 : p + Math.sqrt(rr * rr - perp2);
  };
  for (let k = 0; k < ANG; k++) {
    const t = (k / ANG) * TAU, ux = Math.sin(t), uz = Math.cos(t);
    let m = landmark ? LANDMARK_R + 1.5 : 2;
    for (const p of plots) m = Math.max(m, far(ux, uz, p.x, p.z, p.radius + PLOT_EDGE));
    for (let i = 0; i < samples.length; i += 2) m = Math.max(m, far(ux, uz, samples[i].x, samples[i].z, PATH_EDGE));
    req[k] = m;
  }
  let base = 0;
  for (let k = 0; k < ANG; k++) base = Math.max(base, req[k] / (1 + WOBBLE * wob((k / ANG) * TAU)));
  const topR = (t) => base * (1 + WOBBLE * wob(t));
  let radius = 0;
  for (let k = 0; k < ANG; k++) radius = Math.max(radius, topR((k / ANG) * TAU));
  const seaR = radius + 2.0;

  // ---------- terrain mesh (one geometry, vertex colours) ----------
  const S = 192;
  const n2 = noise2(rand);
  const jit = PROFILE.map(() => ringNoise(rand, [7, 11, 17]));
  const yJit = PROFILE.map(() => ringNoise(rand, [5, 9, 13]));
  const pos = [], colr = [], uvs = [], idx = [];
  const tmp = new THREE.Color();
  const pushV = (x, y, z, c) => { pos.push(x, y, z); colr.push(c.r, c.g, c.b); uvs.push(x / 3, z / 3); return pos.length / 3 - 1; };
  const addStrip = (rows) => {
    // rows: arrays of S vertex indices; connect consecutive rows, wrapping around.
    for (let r = 0; r + 1 < rows.length; r++)
      for (let s = 0; s < S; s++) {
        const s1 = (s + 1) % S, a = rows[r][s], b = rows[r][s1], c = rows[r + 1][s], d = rows[r + 1][s1];
        idx.push(a, c, b, b, c, d);
      }
  };
  const C = {
    top: B.top.map(col), lip: col(B.lip), beach: col(B.beach), wet: col(B.wet),
    s0: col(B.strata[0]), s1: col(B.strata[1]), s2: col(B.strata[2]), s3: col(B.strata[3]),
  };
  const topColour = (x, z) => {
    const a = n2(x * 0.16 + 3, z * 0.16 + 7), b = n2(x * 0.5 + 40, z * 0.5 + 11), c = n2(x * 1.3 + 90, z * 1.3);
    if (spec.biome === "city") {
      const pave = THREE.MathUtils.smoothstep(a, 0.5, 0.56);
      tmp.copy(C.top[0]).lerp(C.top[1], b);
      tmp.lerp(C.top[2], pave);
    } else if (spec.biome === "beach") {
      tmp.copy(C.top[0]).lerp(C.top[1], b);
      tmp.lerp(C.top[2], THREE.MathUtils.smoothstep(a, 0.6, 0.7) * 0.85);
    } else {
      tmp.copy(C.top[0]).lerp(C.top[1], clamp01((a - 0.3) * 1.8));
      tmp.lerp(C.top[2], THREE.MathUtils.smoothstep(b, 0.55, 0.75) * 0.8);
    }
    return tmp.clone().multiplyScalar(0.94 + c * 0.12);
  };
  // Flat top: polar grid.
  const K = Math.ceil(radius / 0.34);
  const topRows = [];
  for (let k = 0; k <= K; k++) {
    const row = [];
    for (let s = 0; s < S; s++) {
      const t = (s / S) * TAU, rr = (topR(t) * k) / K, x = Math.sin(t) * rr, z = Math.cos(t) * rr;
      row.push(pushV(x, 0, z, topColour(x, z)));
    }
    topRows.push(row);
  }
  addStrip(topRows);
  // Edge profile: grass lip, clay strata, beach, wet sand under the sea.
  const rowPos = PROFILE.map(([dr, y, j], k) => {
    const out = [];
    for (let s = 0; s < S; s++) {
      const t = (s / S) * TAU;
      const rr = k === 0 ? topR(t) : topR(t) + dr + j * jit[k](t);
      const yy = k === 0 ? 0 : y + (k > 1 && k < 11 ? 0.025 * yJit[k](t) : 0);
      out.push([Math.sin(t) * rr, yy, Math.cos(t) * rr]);
    }
    return out;
  });
  for (const [k0, k1, key] of BANDS) {
    const rows = [];
    for (let k = k0; k <= k1; k++) {
      rows.push(rowPos[k].map(([x, y, z], s) => {
        let c = C[key].clone();
        if (key === "beach" || key === "wet") {
          // Sand darkens toward the water.
          const f = clamp01((y - -0.62) / (-0.97 - -0.62));
          c = C.beach.clone().lerp(C.wet, f * f);
        }
        c.multiplyScalar(0.92 + n2(x * 0.9 + 17, z * 0.9 + (k0 * 13)) * 0.16);
        return pushV(x, y, z, c);
      }));
    }
    addStrip(rows);
  }
  // Sea floor out to the plinth.
  const floorRows = [rowPos[PROFILE.length - 1].map(([x, y, z]) => pushV(x, y, z, C.wet.clone().multiplyScalar(0.8)))];
  const deep = col("#2a5a68");
  floorRows.push(Array.from({ length: S }, (_, s) => {
    const t = (s / S) * TAU;
    return pushV(Math.sin(t) * (seaR + 0.1), FLOOR_Y, Math.cos(t) * (seaR + 0.1), deep);
  }));
  addStrip(floorRows);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colr, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const groundMat = mat("#ffffff", { map: speckleTex(), rough: 0.92 }).clone();
  groundMat.vertexColors = true;
  const terrain = new THREE.Mesh(geo, groundMat);
  terrain.name = "terrain";
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  group.add(terrain);

  // ---------- sea ----------
  {
    const shore = PROFILE[13][0];
    const ts = [0, 0.04, 0.1, 0.2, 0.35, 0.55, 0.8, 1];
    const sp = [], sc = [], su = [], si = [];
    const shallow = col(spec.biome === "snow" ? "#7fb6cf" : "#62c9c4"), mid = col(spec.biome === "snow" ? "#3f7fa6" : "#2f9bb5"), deepC = col(spec.biome === "snow" ? "#1f4a72" : "#1d6a96");
    const rows = ts.map((f) => Array.from({ length: S }, (_, s) => {
      const t = (s / S) * TAU, r0 = topR(t) + shore - 0.35, rr = r0 + (seaR - r0) * f;
      const x = Math.sin(t) * rr, z = Math.cos(t) * rr;
      const dd = rr - topR(t) - shore; // metres past the waterline
      const c = shallow.clone().lerp(mid, clamp01(dd / 0.9)).lerp(deepC, clamp01((dd - 0.9) / 1.4));
      sp.push(x, SEA_Y, z); sc.push(c.r, c.g, c.b); su.push(x / 2.2, z / 2.2);
      return sp.length / 3 - 1;
    }));
    for (let r = 0; r + 1 < rows.length; r++)
      for (let s = 0; s < S; s++) {
        const s1 = (s + 1) % S;
        si.push(rows[r][s], rows[r + 1][s], rows[r][s1], rows[r][s1], rows[r + 1][s], rows[r + 1][s1]);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(sc, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(su, 2));
    g.setIndex(si);
    g.computeVertexNormals();
    const seaMat = mat("#ffffff", { rough: 0.3 }).clone(); // keeps the lumpy clay normal map as gentle ripples
    seaMat.vertexColors = true;
    seaMat.transparent = true;
    seaMat.opacity = 0.86;
    seaMat.envMapIntensity = 0.6;
    seaMat.normalScale.set(0.5, 0.5);
    seaMat.depthWrite = false;
    const sea = new THREE.Mesh(g, seaMat);
    sea.name = "sea";
    sea.renderOrder = 1;
    group.add(sea);

    // Foam: a wavy ring hugging the shore plus a broken outer line.
    const fp = [], fi = [];
    const foamRing = (inner, outer, wob1, keep) => {
      const fj = ringNoise(rand, [9, 14, 23]);
      const base0 = fp.length / 3;
      for (let s = 0; s <= S * 2; s++) {
        const t = (s / (S * 2)) * TAU, w = fj(t) * wob1, r0 = topR(t);
        for (const off of [inner, outer]) fp.push(Math.sin(t) * (r0 + off + w), SEA_Y + 0.006, Math.cos(t) * (r0 + off + w));
      }
      for (let s = 0; s < S * 2; s++) {
        if (keep && !keep((s / (S * 2)) * TAU)) continue;
        const a = base0 + s * 2, b = a + 1, c = a + 2, d = a + 3;
        fi.push(a, c, b, b, c, d);
      }
    };
    foamRing(shore - 0.12, shore + 0.1, 0.06);
    const gaps = ringNoise(rand, [13, 21, 34]);
    foamRing(shore + 0.42, shore + 0.5, 0.1, (t) => gaps(t) > -0.05);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute("position", new THREE.Float32BufferAttribute(fp, 3));
    fg.setIndex(fi);
    fg.computeVertexNormals();
    const foam = new THREE.Mesh(fg, mat("#f3fbff", { rough: 0.7, clay: false }));
    foam.name = "foam";
    foam.renderOrder = 2;
    group.add(foam);
  }

  // ---------- wooden plinth (a tray whose lip rises just above the water) ----------
  {
    const R0 = seaR;
    const prof = [[R0 - 0.02, SEA_Y + 0.02], [R0 + 0.06, SEA_Y + 0.12], [R0 + 0.22, SEA_Y + 0.13], [R0 + 0.3, SEA_Y + 0.04], [R0 + 0.32, -1.05]];
    const tray = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 128), mat("#7a4e2e", { rough: 0.7 }));
    const band = new THREE.Mesh(new THREE.LatheGeometry([[R0 + 0.32, -1.05], [R0 + 0.36, -1.1], [R0 + 0.36, -1.5], [R0 + 0.3, -1.56], [0.01, -1.56]].map(([r, y]) => new THREE.Vector2(r, y)), 128), mat("#5c3a22", { rough: 0.75 }));
    tray.name = "plinth"; band.name = "plinth-base";
    group.add(tray, band);
  }

  // ---------- path ----------
  if (curve) {
    const kind = B.path;
    const across = [[-1.08, -0.012], [-1, 0.018], [-0.6, 0.038], [0, 0.046], [0.6, 0.038], [1, 0.018], [1.08, -0.012]];
    const pp = [], pc = [], pu = [], pi = [];
    const wid = ringNoise(rand, [5, 9]);
    const dA = col(B.dirt[0]), dB = col(B.dirt[1]);
    const L = curve.getLength();
    const N = samples.length;
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1), P = samples[i], T = curve.getTangentAt(u);
      const nx = -T.z, nz = T.x, nl = Math.hypot(nx, nz) || 1;
      const end = Math.min(1, (i / (N - 1)) * L / 0.5, (1 - i / (N - 1)) * L / 0.5); // round off the ends
      const hw = PATH_HALF * (1 + 0.07 * wid(u * TAU)) * (0.35 + 0.65 * Math.sqrt(end));
      for (const [f, y] of across) {
        const x = P.x + (nx / nl) * f * hw, z = P.z + (nz / nl) * f * hw;
        const centre = 1 - Math.abs(f);
        const c = dA.clone().lerp(dB, n2(x * 1.7 + 5, z * 1.7 + 9)).multiplyScalar(0.95 + centre * 0.1);
        pp.push(x, heightAt(x, z) + y, z); pc.push(c.r, c.g, c.b);
        pu.push(((f + 1) * hw) / 9.5, (u * L) / 9.5);
      }
    }
    const M = across.length;
    for (let i = 0; i + 1 < N; i++)
      for (let j = 0; j + 1 < M; j++) {
        const a = i * M + j, b = a + 1, c = a + M, d = c + 1;
        pi.push(a, b, c, b, d, c);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pp, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(pc, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(pu, 2));
    g.setIndex(pi);
    g.computeVertexNormals();
    let pathMat = groundMat;
    if (kind === "cobble") pathMat = mat("#ffffff", { map: surfaceTex("cobblestone", rand), rough: 0.85 });
    const pm = new THREE.Mesh(g, pathMat);
    pm.name = "path";
    pm.receiveShadow = true;
    group.add(pm);
  }

  // ---------- plot floor patches ----------
  const texCache = {};
  spec.vignettes?.forEach((v, i) => {
    if (!v.surface || !plots[i]) return;
    const p = plots[i];
    const tex = (texCache[v.surface] ??= surfaceTex(v.surface, rand));
    if (!tex) return;
    const edge = ringNoise(rand, [3, 5, 8]);
    const shape = new THREE.Shape();
    const NP = 64;
    for (let k = 0; k < NP; k++) {
      const t = (k / NP) * TAU, rr = p.radius * 0.97 + 0.07 * edge(t);
      k ? shape.lineTo(Math.cos(t) * rr, Math.sin(t) * rr) : shape.moveTo(Math.cos(t) * rr, Math.sin(t) * rr);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.03, bevelSegments: 1, curveSegments: 4 });
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) / 9.5, uv.getY(k) / 9.5);
    const m = new THREE.Mesh(g, mat("#ffffff", { map: tex, rough: v.surface === "water" ? 0.35 : 0.88 }));
    m.position.set(p.x, 0, p.z); // top cap at y = depth + bevel = 0.016
    m.rotation.y = p.rot;
    m.name = "plot-floor-" + i;
    m.receiveShadow = true;
    group.add(m);
  });

  // ---------- queries ----------
  function heightAt(x, z) {
    const rr = Math.hypot(x, z), t = Math.atan2(x, z), d = rr - topR(t);
    if (d <= 0) return 0;
    for (let k = 1; k < PROFILE.length; k++) {
      const [d0, y0] = PROFILE[k - 1], [d1, y1] = PROFILE[k];
      if (d <= Math.max(d0, d1)) return y0 + (y1 - y0) * clamp01((d - d0) / ((d1 - d0) || 1));
    }
    return FLOOR_Y;
  }
  const segs = [];
  for (let i = 0; i + 1 < samples.length; i += 2) {
    const a = samples[i], b = samples[Math.min(i + 2, samples.length - 1)];
    segs.push([a.x, a.z, b.x, b.z]);
  }
  function isFree(x, z, clearance = 0) {
    const t = Math.atan2(x, z);
    if (Math.hypot(x, z) > topR(t) - 0.4 - clearance) return false;
    for (const p of plots) if (Math.hypot(x - p.x, z - p.z) < p.radius + clearance) return false;
    if (landmark && Math.hypot(x - landmark.x, z - landmark.z) < landmark.radius + clearance) return false;
    const pr = PATH_HALF + clearance, pr2 = pr * pr;
    for (const [ax, az, bx, bz] of segs) {
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const u = clamp01(((x - ax) * dx + (z - az) * dz) / l2);
      const ex = ax + dx * u - x, ez = az + dz * u - z;
      if (ex * ex + ez * ez < pr2) return false;
    }
    return true;
  }

  return { group, radius: +radius.toFixed(3), plots, path, landmark, isFree, heightAt };
}
