// Indoor: room, sofa, bed, kitchen, desk-lamp, monitor, tv, whiteboard, pizza-box, backpack, bin, rug.
// Chunky clay miniatures for indoor moments: a cutaway dollhouse room and the things that live in it.
import { THREE, mat, glowMat, canvasTex, cachedTex, checkTex, stripeTex, put, group, shade, pick, rng } from "../core.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// ---------- params ----------
const num = (v, d) => {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) ? n : d;
};
const col = (v, d) => (typeof v === "string" && v.trim() ? v : d);
const flag = (v, d) => (v == null ? d : v === true || v === "true" || v === 1);
const size2 = (v, d) => (Array.isArray(v) && v.length >= 2 ? [num(v[0], d[0]), num(v[1], d[1])] : d);
const isDark = (t) => ["dusk", "night", "snow"].includes(t);

// ---------- palette ----------
const TRIM = "#f4ecdc";
const CAP = "#8a5a38";
const WALNUT = "#6e4128";
const HONEY = "#c99a5e";
const BRASS = "#c9a14a";
const CREAM = "#f3ede0";

// ---------- materials ----------
const asM = (m) => (m && m.isMaterial ? m : mat(m));
const texMats = new Map();
const tmat = (key, make) => (texMats.has(key) ? texMats.get(key) : texMats.set(key, make()).get(key));
const brassM = () => mat(BRASS, { rough: 0.35, metal: 0.6 });
const steelM = () => mat("#c3c8cd", { rough: 0.3, metal: 0.65, clay: false });

// A screen: black glass lit by an emissive picture, modest intensity so bloom stays gentle.
function screenMat(key, tex, intensity = 1.4) {
  return tmat("screen" + key, () => new THREE.MeshStandardMaterial({ color: "#000000", emissive: "#ffffff", emissiveMap: tex, emissiveIntensity: intensity, roughness: 0.35 }));
}

// ---------- geometry helpers ----------
function rb(w, h, d, m, r = Math.min(w, h, d) * 0.25, seg = 1) {
  r = Math.max(1e-4, Math.min(r, Math.min(w, h, d) / 2 - 1e-4));
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, seg, r), asM(m));
}
const bx = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), asM(m));
const cy = (rt, rbt, h, m, seg = 10) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rbt, h, seg), asM(m));
const sp = (r, m, ws = 8, hs = 6) => new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), asM(m));
const lt = (pts, m, seg = 12) => new THREE.Mesh(new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(a, b)), seg), asM(m));
const tor = (R, t, m, rs = 4, ts = 12, arc = Math.PI * 2) => new THREE.Mesh(new THREE.TorusGeometry(R, t, rs, ts, arc), asM(m));
function tb(pts, r, m, seg = 16, rs = 5) {
  const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q)));
  return new THREE.Mesh(new THREE.TubeGeometry(curve, seg, r, rs, false), asM(m));
}
// Cylinder between two points.
function rod(parent, a, b, r, m, seg = 6) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const mesh = cy(r, r, A.distanceTo(B), m, seg);
  mesh.position.copy(A).add(B).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  parent.add(mesh);
  return mesh;
}
// Box-projected UVs in metres, so tiled textures (planks, tiles, plaster) keep their real size.
function projUV(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (ay >= ax && ay >= az) uv.set([x, -z], 2 * i);
    else if (ax >= az) uv.set([z, y], 2 * i);
    else uv.set([x, y], 2 * i);
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}
// Box from bounds (optionally rounded), UVs in metres.
function slab(g, m, x0, x1, y0, y1, z0, z1, r = 0) {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  if (w <= 0 || h <= 0 || d <= 0) return null;
  const geo = r > 0 ? new RoundedBoxGeometry(w, h, d, 1, Math.min(r, Math.min(w, h, d) / 2 - 1e-4)) : new THREE.BoxGeometry(w, h, d);
  geo.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  projUV(geo);
  const mesh = new THREE.Mesh(geo, asM(m));
  g.add(mesh);
  return mesh;
}
// Box bent along x so the middle bows by `bend` in z, with soft folds (curtains, straps).
function folded(w, h, d, m, folds = 0, amp = 0, segs = 10) {
  const geo = new THREE.BoxGeometry(w, h, d, segs, 1, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / w + 0.5;
    p.setZ(i, p.getZ(i) + amp * Math.sin(u * Math.PI * 2 * folds));
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, asM(m));
}
function wrap(S) {
  const g = group(), k = group();
  k.scale.setScalar(S);
  g.add(k);
  return [g, k];
}
// Merge every mesh into one mesh per material (fewer draw calls).
function merged(root) {
  root.updateMatrixWorld(true);
  const buckets = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.clearGroups();
    if (!buckets.has(o.material)) buckets.set(o.material, []);
    buckets.get(o.material).push(g);
  });
  const out = group();
  for (const [m, gs] of buckets) out.add(new THREE.Mesh(mergeGeometries(gs), m));
  return out;
}

// ---------- textures (tiled in metres unless noted) ----------
function jit(base, r, dh, ds, dl) {
  const c = new THREE.Color(base);
  c.offsetHSL((r() - 0.5) * dh, (r() - 0.5) * ds, (r() - 0.5) * dl);
  return "#" + c.getHexString();
}
function speckle(c, r, w, h, n, colr, s = 2) {
  c.fillStyle = colr;
  for (let i = 0; i < n; i++) c.fillRect(r() * w, r() * h, 1 + r() * s, 1 + r() * s);
}
const woodFloorTex = () =>
  cachedTex("indoor-wood", () =>
    canvasTex(512, 512, (c, w, h) => {
      const r = rng(21);
      const rows = 12, rh = h / rows;
      c.fillStyle = "#4a2c18";
      c.fillRect(0, 0, w, h);
      for (let j = 0; j < rows; j++) {
        let x = r() * w;
        const end = x + w;
        while (x < end - 4) {
          const L = Math.min(140 + r() * 230, end - x);
          const pc = jit("#c48b55", r, 0.03, 0.15, 0.14);
          for (const dx of [0, -w]) {
            const x0 = x + dx, y0 = j * rh;
            c.fillStyle = pc;
            c.fillRect(x0 + 1.5, y0 + 1.5, L - 3, rh - 3);
            for (let k = 0; k < 5; k++) {
              const yy = y0 + 4 + r() * (rh - 8), amp = 1 + r() * 2;
              c.strokeStyle = `rgba(90,50,20,${0.07 + r() * 0.1})`;
              c.lineWidth = 0.8 + r() * 1.2;
              c.beginPath();
              for (let xx = 0; xx <= L - 6; xx += 12) c[xx ? "lineTo" : "moveTo"](x0 + 3 + xx, yy + Math.sin(xx / 30 + k) * amp);
              c.stroke();
            }
            c.fillStyle = "rgba(255,240,210,0.12)";
            c.fillRect(x0 + 1.5, y0 + 1.5, L - 3, 2);
          }
          x += L;
        }
      }
    }, { repeat: [1 / 1.8, 1 / 1.8] }),
  );
const tileFloorTex = () =>
  cachedTex("indoor-tile", () =>
    canvasTex(512, 512, (c, w) => {
      const r = rng(5);
      const n = 4, s = w / n;
      c.fillStyle = "#d6cdbd";
      c.fillRect(0, 0, w, w);
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          c.fillStyle = jit((i + j) % 2 ? "#c27650" : "#efe5d0", r, 0.02, 0.1, 0.06);
          c.beginPath();
          c.roundRect(i * s + 3, j * s + 3, s - 6, s - 6, 7);
          c.fill();
          c.fillStyle = "rgba(255,255,255,0.12)";
          c.fillRect(i * s + 8, j * s + 7, s - 22, 4);
        }
      speckle(c, r, w, w, 1500, "rgba(60,30,10,0.07)");
    }, { repeat: [1 / 1.2, 1 / 1.2] }),
  );
const carpetTex = () =>
  cachedTex("indoor-carpet", () =>
    canvasTex(256, 256, (c, w) => {
      const r = rng(9);
      c.fillStyle = "#b39f84";
      c.fillRect(0, 0, w, w);
      speckle(c, r, w, w, 2600, "rgba(70,50,30,0.12)");
      speckle(c, r, w, w, 2000, "rgba(255,245,225,0.12)");
    }, { repeat: [1 / 0.8, 1 / 0.8] }),
  );
const plasterTex = () =>
  cachedTex("indoor-plaster", () =>
    canvasTex(256, 256, (c, w) => {
      const r = rng(13);
      c.fillStyle = "#ffffff";
      c.fillRect(0, 0, w, w);
      for (let i = 0; i < 60; i++) {
        const x = r() * w, y = r() * w, rad = 10 + r() * 40;
        for (const dx of [0, -w, w]) for (const dy of [0, -w, w]) {
          const gr = c.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
          gr.addColorStop(0, r() < 0.5 ? "rgba(120,100,80,0.025)" : "rgba(255,255,255,0.1)");
          gr.addColorStop(1, "rgba(0,0,0,0)");
          c.fillStyle = gr;
          c.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
        }
      }
      speckle(c, r, w, w, 300, "rgba(90,70,50,0.04)");
    }, { repeat: [1 / 1.5, 1 / 1.5] }),
  );
// Bead-board panelling: vertical grooves every 10 cm.
const beadTex = () =>
  cachedTex("indoor-bead", () =>
    canvasTex(256, 256, (c, w) => {
      const r = rng(17);
      c.fillStyle = "#ffffff";
      c.fillRect(0, 0, w, w);
      const s = w / 8;
      for (let i = 0; i < 8; i++) {
        c.fillStyle = "rgba(80,60,40,0.28)";
        c.fillRect(i * s, 0, 3, w);
        c.fillStyle = "rgba(255,255,255,0.6)";
        c.fillRect(i * s + 3, 0, 2, w);
      }
      speckle(c, r, w, w, 300, "rgba(90,70,50,0.06)");
    }, { repeat: [1 / 0.8, 1 / 0.8] }),
  );
const subwayTex = () =>
  cachedTex("indoor-subway", () =>
    canvasTex(256, 256, (c, w) => {
      const r = rng(3);
      c.fillStyle = "#cfc6b6";
      c.fillRect(0, 0, w, w);
      const rows = 8, rh = w / rows, tw = 64;
      for (let j = 0; j < rows; j++)
        for (let i = -1; i < 5; i++) {
          const x = i * tw + (j % 2) * tw * 0.5;
          c.fillStyle = jit("#f3efe6", r, 0.02, 0.1, 0.04);
          c.beginPath();
          c.roundRect(x + 2, j * rh + 2, tw - 4, rh - 4, 4);
          c.fill();
          c.fillStyle = "rgba(255,255,255,0.5)";
          c.fillRect(x + 6, j * rh + 5, tw - 16, 3);
        }
    }, { repeat: [1 / 0.6, 1 / 0.6] }),
  );

// Pictures (whole texture per face).
const landscapeTex = () =>
  cachedTex("indoor-landscape", () =>
    canvasTex(160, 120, (c, w, h) => {
      const sky = c.createLinearGradient(0, 0, 0, h * 0.6);
      sky.addColorStop(0, "#8fb9d9");
      sky.addColorStop(1, "#f6d9a8");
      c.fillStyle = sky;
      c.fillRect(0, 0, w, h);
      c.fillStyle = "#fff2c2";
      c.beginPath(); c.arc(w * 0.72, h * 0.3, 13, 0, 7); c.fill();
      const hill = (y, amp, f, colr) => {
        c.fillStyle = colr;
        c.beginPath(); c.moveTo(0, h);
        for (let x = 0; x <= w; x += 4) c.lineTo(x, y + Math.sin(x / w * Math.PI * f + y) * amp);
        c.lineTo(w, h); c.fill();
      };
      hill(h * 0.52, 8, 2, "#8aa6a0");
      hill(h * 0.64, 9, 1.5, "#6e9b5a");
      hill(h * 0.8, 7, 2.5, "#4f7d45");
      c.fillStyle = "#2f5a34";
      for (const x of [0.2, 0.27, 0.85]) { c.beginPath(); c.ellipse(w * x, h * 0.66, 6, 11, 0, 0, 7); c.fill(); }
    }, { repeat: [1, 1] }),
  );
const stillLifeTex = () =>
  cachedTex("indoor-stilllife", () =>
    canvasTex(120, 160, (c, w, h) => {
      c.fillStyle = "#2f4a5e";
      c.fillRect(0, 0, w, h);
      c.fillStyle = "#c98a4a";
      c.fillRect(0, h * 0.72, w, h * 0.28);
      c.fillStyle = "#e9dcc0";
      c.beginPath(); c.ellipse(w / 2, h * 0.7, 18, 26, 0, 0, 7); c.fill();
      c.fillRect(w / 2 - 8, h * 0.45, 16, 12);
      c.strokeStyle = "#4f7d45"; c.lineWidth = 3;
      const fl = [[-26, 0.22, "#e2574c"], [0, 0.14, "#f2c14e"], [24, 0.24, "#e98fb0"], [-12, 0.3, "#f2f0e6"], [14, 0.33, "#e2574c"]];
      for (const [dx, y] of fl) { c.beginPath(); c.moveTo(w / 2, h * 0.48); c.lineTo(w / 2 + dx, h * y); c.stroke(); }
      for (const [dx, y, fc] of fl) { c.fillStyle = fc; c.beginPath(); c.arc(w / 2 + dx, h * y, 9, 0, 7); c.fill(); }
    }, { repeat: [1, 1] }),
  );
const daySkyTex = () =>
  cachedTex("indoor-daysky", () =>
    canvasTex(64, 64, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#9cc4e4");
      g.addColorStop(1, "#e6eef0");
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      c.fillStyle = "rgba(255,255,255,0.85)";
      for (const [x, y, rr] of [[18, 24, 7], [26, 21, 9], [35, 25, 6]]) { c.beginPath(); c.arc(x, y, rr, 0, 7); c.fill(); }
      c.fillStyle = "#86a982";
      c.fillRect(0, h * 0.82, w, h * 0.18);
    }, { repeat: [1, 1] }),
  );
const nightGlowTex = () =>
  cachedTex("indoor-nightglow", () =>
    canvasTex(64, 64, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h * 0.6, 3, w / 2, h * 0.6, w * 0.8);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(1, "#8a6040");
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    }, { repeat: [1, 1] }),
  );
const codeTex = () =>
  cachedTex("indoor-code", () =>
    canvasTex(256, 160, (c, w, h) => {
      const r = rng(41);
      c.fillStyle = "#1c2742";
      c.fillRect(0, 0, w, h);
      c.fillStyle = "#2c3a5e";
      c.fillRect(0, 0, w, 12);
      c.fillStyle = "#222e4e";
      c.fillRect(0, 12, 44, h);
      c.fillStyle = "rgba(200,210,240,0.35)";
      for (let y = 20; y < h - 6; y += 9) c.fillRect(6, y, 18 + r() * 16, 4);
      const cols = ["#7fb7ff", "#ffd27a", "#9be3b0", "#f29ab0", "#c9d3ea", "#c9d3ea"];
      let ind = 0;
      for (let y = 20; y < h - 6; y += 9) {
        ind = Math.max(0, Math.min(4, ind + (r() < 0.3 ? 1 : r() < 0.3 ? -1 : 0)));
        let x = 54 + ind * 12;
        const n = 1 + Math.floor(r() * 4);
        for (let k = 0; k < n && x < w - 20; k++) {
          const lw = 10 + r() * 40;
          c.fillStyle = pick(r, cols);
          c.fillRect(x, y, lw, 4);
          x += lw + 5;
        }
      }
    }, { repeat: [1, 1] }),
  );
const tvShowTex = () =>
  cachedTex("indoor-tvshow", () =>
    canvasTex(256, 150, (c, w, h) => {
      const sky = c.createLinearGradient(0, 0, 0, h * 0.7);
      sky.addColorStop(0, "#6aa3d8");
      sky.addColorStop(1, "#ffc99a");
      c.fillStyle = sky;
      c.fillRect(0, 0, w, h);
      c.fillStyle = "#fff0bf";
      c.beginPath(); c.arc(w * 0.66, h * 0.5, 18, 0, 7); c.fill();
      c.fillStyle = "rgba(255,255,255,0.9)";
      for (const [x, y, rr] of [[50, 30, 10], [64, 26, 13], [80, 31, 9], [180, 22, 8], [192, 19, 10]]) { c.beginPath(); c.arc(x, y, rr, 0, 7); c.fill(); }
      c.fillStyle = "#5b7fa8";
      c.beginPath(); c.moveTo(0, h * 0.68); c.lineTo(60, h * 0.4); c.lineTo(110, h * 0.62); c.lineTo(150, h * 0.45); c.lineTo(w, h * 0.7); c.lineTo(w, h); c.lineTo(0, h); c.fill();
      c.fillStyle = "#4f9a5c";
      c.beginPath(); c.moveTo(0, h * 0.8);
      for (let x = 0; x <= w; x += 8) c.lineTo(x, h * 0.78 + Math.sin(x / 30) * 5);
      c.lineTo(w, h); c.lineTo(0, h); c.fill();
      c.fillStyle = "#e2574c";
      c.fillRect(w * 0.3, h * 0.66, 18, 14);
      c.fillStyle = "#7a3a2a";
      c.beginPath(); c.moveTo(w * 0.3 - 3, h * 0.66); c.lineTo(w * 0.3 + 9, h * 0.58); c.lineTo(w * 0.3 + 21, h * 0.66); c.fill();
    }, { repeat: [1, 1] }),
  );
const pizzaPrintTex = () =>
  cachedTex("indoor-pizzaprint", () =>
    canvasTex(128, 128, (c, w) => {
      c.fillStyle = "#d1ab7a";
      c.fillRect(0, 0, w, w);
      c.fillStyle = "#c0392b";
      c.fillRect(0, 8, w, 8);
      c.fillRect(0, w - 16, w, 8);
      c.beginPath(); c.arc(w / 2, w / 2, 34, 0, 7); c.fill();
      c.fillStyle = "#f7efe0";
      c.beginPath(); c.arc(w / 2, w / 2, 28, 0, 7); c.fill();
      c.fillStyle = "#f2c14e";
      c.beginPath(); c.moveTo(w / 2 - 16, w / 2 - 12); c.lineTo(w / 2 + 16, w / 2 - 12); c.lineTo(w / 2, w / 2 + 20); c.fill();
      c.fillStyle = "#b5302c";
      for (const [x, y] of [[-6, -6], [6, -4], [0, 6]]) { c.beginPath(); c.arc(w / 2 + x, w / 2 + y, 3.5, 0, 7); c.fill(); }
      c.fillStyle = "#c98a4a";
      c.fillRect(w / 2 - 17, w / 2 - 16, 34, 5);
    }, { repeat: [1, 1] }),
  );
// Rug: one texture covers the whole top. Aspect follows the rug.
function rugTex(pattern, C, w, d) {
  const aspect = Math.max(0.25, Math.min(4, d / w));
  const W = 512, H = Math.round(Math.max(128, Math.min(1024, 512 * aspect)));
  return cachedTex(`indoor-rug-${pattern}-${C}-${H}`, () =>
    canvasTex(W, H, (c) => {
      const r = rng(77);
      const navy = "#27324d", cream = "#efe2c4", gold = "#d9a441";
      if (pattern === "stripes") {
        const cols = [C, cream, shade(C, -0.15), cream, gold, cream];
        let x = 0, k = 0;
        while (x < W) {
          const sw = k % 2 ? 10 + r() * 14 : 30 + r() * 40;
          c.fillStyle = cols[k % cols.length];
          c.fillRect(x, 0, sw + 1, H);
          x += sw;
          k++;
        }
      } else if (pattern === "persian") {
        const b = Math.min(W, H) * 0.12;
        c.fillStyle = navy;
        c.fillRect(0, 0, W, H);
        c.strokeStyle = cream; c.lineWidth = 4;
        c.strokeRect(8, 8, W - 16, H - 16);
        c.strokeRect(b - 6, b - 6, W - 2 * b + 12, H - 2 * b + 12);
        // border motifs
        c.fillStyle = gold;
        const dia = (x, y, s) => { c.beginPath(); c.moveTo(x, y - s); c.lineTo(x + s, y); c.lineTo(x, y + s); c.lineTo(x - s, y); c.fill(); };
        for (let x = b; x < W - b / 2; x += b * 0.7) { dia(x, b / 2 + 2, b * 0.18); dia(x, H - b / 2 - 2, b * 0.18); }
        for (let y = b; y < H - b / 2; y += b * 0.7) { dia(b / 2 + 2, y, b * 0.18); dia(W - b / 2 - 2, y, b * 0.18); }
        // field
        c.fillStyle = C;
        c.fillRect(b, b, W - 2 * b, H - 2 * b);
        c.fillStyle = shade(C, 0.08);
        for (let x = b + 22; x < W - b - 10; x += 34)
          for (let y = b + 22; y < H - b - 10; y += 34) { c.fillRect(x - 3, y - 8, 6, 16); c.fillRect(x - 8, y - 3, 16, 6); }
        // medallion
        const mx = W / 2, my = H / 2, mw = (W - 2 * b) * 0.32, mh = (H - 2 * b) * 0.36;
        const diam = (sx, sy, fc) => { c.fillStyle = fc; c.beginPath(); c.moveTo(mx, my - sy); c.lineTo(mx + sx, my); c.lineTo(mx, my + sy); c.lineTo(mx - sx, my); c.fill(); };
        diam(mw + 6, mh + 6, cream);
        diam(mw, mh, navy);
        diam(mw * 0.66, mh * 0.66, gold);
        diam(mw * 0.4, mh * 0.4, C);
        diam(mw * 0.15, mh * 0.15, cream);
        // corner pieces
        c.fillStyle = navy;
        for (const [x, y] of [[b, b], [W - b, b], [b, H - b], [W - b, H - b]]) { c.beginPath(); c.moveTo(x, y); c.lineTo(x + (x < W / 2 ? mw * 0.7 : -mw * 0.7), y); c.lineTo(x, y + (y < H / 2 ? mh * 0.7 : -mh * 0.7)); c.fill(); }
      } else {
        c.fillStyle = C;
        c.fillRect(0, 0, W, H);
        c.strokeStyle = shade(C, 0.1); c.lineWidth = 6;
        c.strokeRect(18, 18, W - 36, H - 36);
      }
      speckle(c, r, W, H, (W * H) / 60, "rgba(40,20,10,0.10)");
      speckle(c, r, W, H, (W * H) / 90, "rgba(255,245,225,0.10)");
    }, { repeat: [1, 1] }),
  );
}

function floorMat(kind) {
  if (kind === "tile") return tmat("floor-tile", () => mat("#fff", { map: tileFloorTex(), rough: 0.6 }));
  if (kind === "carpet") return tmat("floor-carpet", () => mat("#fff", { map: carpetTex(), rough: 1 }));
  return tmat("floor-wood", () => mat("#fff", { map: woodFloorTex(), rough: 0.75 }));
}

// Picture frame facing +z, back at z = 0, centred on (0, 0).
function picture(g, w, h, tex, frameC = WALNUT) {
  const fm = mat(frameC, { rough: 0.6 });
  const f = 0.045, d = 0.035;
  put(g, rb(w, f, d, fm, 0.012), 0, h / 2 - f / 2, d / 2);
  put(g, rb(w, f, d, fm, 0.012), 0, -h / 2 + f / 2, d / 2);
  put(g, rb(f, h - 2 * f + 0.004, d, fm, 0.012), -w / 2 + f / 2, 0, d / 2);
  put(g, rb(f, h - 2 * f + 0.004, d, fm, 0.012), w / 2 - f / 2, 0, d / 2);
  put(g, bx(w - 2 * f + 0.01, h - 2 * f + 0.01, 0.015, tmat("pic" + tex.uuid, () => mat("#fff", { map: tex, rough: 0.85 }))), 0, 0, 0.012);
}

// ---------- room ----------
function room(p, ctx) {
  const r = ctx.rand;
  const [W, D] = size2(p.size, [3.2, 2.6]).map((v) => Math.max(1.2, Math.min(12, v)));
  const H = num(p.height, 2.2);
  const T = 0.1;
  const floorKind = ["wood", "tile", "carpet"].includes(p.floor) ? p.floor : "wood";
  const wallC = col(p.wall, "#e2c49c");
  const dark = isDark(ctx.time);
  const g = group();
  const plaster = tmat("plaster" + wallC, () => mat("#fff", { map: plasterTex(), tint: wallC, rough: 0.92 }));
  const wains = tmat("wains" + wallC, () => mat("#fff", { map: beadTex(), tint: shade(wallC, -0.1), rough: 0.8 }));
  const trim = mat(TRIM, { rough: 0.65 });
  const capM = mat(CAP, { rough: 0.8 });

  const xb = -W / 2, xr = W / 2, zb = -D / 2, zf = D / 2;
  const xi = xb + T, zi = zb + T; // inner faces of the side and back walls
  const FT = 0.022; // floor top: thin, so things placed at y = 0 only sink a couple of centimetres

  // floor slab
  slab(g, floorMat(floorKind), xb, xr, FT - 0.04, FT, zb, zf, 0.008);

  // window and door layout
  const ww = 0.9, wh = 0.95, wy0 = 0.95;
  const hasWin = flag(p.window, true) && xr - xi > ww + 0.6 && H > wy0 + wh + 0.2;
  const wx = hasWin ? Math.max(xi + ww / 2 + 0.35, Math.min(xr - ww / 2 - 0.25, W * 0.12)) : 0;
  const dw = 0.78, dh = Math.min(1.82, H - 0.2);
  const hasDoor = flag(p.door, false) && zf - zi > dw + 0.45;
  const dz = hasDoor ? zf - dw / 2 - 0.3 : 0;
  const dGap = hasDoor ? [dz - dw / 2 - 0.075, dz + dw / 2 + 0.075] : null;
  // z spans along the side wall, skipping the door
  const sideSpans = (z0, z1) => (dGap ? [[z0, dGap[0]], [dGap[1], z1]] : [[z0, z1]]);

  // walls
  if (hasWin) {
    slab(g, plaster, xi, wx - ww / 2, 0, H, zb, zi);
    slab(g, plaster, wx + ww / 2, xr, 0, H, zb, zi);
    slab(g, plaster, wx - ww / 2, wx + ww / 2, 0, wy0, zb, zi);
    slab(g, plaster, wx - ww / 2, wx + ww / 2, wy0 + wh, H, zb, zi);
  } else slab(g, plaster, xi, xr, 0, H, zb, zi);
  slab(g, plaster, xb, xi, 0, H, zb, zf);

  // wainscot, chair rail, skirting
  const WH = 0.82;
  slab(g, wains, xi, xr, 0, WH, zi, zi + 0.012);
  slab(g, trim, xi, xr, WH - 0.012, WH + 0.03, zi, zi + 0.032);
  slab(g, trim, xi, xr, 0, 0.11, zi, zi + 0.028);
  for (const [z0, z1] of sideSpans(zi + 0.012, zf)) {
    slab(g, wains, xi, xi + 0.012, 0, WH, z0, z1);
    slab(g, trim, xi, xi + 0.032, WH - 0.012, WH + 0.03, z0, z1);
    slab(g, trim, xi, xi + 0.028, 0, 0.11, z0, z1);
  }

  // dollhouse cut: wooden caps on the wall tops and ends
  slab(g, capM, xb - 0.006, xr + 0.006, H, H + 0.03, zb - 0.006, zi + 0.006);
  slab(g, capM, xb - 0.006, xi + 0.006, H, H + 0.03, zi + 0.006, zf + 0.006);
  slab(g, capM, xr, xr + 0.008, 0, H, zb - 0.006, zi + 0.006);
  slab(g, capM, xb - 0.006, xi + 0.006, 0, H, zf, zf + 0.008);

  // window
  if (hasWin) {
    const x0 = wx - ww / 2, x1 = wx + ww / 2, y1 = wy0 + wh;
    const zg = zb + T * 0.45;
    const glass = dark
      ? tmat("win-night", () => new THREE.MeshStandardMaterial({ color: "#3a2a1c", roughness: 0.4, emissive: "#ffb257", emissiveIntensity: 1.7, emissiveMap: nightGlowTex() }))
      : tmat("win-day", () => new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.3, map: daySkyTex(), emissive: "#ffffff", emissiveMap: daySkyTex(), emissiveIntensity: 0.35 }));
    put(g, bx(ww, wh, 0.01, glass), wx, wy0 + wh / 2, zg);
    // sash bars
    const sb = 0.045;
    slab(g, trim, x0, x0 + sb, wy0, y1, zg - 0.02, zg + 0.02);
    slab(g, trim, x1 - sb, x1, wy0, y1, zg - 0.02, zg + 0.02);
    slab(g, trim, x0, x1, y1 - sb, y1, zg - 0.02, zg + 0.02);
    slab(g, trim, x0, x1, wy0, wy0 + sb, zg - 0.02, zg + 0.02);
    slab(g, trim, wx - 0.015, wx + 0.015, wy0, y1, zg - 0.016, zg + 0.016);
    slab(g, trim, x0, x1, wy0 + wh * 0.56 - 0.015, wy0 + wh * 0.56 + 0.015, zg - 0.016, zg + 0.016);
    // reveal linings and architrave
    slab(g, trim, x0, x0 + 0.012, wy0, y1, zg, zi);
    slab(g, trim, x1 - 0.012, x1, wy0, y1, zg, zi);
    slab(g, trim, x0, x1, y1 - 0.012, y1, zg, zi);
    slab(g, trim, x0 - 0.07, x0, wy0, y1 + 0.07, zi, zi + 0.03, 0.01);
    slab(g, trim, x1, x1 + 0.07, wy0, y1 + 0.07, zi, zi + 0.03, 0.01);
    slab(g, trim, x0 - 0.07, x1 + 0.07, y1, y1 + 0.07, zi, zi + 0.032, 0.01);
    slab(g, trim, x0 - 0.1, x1 + 0.1, wy0 - 0.045, wy0, zg, zi + 0.12, 0.012);
    // curtains on a rod
    const cc = col(p.curtains, "#b9573e");
    const cm = mat(cc, { rough: 0.95 });
    const rodY = y1 + 0.14, rz = zi + 0.075;
    const rx0 = x0 - 0.3, rx1 = x1 + 0.3;
    rod(g, [rx0, rodY, rz], [rx1, rodY, rz], 0.012, mat(WALNUT), 8);
    for (const x of [rx0, rx1]) put(g, sp(0.026, mat(WALNUT)), x, rodY, rz);
    const ch = rodY - (wy0 - 0.12);
    for (const s of [-1, 1]) {
      const cw = 0.3;
      const c = folded(cw, ch, 0.03, cm, 3, 0.018);
      put(g, c, s < 0 ? x0 - 0.06 - cw / 2 + 0.08 : x1 + 0.06 + cw / 2 - 0.08, rodY - ch / 2 - 0.01, rz + 0.01);
      put(g, rb(cw * 0.7, 0.03, 0.06, mat(shade(cc, -0.12)), 0.012), c.position.x, wy0 + 0.35, rz + 0.03);
    }
    // a little plant on the sill
    const px = wx - ww * 0.26;
    put(g, cy(0.045, 0.034, 0.08, mat("#b8643a"), 10), px, wy0 + 0.04, zi + 0.05);
    for (let i = 0; i < 4; i++) put(g, sp(0.035 + r() * 0.012, mat(pick(r, ["#5f8f3e", "#4c7a3a", "#6f9a44"]), { rough: 0.9 })), px + (r() - 0.5) * 0.06, wy0 + 0.1 + r() * 0.05, zi + 0.05 + (r() - 0.5) * 0.04);
    if (dark) ctx.addLight([wx, wy0 + wh / 2, zi + 0.45], "#ffb35c", 1.5, 3.5);
  }

  // door on the side wall
  if (hasDoor) {
    const dm = mat("#8b5a36", { rough: 0.72 }), dm2 = mat("#9a6840", { rough: 0.72 });
    const z0 = dz - dw / 2, z1 = dz + dw / 2;
    slab(g, dm, xi, xi + 0.045, 0, dh, z0, z1, 0.01);
    for (const [ya, yb] of [[0.16, 0.82], [0.96, dh - 0.14]])
      for (const [za, zb_] of [[z0 + 0.09, dz - 0.035], [dz + 0.035, z1 - 0.09]]) slab(g, dm2, xi + 0.04, xi + 0.058, ya, yb, za, zb_, 0.008);
    slab(g, trim, xi, xi + 0.035, 0, dh + 0.075, z0 - 0.075, z0, 0.008);
    slab(g, trim, xi, xi + 0.035, 0, dh + 0.075, z1, z1 + 0.075, 0.008);
    slab(g, trim, xi, xi + 0.038, dh, dh + 0.075, z0 - 0.075, z1 + 0.075, 0.008);
    put(g, cy(0.022, 0.022, 0.012, brassM(), 10), xi + 0.05, 0.95, z1 - 0.09, 0, 0, Math.PI / 2);
    put(g, sp(0.022, brassM()), xi + 0.075, 0.95, z1 - 0.09);
  }

  // pictures: a landscape on the back wall, a still life on the side wall, a clock if there's room
  const ax0 = xi + 0.15, ax1 = hasWin ? wx - ww / 2 - 0.4 : xr - 0.3;
  const aw = Math.min(0.66, ax1 - ax0 - 0.05);
  if (aw > 0.32) {
    const pg = put(g, group(), hasWin ? (ax0 + ax1) / 2 : -W * 0.12, 1.5, zi + 0.002);
    picture(pg, aw, aw * 0.74, landscapeTex(), WALNUT);
  }
  const bz = zi + 0.6;
  if (!dGap || bz + 0.25 < dGap[0] - 0.05) {
    const pg = put(g, group(), xi + 0.002, 1.45, bz, 0, Math.PI / 2, 0);
    picture(pg, 0.36, 0.48, stillLifeTex(), "#c9a14a");
  }
  const cx0 = hasWin ? wx + ww / 2 + 0.4 : xr;
  if (hasWin && xr - cx0 > 0.4) {
    const cg = put(g, group(), (cx0 + xr) / 2, 1.62, zi + 0.002);
    put(cg, cy(0.13, 0.13, 0.04, mat(WALNUT, { rough: 0.6 }), 16), 0, 0, 0.02, Math.PI / 2, 0, 0);
    put(cg, cy(0.108, 0.108, 0.01, mat(CREAM, { rough: 0.5 }), 16), 0, 0, 0.04, Math.PI / 2, 0, 0);
    put(cg, bx(0.012, 0.075, 0.006, "#2a2622"), 0.025, 0.02, 0.047, 0, 0, -1.1);
    put(cg, bx(0.01, 0.09, 0.006, "#2a2622"), -0.012, 0.04, 0.049, 0, 0, 0.3);
    put(cg, sp(0.012, mat("#b5302c")), 0, 0, 0.05);
  }
  return { group: merged(g) };
}

// ---------- sofa ----------
function sofa(p, ctx) {
  const r = ctx.rand;
  const L = Math.max(1.0, Math.min(4, num(p.length, 1.9)));
  const C = col(p.color, "#3f7f86");
  const fab = mat(C, { rough: 0.95 }), fabD = mat(shade(C, -0.06), { rough: 0.95 }), fabL = mat(shade(C, 0.04), { rough: 0.95 });
  const legM = mat(WALNUT, { rough: 0.7 });
  const D = 0.86, AW = 0.17, LH = 0.09;
  const g = group();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(g, cy(0.024, 0.016, LH, legM, 8), sx * (L / 2 - 0.09), LH / 2, sz * (D / 2 - 0.09));
  put(g, rb(L - 0.02, 0.2, D - 0.04, fabD, 0.05), 0, LH + 0.1, 0);
  put(g, rb(L - 0.02, 0.71, 0.2, fabD, 0.08), 0, LH + 0.355, -D / 2 + 0.1);
  for (const s of [-1, 1]) put(g, rb(AW + 0.02, 0.56, D, fab, 0.085), s * (L / 2 - AW / 2), LH + 0.28, 0);
  const IW = L - 2 * AW;
  const n = IW > 1.15 ? 3 : IW > 0.6 ? 2 : 1;
  const cw = IW / n;
  for (let i = 0; i < n; i++) {
    const x = -IW / 2 + cw * (i + 0.5);
    put(g, rb(cw - 0.012, 0.17, D - 0.24, fab, 0.07, 2), x, 0.375, 0.08, (r() - 0.5) * 0.03, 0, (r() - 0.5) * 0.02);
    put(g, rb(cw - 0.02, 0.44, 0.17, fabL, 0.08, 2), x, 0.66, -D / 2 + 0.27, -0.18 + (r() - 0.5) * 0.04, 0, (r() - 0.5) * 0.03);
  }
  // throw pillows
  const pc = col(p.pillow, "#e0a63c");
  for (const s of [-1, 1]) {
    const pm = mat(s < 0 ? pc : CREAM, { rough: 0.95 });
    put(g, rb(0.34, 0.32, 0.12, pm, 0.06), s * (IW / 2 - 0.19), 0.62, -0.1, -0.3, s * 0.25, s * 0.18);
  }
  return { group: merged(g), top: 0.46 };
}

// ---------- bed ----------
function bed(p, ctx) {
  const r = ctx.rand;
  const dbl = p.size === "double";
  const W = dbl ? 1.48 : 0.98, L = 2.05;
  const C = col(p.color, "#7b9cc6");
  const wood = mat("#8a5a38", { rough: 0.72 }), woodL = mat("#9c6a42", { rough: 0.72 });
  const g = group();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(g, cy(0.03, 0.025, 0.12, wood, 8), sx * (W / 2 - 0.02), 0.06, sz * (L / 2 - 0.06));
  put(g, rb(W + 0.04, 0.18, L - 0.06, wood, 0.03), 0, 0.19, 0);
  // headboard and footboard with rounded top rails
  put(g, rb(W + 0.12, 0.98, 0.07, wood, 0.03), 0, 0.49, -L / 2 + 0.035);
  put(g, rb(W - 0.12, 0.42, 0.02, woodL, 0.01), 0, 0.7, -L / 2 + 0.075);
  put(g, cy(0.05, 0.05, W + 0.16, woodL, 12), 0, 0.98, -L / 2 + 0.035, 0, 0, Math.PI / 2);
  put(g, rb(W + 0.12, 0.46, 0.06, wood, 0.03), 0, 0.23, L / 2 - 0.03);
  put(g, cy(0.042, 0.042, W + 0.14, woodL, 12), 0, 0.46, L / 2 - 0.03, 0, 0, Math.PI / 2);
  // mattress, duvet, turned-down sheet
  put(g, rb(W - 0.02, 0.2, L - 0.12, mat(CREAM, { rough: 0.95 }), 0.05), 0, 0.38, 0);
  const z0 = -L / 2 + 0.56, z1 = L / 2 - 0.07;
  put(g, rb(W + 0.03, 0.2, z1 - z0, mat(C, { rough: 0.95 }), 0.06, 2), 0, 0.45, (z0 + z1) / 2);
  put(g, rb(W + 0.035, 0.05, 0.14, mat("#f7f2e6", { rough: 0.95 }), 0.024), 0, 0.535, z0 + 0.06, 0.05, 0, 0);
  // folded striped blanket at the foot
  const bc = col(p.blanket, "#d27a3a");
  const bm = tmat("blanket" + bc, () => mat("#fff", { map: stripeTex(bc, "#f1e4c8", 10, false), rough: 0.95 }));
  put(g, rb(W + 0.07, 0.05, 0.42, bm, 0.024), 0, 0.575, z1 - 0.3, 0, (r() - 0.5) * 0.06, 0);
  // pillows
  const pw = dbl ? 0.58 : 0.62;
  const xs = dbl ? [-0.33, 0.33] : [0];
  for (const x of xs) put(g, rb(pw, 0.15, 0.36, mat("#fbf7ee", { rough: 0.95 }), 0.07, 2), x + (r() - 0.5) * 0.03, 0.56, -L / 2 + 0.29, -0.35, (r() - 0.5) * 0.1, 0);
  return { group: merged(g), top: 0.55 };
}

// ---------- kitchen ----------
function kitchen(p, ctx) {
  const r = ctx.rand;
  const L = Math.max(1.2, Math.min(6, num(p.length, 2.4)));
  const C = col(p.color, "#8db8a6");
  const D = 0.62, TOP = 0.92, zb = -D / 2;
  const cab = mat(C, { rough: 0.7 }), cabD = mat(shade(C, -0.08), { rough: 0.7 }), cabL = mat(shade(C, 0.04), { rough: 0.7 });
  const wood = mat(HONEY, { rough: 0.6 });
  const steel = steelM(), brass = brassM();
  const enamel = mat("#ece3cf", { rough: 0.45 });
  const blk = mat("#232327", { rough: 0.5 });
  const g = group();
  // base run
  put(g, bx(L - 0.04, 0.1, D - 0.14, cabD), 0, 0.05, -0.05);
  put(g, rb(L, 0.78, D - 0.06, cab, 0.02), 0, 0.49, -0.03);
  put(g, rb(L + 0.03, 0.04, D + 0.02, wood, 0.012), 0, TOP - 0.02, 0);
  const n = Math.max(2, Math.round(L / 0.6)), uw = L / n;
  const si = Math.max(0, Math.floor(n / 2) - 1);
  const ki = n - 1;
  const fz = D / 2 - 0.06 + 0.011; // fronts
  const ux = (i) => -L / 2 + uw * (i + 0.5);
  for (let i = 0; i < n; i++) {
    const x = ux(i);
    if (i === si) {
      // cream enamel range: control strip, oven door with a window and a bar handle, tea towel
      put(g, bx(uw - 0.03, 0.11, 0.022, enamel), x, 0.8, fz);
      for (let k = 0; k < 4; k++) put(g, cy(0.017, 0.017, 0.025, blk, 6), x + (k - 1.5) * (uw - 0.16) / 3, 0.8, fz + 0.02, Math.PI / 2, 0, 0);
      put(g, rb(uw - 0.03, 0.6, 0.03, enamel, 0.012), x, 0.43, fz + 0.004);
      put(g, bx(uw - 0.18, 0.26, 0.006, mat("#2b2522", { rough: 0.25, clay: false })), x, 0.4, fz + 0.02);
      rod(g, [x - uw / 2 + 0.07, 0.66, fz + 0.06], [x + uw / 2 - 0.07, 0.66, fz + 0.06], 0.011, steel, 8);
      for (const s of [-1, 1]) rod(g, [x + s * (uw / 2 - 0.09), 0.66, fz + 0.015], [x + s * (uw / 2 - 0.09), 0.66, fz + 0.06], 0.008, steel, 6);
      const towel = tmat("towel", () => mat("#fff", { map: checkTex("#3d6fa8", "#f7f1e6", 6), rough: 0.95 }));
      put(g, bx(0.17, 0.26, 0.012, towel), x - uw * 0.18, 0.54, fz + 0.075, 0.04, 0, 0.03);
      put(g, bx(0.17, 0.05, 0.03, towel), x - uw * 0.18, 0.67, fz + 0.06);
    } else if (i === ki) {
      for (const s of [-1, 1]) {
        put(g, rb(uw / 2 - 0.025, 0.72, 0.022, cabL, 0.01), x + s * uw / 4, 0.48, fz);
        put(g, sp(0.016, brass, 6, 4), x + s * 0.05, 0.76, fz + 0.02);
      }
    } else {
      put(g, bx(uw - 0.03, 0.15, 0.022, cabL), x, 0.775, fz);
      rod(g, [x - 0.07, 0.775, fz + 0.03], [x + 0.07, 0.775, fz + 0.03], 0.008, brass, 6);
      put(g, rb(uw - 0.03, 0.54, 0.022, cabL, 0.01), x, 0.405, fz);
      put(g, sp(0.016, brass, 6, 4), x + uw / 2 - 0.07, 0.62, fz + 0.02);
    }
  }
  // hob with burners, a pot and a kettle
  const ox = ux(si);
  put(g, bx(uw - 0.06, 0.012, 0.5, blk), ox, TOP + 0.006, 0);
  for (const [bxo, bzo] of [[-0.13, 0.12], [0.13, 0.12], [-0.13, -0.12], [0.13, -0.12]]) put(g, cy(0.06, 0.06, 0.012, mat("#3c3c42", { rough: 0.6 }), 8), ox + bxo, TOP + 0.016, bzo);
  const pot = put(g, group(), ox - 0.13, TOP + 0.022, 0.12);
  const potM = mat("#c8452f", { rough: 0.35 });
  put(pot, lt([[0, 0], [0.1, 0], [0.106, 0.012], [0.106, 0.11], [0.112, 0.118], [0, 0.118]], potM));
  put(pot, lt([[0.11, 0], [0.1, 0.016], [0.06, 0.036], [0, 0.04]], potM), 0, 0.118, 0);
  put(pot, sp(0.016, blk, 6, 4), 0, 0.165, 0);
  for (const s of [-1, 1]) put(pot, bx(0.04, 0.018, 0.03, blk), s * 0.125, 0.1, 0);
  const ket = put(g, group(), ox + 0.13, TOP + 0.022, -0.12, 0, -0.5, 0);
  const ketM = mat("#e2a23c", { rough: 0.35 });
  put(ket, lt([[0, 0], [0.08, 0], [0.094, 0.04], [0.088, 0.1], [0.06, 0.14], [0.028, 0.152], [0, 0.152]], ketM, 10));
  put(ket, sp(0.016, blk, 6, 4), 0, 0.16, 0);
  put(ket, tor(0.065, 0.01, blk, 4, 10, Math.PI), 0, 0.135, 0);
  put(ket, cy(0.011, 0.022, 0.12, ketM, 8), 0.11, 0.09, 0, 0, 0, -0.95);
  // sink with a faucet
  const kx = ux(ki);
  put(g, bx(uw - 0.14, 0.012, 0.42, steel), kx, TOP + 0.006, 0.02);
  put(g, bx(uw - 0.22, 0.004, 0.32, mat("#6b7177", { rough: 0.35, metal: 0.4, clay: false })), kx, TOP + 0.012, 0.03);
  put(g, cy(0.024, 0.028, 0.03, steel, 10), kx, TOP + 0.015, -0.21);
  put(g, tb([[0, 0, 0], [0, 0.2, 0], [0, 0.27, 0.05], [0, 0.24, 0.14]], 0.011, steel, 10, 4), kx, TOP + 0.02, -0.21);
  for (const s of [-1, 1]) put(g, cy(0.014, 0.014, 0.04, steel, 6), kx + s * 0.08, TOP + 0.02, -0.21);
  // utensil crock and a bowl of lemons
  const sx = si + 1 < ki ? ux(si) + uw / 2 + 0.14 : si > 0 ? ux(si) - uw / 2 - 0.14 : null;
  if (sx != null) {
    put(g, cy(0.05, 0.045, 0.13, mat(CREAM, { rough: 0.5 }), 10), sx, TOP + 0.065, -0.17);
    for (const [a, l] of [[-0.25, 0.22], [0.1, 0.25], [0.35, 0.2]]) {
      const tip = [sx + Math.sin(a) * l * 0.5, TOP + 0.04 + l, -0.17 + Math.cos(a) * 0.03];
      rod(g, [sx, TOP + 0.05, -0.17], tip, 0.007, wood, 5);
      put(g, sp(0.022, wood, 6, 4), ...tip).scale.set(1, 1.4, 0.5);
    }
  }
  if (n >= 3) {
    const fx = ux(si === 0 ? 1 : 0);
    if (fx !== sx) {
      put(g, lt([[0, 0], [0.05, 0], [0.1, 0.05], [0.11, 0.06]], mat("#3f6f8f", { rough: 0.4, side: THREE.DoubleSide })), fx, TOP, 0.02);
      for (let k = 0; k < 3; k++) put(g, sp(0.036, mat("#efc93a", { rough: 0.6 }), 6, 4), fx + Math.cos(k * 2.1) * 0.04, TOP + 0.055, 0.02 + Math.sin(k * 2.1) * 0.04, 0, k, 0).scale.set(1, 0.85, 1.25);
    }
  }
  // tiled splashback, upper cabinets, copper hood over the range
  slab(g, tmat("subway", () => mat("#fff", { map: subwayTex(), rough: 0.4 })), -L / 2, L / 2, TOP, TOP + 0.55, zb, zb + 0.02);
  const uy0 = TOP + 0.55, uh = 0.6, ud = 0.32;
  for (let i = 0; i < n; i++) {
    if (i === si) continue;
    const x = ux(i);
    put(g, bx(uw - 0.004, uh, ud, cab), x, uy0 + uh / 2, zb + ud / 2);
    put(g, rb(uw - 0.05, uh - 0.06, 0.022, cabL, 0.01), x, uy0 + uh / 2, zb + ud + 0.008);
    put(g, sp(0.015, brass, 6, 4), x + (i < si ? 1 : -1) * (uw / 2 - 0.07), uy0 + 0.07, zb + ud + 0.024);
  }
  put(g, bx(L, 0.03, ud + 0.02, cabD), 0, uy0 + uh + 0.015, zb + ud / 2 + 0.01);
  const copper = mat("#b87333", { rough: 0.4, metal: 0.5 });
  const hw = uw / 2 - 0.03, hd = 0.44;
  const hoodGeo = new THREE.CylinderGeometry(0.12 / Math.SQRT1_2, hw / Math.SQRT1_2, 0.24, 4, 1);
  hoodGeo.rotateY(Math.PI / 4);
  hoodGeo.scale(1, 1, hd / (2 * hw));
  put(g, new THREE.Mesh(hoodGeo, copper), ox, uy0 + 0.18, zb + hd / 2 + 0.01);
  put(g, bx(2 * hw + 0.02, 0.05, hd + 0.02, copper), ox, uy0 + 0.05, zb + hd / 2 + 0.01);
  put(g, bx(0.24, uh - 0.3, 0.22, copper), ox, uy0 + 0.3 + (uh - 0.3) / 2, zb + 0.12);
  return { group: merged(g), top: TOP };
}

// ---------- desk lamp: green banker's lamp ----------
function deskLamp(p, ctx) {
  const S = 1.15;
  const [g, k] = wrap(S);
  const dark = isDark(ctx.time);
  const C = col(p.color, "#1d6b46");
  const brass = brassM();
  put(k, rb(0.24, 0.035, 0.15, brass, 0.014), 0, 0.0175, 0);
  put(k, cy(0.03, 0.04, 0.02, brass, 12), 0, 0.045, -0.02);
  put(k, cy(0.011, 0.013, 0.28, brass, 8), 0, 0.19, -0.02);
  put(k, sp(0.018, brass, 8, 6), 0, 0.1, -0.02);
  const sy = 0.33, R = 0.075, len = 0.3;
  const shell = (rad) => {
    const geo = new THREE.CylinderGeometry(rad, rad, len, 16, 1, true, -Math.PI / 2, Math.PI);
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(Math.PI / 2);
    return geo;
  };
  const shadeM = mat(C, { rough: 0.22, clay: false, side: THREE.DoubleSide, emissive: C, emissiveIntensity: dark ? 0.45 : 0.15 });
  put(k, new THREE.Mesh(shell(R), shadeM), 0, sy, 0);
  put(k, new THREE.Mesh(shell(R - 0.004), mat("#fff3d6", { emissive: "#ffd79a", emissiveIntensity: 1.6, clay: false, side: THREE.BackSide })), 0, sy, 0);
  for (const s of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.CircleGeometry(R + 0.002, 10, 0, Math.PI), shadeM);
    put(k, cap, s * len / 2, sy, 0, 0, s * Math.PI / 2, 0);
    put(k, tor(R + 0.001, 0.005, brass, 4, 12, Math.PI), s * (len / 2 + 0.002), sy, 0, 0, Math.PI / 2, 0);
  }
  put(k, cap2(0.022, 0.12), 0, sy - 0.004, 0, 0, 0, Math.PI / 2);
  // pull chain
  rod(k, [0.09, sy - 0.01, R - 0.01], [0.09, sy - 0.09, R - 0.01], 0.002, brass, 4);
  put(k, sp(0.008, brass, 6, 4), 0.09, sy - 0.095, R - 0.01);
  ctx.addLight([0, (sy - 0.04) * S, 0.05 * S], "#ffc46e", dark ? 1.6 : 0.9, 2.4);
  return { group: merged(g) };
}
// Glowing tube bulb (capsule along y, rotated by the caller).
function cap2(r, len) {
  return new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, 8), glowMat("#fff1c9", 4));
}

// ---------- monitor ----------
function monitor(p, ctx) {
  const S = 1.1;
  const [g, k] = wrap(S);
  const C = col(p.color, "#2b2d33");
  const m = mat(C, { rough: 0.5 });
  put(k, rb(0.24, 0.016, 0.17, m, 0.006), 0, 0.008, -0.02);
  put(k, rb(0.05, 0.27, 0.025, m, 0.01), 0, 0.15, -0.065, 0.08, 0, 0);
  const W = 0.56, H = 0.34, y = 0.37;
  put(k, rb(W, H, 0.035, m, 0.014), 0, y, -0.03);
  put(k, rb(W * 0.5, H * 0.5, 0.03, m, 0.012), 0, y, -0.055);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.04, H - 0.045), screenMat("code", codeTex(), 1.4));
  put(k, scr, 0, y + 0.005, -0.0118);
  put(k, sp(0.005, glowMat("#9be3b0", 2), 6, 4), W / 2 - 0.04, y - H / 2 + 0.012, -0.012);
  ctx.addLight([0, y * S, 0.25 * S], "#9ec3ff", 0.6, 1.6);
  return { group: merged(g) };
}

// ---------- tv (on a low media console unless it's placed on something) ----------
function tv(p, ctx) {
  const g = group();
  const C = col(p.color, "#26272c");
  const m = mat(C, { rough: 0.45 });
  const onSupport = !!p.on;
  const base = onSupport ? 0 : 0.5;
  if (!onSupport) {
    const wood = mat("#9a6a42", { rough: 0.7 }), woodD = mat("#7a5032", { rough: 0.7 }), front = mat("#a8774b", { rough: 0.7 });
    const cw = 1.3, cd = 0.42;
    put(g, rb(cw, 0.04, cd, wood, 0.012), 0, base - 0.02, 0);
    put(g, rb(cw - 0.04, 0.32, cd - 0.04, woodD, 0.012), 0, 0.3, 0);
    for (const s of [-1, 1]) {
      put(g, rb(cw / 3 - 0.03, 0.29, 0.02, front, 0.01), s * cw / 3, 0.3, cd / 2 - 0.02);
      put(g, sp(0.014, brassM(), 6, 4), s * (cw / 3 - (cw / 6 - 0.05)), 0.3, cd / 2 - 0.005);
      put(g, cy(0.018, 0.012, 0.14, wood, 6), s * (cw / 2 - 0.08), 0.07, cd / 2 - 0.08);
      put(g, cy(0.018, 0.012, 0.14, wood, 6), s * (cw / 2 - 0.08), 0.07, -cd / 2 + 0.08);
    }
    // open middle cubby: a games console and a few records
    put(g, bx(cw / 3 - 0.03, 0.28, cd - 0.08, mat("#3e2a1c", { rough: 0.9 })), 0, 0.3, 0.01);
    put(g, rb(0.26, 0.05, 0.2, mat("#e9e6e0", { rough: 0.4 }), 0.012), 0, 0.17, 0.03);
    put(g, sp(0.006, glowMat("#7fb7ff", 2), 6, 4), 0.1, 0.17, 0.131);
    for (let i = 0; i < 5; i++) put(g, bx(0.012, 0.22, 0.2, mat(["#c0392b", "#2f4a6b", "#e8dcc0", "#d9a441", "#3f6b5a"][i], { rough: 0.8 })), -0.15 + i * 0.016, 0.33, 0.02, 0, 0, 0.03 * (i - 2));
    // a little plant on the console
    put(g, cy(0.05, 0.04, 0.09, mat("#b8643a"), 10), cw / 2 - 0.12, base + 0.045, -0.05);
    for (const [dx, dy] of [[0, 0.12], [-0.03, 0.1], [0.03, 0.1]]) put(g, sp(0.04, mat("#5f8f3e", { rough: 0.9 }), 7, 5), cw / 2 - 0.12 + dx, base + dy, -0.05);
  }
  const W = 0.96, H = 0.58;
  const y = base + 0.06 + H / 2;
  for (const s of [-1, 1]) put(g, rb(0.04, 0.012, 0.18, m, 0.005), s * 0.34, base + 0.006, 0), rod(g, [s * 0.34, base + 0.01, 0], [s * 0.34, y - 0.12, -0.01], 0.008, m);
  put(g, rb(W, H, 0.045, m, 0.012), 0, y, -0.01);
  put(g, new THREE.Mesh(new THREE.PlaneGeometry(W - 0.04, H - 0.04), screenMat("tv", tvShowTex(), 1.3)), 0, y, 0.0128);
  ctx.addLight([0, y, 0.4], "#a9c8ff", 0.8, 2.5);
  return { group: merged(g), top: onSupport ? undefined : base };
}

// ---------- whiteboard on a rolling stand ----------
function whiteboard(p, ctx) {
  const r = ctx.rand;
  const g = group();
  const frameM = mat("#a9adb2", { rough: 0.4, metal: 0.4 });
  const legM = mat("#5d6168", { rough: 0.5, metal: 0.3 });
  const W = 1.2, H = 0.8, y = 1.17;
  put(g, rb(W + 0.04, H + 0.04, 0.03, frameM, 0.012), 0, y, 0);
  put(g, bx(W - 0.02, H - 0.02, 0.004, mat("#f7f7f2", { rough: 0.35, clay: false })), 0, y, 0.016);
  for (const s of [-1, 1]) {
    const x = s * (W / 2 + 0.05);
    put(g, cy(0.018, 0.018, 1.62, legM, 8), x, 0.85, 0);
    put(g, rb(0.05, 0.04, 0.56, legM, 0.015), x, 0.06, 0);
    for (const z of [-0.25, 0.25]) put(g, sp(0.03, mat("#222"), 6, 4), x, 0.03, z);
    put(g, cy(0.024, 0.024, 0.04, legM, 8), s * (W / 2 + 0.03), y, 0, 0, 0, Math.PI / 2);
  }
  put(g, cy(0.014, 0.014, W + 0.1, legM, 6), 0, 0.28, 0, 0, 0, Math.PI / 2);
  // pen tray with markers and an eraser
  const ty = y - H / 2 - 0.03;
  put(g, rb(0.55, 0.02, 0.07, frameM, 0.006), 0.15, ty, 0.04);
  const inks = ["#2f5fb3", "#c8352b", "#2f8a4a", "#222"];
  for (let i = 0; i < 3; i++) put(g, new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.1, 2, 6), mat(inks[i], { rough: 0.5 })), -0.02 + i * 0.07, ty + 0.02, 0.05, 0, 0, Math.PI / 2);
  put(g, rb(0.11, 0.035, 0.045, mat("#2a2a2e"), 0.01), 0.33, ty + 0.025, 0.045);
  // marker scribbles: a box diagram with arrows, a chart, some "words"
  const fz = 0.0195;
  const ink = inks.map((c) => mat(c, { rough: 0.6, clay: false }));
  const line = (m, x0, y0, x1, y1, t = 0.008) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    put(g, bx(len, t, 0.003, m), (x0 + x1) / 2, y + (y0 + y1) / 2, fz, 0, 0, Math.atan2(y1 - y0, x1 - x0));
  };
  const boxd = (m, cx, cyy, w, h) => {
    line(m, cx - w / 2, cyy - h / 2, cx + w / 2, cyy - h / 2);
    line(m, cx - w / 2, cyy + h / 2, cx + w / 2, cyy + h / 2);
    line(m, cx - w / 2, cyy - h / 2, cx - w / 2, cyy + h / 2);
    line(m, cx + w / 2, cyy - h / 2, cx + w / 2, cyy + h / 2);
  };
  boxd(ink[0], -0.42, 0.18, 0.2, 0.12);
  boxd(ink[0], -0.08, 0.18, 0.2, 0.12);
  boxd(ink[2], -0.25, -0.12, 0.22, 0.12);
  line(ink[1], -0.31, 0.18, -0.19, 0.18);
  line(ink[1], -0.2, 0.2, -0.185, 0.18), line(ink[1], -0.2, 0.16, -0.185, 0.18);
  line(ink[1], -0.08, 0.12, -0.2, -0.06);
  line(ink[1], -0.22, -0.04, -0.2, -0.06), line(ink[1], -0.18, -0.045, -0.2, -0.06);
  // a rising chart
  line(ink[3], 0.15, -0.28, 0.15, 0.04, 0.007);
  line(ink[3], 0.15, -0.28, 0.5, -0.28, 0.007);
  put(g, tb([[0.17, -0.25, 0], [0.24, -0.2, 0], [0.31, -0.22, 0], [0.38, -0.12, 0], [0.47, -0.02, 0]].map(([a, b]) => [a, y + b, fz]), 0.005, ink[2], 16, 4));
  put(g, tb([[0.4, 0.3, 0], [0.47, 0.32, 0], [0.52, 0.25, 0], [0.45, 0.2, 0], [0.38, 0.24, 0], [0.42, 0.31, 0]].map(([a, b]) => [a, y + b, fz]), 0.005, ink[1], 16, 4));
  // scribbled "words"
  for (let row = 0; row < 3; row++) {
    let x = 0.14;
    const yy = 0.28 - row * 0.07;
    while (x < (row === 0 ? 0.32 : 0.52)) {
      const w = 0.03 + r() * 0.06;
      line(ink[3], x, yy + (r() - 0.5) * 0.008, x + w, yy + (r() - 0.5) * 0.008, 0.007);
      x += w + 0.02;
    }
  }
  return { group: merged(g) };
}

// ---------- pizza box ----------
function pizzaBox(p, ctx) {
  const r = ctx.rand;
  const open = flag(p.open, false);
  const S = 1.1;
  const [g, k] = wrap(S);
  const B = 0.4, BH = 0.045;
  const card = mat("#cfa877", { rough: 0.95 }), cardL = mat("#dcbf95", { rough: 0.95 });
  if (!open) {
    put(k, rb(B, BH, B, card, 0.006), 0, BH / 2, 0);
    put(k, bx(B - 0.05, 0.002, B - 0.05, tmat("pizzaprint", () => mat("#fff", { map: pizzaPrintTex(), rough: 0.9 }))), 0, BH + 0.001, 0);
    return { group: merged(g), top: BH * S };
  }
  const t = 0.006;
  put(k, bx(B, t, B, card), 0, t / 2, 0);
  for (const s of [-1, 1]) {
    put(k, bx(B, BH, t, card), 0, BH / 2, s * (B / 2 - t / 2));
    put(k, bx(t, BH, B, card), s * (B / 2 - t / 2), BH / 2, 0);
  }
  const lid = put(k, group(), 0, BH, -B / 2, -THREE.MathUtils.degToRad(102), 0, 0);
  put(lid, bx(B, t, B, cardL), 0, t / 2, B / 2);
  put(lid, bx(B, 0.035, t, card), 0, -0.0175 + t, B - t / 2);
  // pizza: eight slices, one already gone
  const R = 0.17;
  const crust = mat("#d9a25a", { rough: 0.8 }), cheese = mat("#f2c14e", { rough: 0.6 }), pep = mat("#a8322a", { rough: 0.6 }), basil = mat("#3f7a3a", { rough: 0.8 });
  const wedge = (rad, a0, a1, h) => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.absarc(0, 0, rad, a0, a1, false);
    s.lineTo(0, 0);
    const geo = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 4 });
    geo.rotateX(-Math.PI / 2);
    return geo;
  };
  const gone = Math.floor(r() * 8);
  for (let i = 0; i < 8; i++) {
    if (i === gone) continue;
    const a0 = (i / 8) * Math.PI * 2, a1 = a0 + Math.PI / 4, b = (a0 + a1) / 2;
    const ox = Math.cos(b) * 0.004, oz = -Math.sin(b) * 0.004;
    const sl = put(k, group(), ox, t, oz);
    sl.add(new THREE.Mesh(wedge(R, a0 + 0.012, a1 - 0.012, 0.012), crust));
    put(sl, new THREE.Mesh(wedge(R - 0.018, a0 + 0.03, a1 - 0.03, 0.005), cheese), 0, 0.012, 0);
    const cr = new THREE.TorusGeometry(R - 0.01, 0.011, 4, 4, a1 - a0 - 0.03);
    cr.rotateZ(a0 + 0.015);
    cr.rotateX(-Math.PI / 2);
    put(sl, new THREE.Mesh(cr, crust), 0, 0.013, 0);
    for (const [rr, da] of [[0.11, -0.12], [0.06, 0.1]]) put(sl, cy(0.019, 0.019, 0.004, pep, 8), Math.cos(b + da) * rr, 0.018, -Math.sin(b + da) * rr);
    if (i % 3 === 0) put(sl, sp(0.01, basil, 5, 3), Math.cos(b) * 0.085, 0.018, -Math.sin(b) * 0.085).scale.set(1.3, 0.3, 0.8);
  }
  return { group: merged(g) };
}

// ---------- backpack ----------
function backpack(p, ctx) {
  const r = ctx.rand;
  const C = col(p.color, "#c0453a");
  const m = mat(C, { rough: 0.85 }), mD = mat(shade(C, -0.08), { rough: 0.85 }), strap = mat(shade(C, -0.2), { rough: 0.85 });
  const zip = mat("#2a2622", { rough: 0.6 });
  const g = group();
  const b = put(g, group(), 0, 0, 0, -0.06, (r() - 0.5) * 0.3, 0);
  put(b, rb(0.32, 0.44, 0.2, m, 0.09, 2), 0, 0.225, 0);
  put(b, rb(0.3, 0.05, 0.19, strap, 0.02), 0, 0.025, 0);
  put(b, rb(0.24, 0.19, 0.07, mD, 0.035), 0, 0.15, 0.11);
  put(b, bx(0.2, 0.008, 0.006, zip), 0, 0.235, 0.145);
  put(b, bx(0.012, 0.03, 0.006, mat(BRASS)), 0.07, 0.22, 0.149);
  put(b, tor(0.12, 0.006, zip, 3, 14, Math.PI), 0, 0.3, 0.098);
  put(b, tor(0.04, 0.011, strap, 4, 8, Math.PI), 0, 0.44, -0.02);
  for (const s of [-1, 1]) put(b, tb([[s * 0.08, 0.42, -0.07], [s * 0.085, 0.36, -0.15], [s * 0.09, 0.2, -0.16], [s * 0.1, 0.06, -0.11]], 0.016, strap, 10, 5));
  return { group: merged(g), top: 0.44 };
}

// ---------- bin: a wastebasket with crumpled paper ----------
function bin(p, ctx) {
  const r = ctx.rand;
  const C = col(p.color, "#5f7f8a");
  const g = group();
  const m = mat(C, { rough: 0.6 });
  put(g, lt([[0, 0], [0.13, 0], [0.135, 0.01], [0.16, 0.4], [0.168, 0.405], [0.168, 0.415], [0.152, 0.415], [0.128, 0.03], [0, 0.03]], m, 18));
  put(g, tor(0.148, 0.006, mat(shade(C, -0.12)), 4, 18), 0, 0.14, 0, Math.PI / 2, 0, 0);
  const paper = mat("#f4efe2", { rough: 0.9, flat: true });
  const ball = (x, y, z, s) => put(g, new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), paper), x, y, z, r() * 3, r() * 3, r() * 3);
  ball(0.03, 0.38, 0.02, 0.055);
  ball(-0.06, 0.37, -0.04, 0.05);
  ball(0.05, 0.4, -0.06, 0.045);
  ball(-0.02, 0.42, 0.06, 0.045);
  ball(0.25, 0.04, 0.12, 0.042);
  return { group: merged(g) };
}

// ---------- rug ----------
function rug(p, ctx) {
  const [w, d] = size2(p.size, [2.0, 1.4]).map((v) => Math.max(0.3, Math.min(8, v)));
  const pattern = ["plain", "stripes", "persian"].includes(p.pattern) ? p.pattern : "persian";
  const C = col(p.color, pattern === "persian" ? "#9e2f2a" : "#b5523b");
  const g = group();
  const T = 0.032;
  const m = tmat(`rug-${pattern}-${C}-${w}-${d}`, () => mat("#fff", { map: rugTex(pattern, C, w, d), rough: 1 }));
  const geo = new RoundedBoxGeometry(w, T, d, 1, 0.012);
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) uv.set([pos.getX(i) / w + 0.5, 0.5 - pos.getZ(i) / d], 2 * i);
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  put(g, new THREE.Mesh(geo, m), 0, T / 2, 0);
  if (pattern !== "plain") {
    // fringe on the short ends
    const along = w >= d;
    const L = along ? d : w, E = along ? w : d;
    const fm = mat("#efe6d0", { rough: 0.95 });
    const n = Math.floor((L - 0.06) / 0.03);
    for (const s of [-1, 1])
      for (let i = 0; i <= n; i++) {
        const t = -L / 2 + 0.03 + i * ((L - 0.06) / n);
        const tassel = bx(along ? 0.05 : 0.012, 0.005, along ? 0.012 : 0.05, fm);
        if (along) put(g, tassel, s * (E / 2 + 0.02), 0.004, t, 0, (Math.sin(i * 7.3) * 0.25), 0);
        else put(g, tassel, t, 0.004, s * (E / 2 + 0.02), 0, (Math.sin(i * 7.3) * 0.25), 0);
      }
  }
  return { group: merged(g) };
}

export const parts = {
  room,
  sofa,
  bed,
  kitchen,
  "desk-lamp": deskLamp,
  monitor,
  tv,
  whiteboard,
  "pizza-box": pizzaBox,
  backpack,
  bin,
  rug,
};
