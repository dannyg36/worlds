import * as THREE from "three";

export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeNoise(seed) {
  const rand = mulberry32(seed);
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const vals = Float32Array.from({ length: 256 }, () => rand());
  const fade = (t) => t * t * (3 - 2 * t);
  const at = (x, y) => vals[perm[(x & 255) + perm[y & 255]]];
  function n2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const u = fade(x - xi), v = fade(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, oct = 4) {
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      s += amp * n2(x * f + i * 17.3, y * f - i * 9.1);
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return s / norm;
  }
  return { n2, fbm };
}

const NAMED = {
  gold: 0xe9b949, "warm gold": 0xf2b84b, amber: 0xffb03b, teal: 0x2e7d7a, "teal shadows": 0x2b5d63,
  "ocean blue": 0x2a76b0, blue: 0x3a7bd5, sky: 0x8cc8f0, sand: 0xe4cf9e, "cypress green": 0x3e6b3c, green: 0x4f8a3c,
  "sun-bleached wood": 0xcdb999, wood: 0xa0703f, orange: 0xf28c28, red: 0xd9432f, pink: 0xf2a0b5, purple: 0x7d5ba6,
  white: 0xf3efe6, grey: 0x9a9a9a, gray: 0x9a9a9a, black: 0x222222, cream: 0xf3e5c0, peach: 0xf6b48f, navy: 0x1f3a5f,
  coral: 0xf27d6b, lavender: 0xb7a6e0, mint: 0x9fe0c0, brown: 0x7a5230, rose: 0xe8768a, silver: 0xc0c4c8,
  terracotta: 0xc8643b, olive: 0x7a7d3a, ochre: 0xcc8a2e, crimson: 0xb3202f, snow: 0xf4f6fa, slate: 0x5a6878,
};

export function parsePalette(str) {
  return String(str || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((name) => {
      if (NAMED[name] != null) return { name, color: new THREE.Color(NAMED[name]) };
      const words = name.split(/[\s-]+/);
      for (const w of [...words].reverse()) if (NAMED[w] != null) return { name, color: new THREE.Color(NAMED[w]) };
      return { name, color: new THREE.Color().setHSL((hashString(name) % 360) / 360, 0.45, 0.55) };
    });
}

const pick = (palette, re, fallback) => (palette.find((p) => re.test(p.name))?.color ?? new THREE.Color(fallback)).clone();

export function lightPreset(timeOfDay) {
  const t = String(timeOfDay || "").toLowerCase();
  if (/sunset|golden|dusk|evening/.test(t)) return { sun: 0xffa45a, sunI: 2.7, elev: 13, hemiSky: 0xffd2a0, hemiGround: 0x2f5560, hemiI: 1.05, env: 0.55, exposure: 1.0 };
  if (/sunrise|dawn/.test(t)) return { sun: 0xffb98a, sunI: 2.3, elev: 10, hemiSky: 0xf7c9d6, hemiGround: 0x4b4a6a, hemiI: 1.0, env: 0.55, exposure: 1.0 };
  if (/night|midnight/.test(t)) return { sun: 0x9fb4ff, sunI: 0.7, elev: 40, hemiSky: 0x33406a, hemiGround: 0x1a1a24, hemiI: 0.8, env: 0.4, exposure: 1.1 };
  if (/noon|midday|afternoon/.test(t)) return { sun: 0xfff1d8, sunI: 2.9, elev: 62, hemiSky: 0xcfe7ff, hemiGround: 0xcbb68e, hemiI: 0.95, env: 0.6, exposure: 1.0 };
  return { sun: 0xfff0d0, sunI: 2.6, elev: 35, hemiSky: 0xd6ebff, hemiGround: 0xb8a888, hemiI: 0.95, env: 0.6, exposure: 1.0 };
}

function canvasTexture(size, draw) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function woodTexture(base, rand) {
  return canvasTexture(1024, (ctx, S) => {
    const planks = 8, w = S / planks;
    for (let i = 0; i < planks; i++) {
      let pos = -rand() * 500;
      while (pos < S) {
        const len = 260 + rand() * 420;
        const col = base.clone().multiplyScalar(0.78 + rand() * 0.34);
        ctx.fillStyle = "#" + col.getHexString();
        ctx.fillRect(i * w, pos, w, len);
        for (let k = 0; k < 7; k++) {
          ctx.strokeStyle = "rgba(70,35,12," + (0.05 + rand() * 0.08).toFixed(3) + ")";
          ctx.lineWidth = 1 + rand() * 2;
          const x = i * w + rand() * w;
          ctx.beginPath();
          ctx.moveTo(x, pos);
          ctx.bezierCurveTo(x + (rand() - 0.5) * 12, pos + len * 0.3, x + (rand() - 0.5) * 12, pos + len * 0.7, x + (rand() - 0.5) * 6, pos + len);
          ctx.stroke();
        }
        ctx.fillStyle = "rgba(45,22,8,0.55)";
        ctx.fillRect(i * w, pos, w, 3);
        pos += len;
      }
      ctx.fillStyle = "rgba(45,22,8,0.6)";
      ctx.fillRect(i * w, 0, 3, S);
    }
  });
}

function speckleTexture(rand, strength = 0.18) {
  return canvasTexture(256, (ctx, S) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
      const v = Math.floor(255 * (1 - rand() * strength));
      ctx.fillStyle = "rgb(" + v + "," + v + "," + v + ")";
      const r = 0.5 + rand() * 1.8;
      ctx.fillRect(rand() * S, rand() * S, r, r);
    }
  });
}

function waterNormalTexture(noise) {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(S, S);
  const h = (x, y) => noise.fbm((x / S) * 8, (y / S) * 8, 3);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (h((x + 1) % S, y) - h((x - 1 + S) % S, y)) * 6;
      const dy = (h(x, (y + 1) % S) - h(x, (y - 1 + S) % S)) * 6;
      const n = new THREE.Vector3(-dx, -dy, 1).normalize();
      const i = (y * S + x) * 4;
      img.data[i] = (n.x * 0.5 + 0.5) * 255;
      img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function radialAlphaTexture(inner) {
  return canvasTexture(256, (ctx, S) => {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, "#fff");
    g.addColorStop(inner, "#fff");
    g.addColorStop(1, "#000");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  });
}

function polarGrid(R, rings, segs, heightAt) {
  const pos = [0, heightAt(0, 0), 0];
  for (let i = 1; i <= rings; i++) {
    const r = R * (i / rings);
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      pos.push(x, heightAt(x, z), z);
    }
  }
  const index = [];
  for (let j = 0; j < segs; j++) index.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 1; i < rings; i++) {
    const a0 = 1 + (i - 1) * segs, b0 = 1 + i * segs;
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      index.push(a0 + j, a0 + j1, b0 + j, a0 + j1, b0 + j1, b0 + j);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function describeGround(ground) {
  const desc = ((ground?.type || "") + " " + (ground?.material || "")).toLowerCase();
  return {
    indoor: /floor|office|room|indoor|kitchen|library|restaurant|cafe|café|shop|studio|apartment/.test(desc),
    water: /water|ocean|sea|lake|bay|river/.test(desc),
    sand: /sand|beach/.test(desc),
    grass: /grass|park|meadow|hill|lawn/.test(desc),
    cliff: /cliff|bluff/.test(desc),
  };
}

export function buildGround({ spec, palette, seed, floating }) {
  const R = spec.ground?.island_radius_m || 6;
  const kind = describeGround(spec.ground);
  const rand = mulberry32(seed);
  const noise = makeNoise(seed);
  const group = new THREE.Group();
  group.name = "ground";

  if (kind.indoor) {
    const wood = pick(palette, /wood/, 0xa8743f).lerp(pick(palette, /gold|amber|warm/, 0xd9a050), 0.18);
    const map = woodTexture(wood, rand);
    map.repeat.set(R / 2, R / 2);
    const floorMat = new THREE.MeshStandardMaterial({ map, roughness: 0.62, metalness: 0 });
    if (!floating) {
      floorMat.alphaMap = radialAlphaTexture(0.82);
      floorMat.transparent = true;
    }
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R + (floating ? 0 : 1.2), 128).rotateX(-Math.PI / 2), floorMat);
    floor.receiveShadow = true;
    floor.renderOrder = -1;
    floor.position.y = 0.004;
    floor.name = "floor";
    group.add(floor);
    const rug = new THREE.Mesh(new THREE.CircleGeometry(R * 0.42, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: pick(palette, /teal|blue|green/, 0x2e6b6b).multiplyScalar(0.85), roughness: 1, map: speckleTexture(rand, 0.3) }));
    rug.scale.set(1.35, 1, 0.8);
    rug.position.y = 0.009;
    rug.receiveShadow = true;
    rug.name = "rug";
    group.add(rug);
    if (floating) addIslandBase(group, R, wood.clone().multiplyScalar(0.55), 0x4b3a2c);
    return {
      group, R, kind,
      heightAt: () => 0,
      isLand: (x, z) => Math.hypot(x, z) < R - 0.25,
      isWater: () => false,
      waterLevel: null,
      update() {},
    };
  }

  const cliffH = kind.cliff ? 1.5 : 0.5;
  const coastDir = new THREE.Vector2(0, -1);
  const coastS = (t) => 0.4 + 1.6 * (noise.fbm(t * 0.12 + 3.1, 0.5, 3) - 0.5);
  const rampCenter = -2.6;
  const heightAt = (x, z) => {
    const t = x;
    const s = x * coastDir.x + z * coastDir.y;
    const d = s - (kind.water ? coastS(t) : 99);
    const ramp = 1 - smooth(0.9, 2.2, Math.abs(t - rampCenter));
    const faceW = 0.6 + ramp * 3.4;
    const top = cliffH + 0.22 * (noise.fbm(x * 0.22, z * 0.22) - 0.5) + 0.05 * Math.max(0, -d - 2) * 0.2;
    const beach = 0.28 - 0.95 * smooth(0, 3.6, d - faceW);
    let h = top + (beach - top) * smooth(0, faceW, d);
    if (d > faceW + 3.6) h = Math.min(h, -0.67 - 0.25 * (d - faceW - 3.6));
    const r = Math.hypot(x, z);
    h = h + (-1.3 - h) * smooth(R - 1.6, R + 0.6, r);
    return h;
  };
  const pathPoints = [];
  for (let t = -R; t <= R; t += 0.5) {
    const s = coastS(t) - 2.4 - 0.5 * Math.sin(t * 0.35);
    const x = t, z = -s;
    if (Math.hypot(x, z) < R - 0.8) pathPoints.push(new THREE.Vector2(x, z));
  }
  const distToPath = (x, z) => {
    let best = Infinity;
    for (let i = 0; i < pathPoints.length - 1; i++) {
      const a = pathPoints[i], b = pathPoints[i + 1];
      const abx = b.x - a.x, abz = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.y) * abz) / (abx * abx + abz * abz)));
      best = Math.min(best, Math.hypot(x - (a.x + abx * t), z - (a.y + abz * t)));
    }
    return best;
  };

  const geo = polarGrid(R + 1.0, 56, 160, heightAt);
  const grass = pick(palette, /green|grass/, 0x6f9a4a).lerp(new THREE.Color(0x9cc067), 0.45);
  const sand = pick(palette, /sand/, 0xe2cd9a);
  const rock = sand.clone().lerp(new THREE.Color(0xa77c52), 0.55);
  const path = sand.clone().lerp(new THREE.Color(0x9c7b52), 0.35);
  const wet = sand.clone().multiplyScalar(0.72);
  const foam = new THREE.Color(0xf4f1e8);
  const posAttr = geo.getAttribute("position");
  const nrmAttr = geo.getAttribute("normal");
  const colors = new Float32Array(posAttr.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i);
    const slope = 1 - nrmAttr.getY(i);
    const n = noise.fbm(x * 0.8, z * 0.8, 3);
    if (y > cliffH * 0.55) c.copy(grass).multiplyScalar(0.85 + n * 0.3);
    else if (y > 0.12) c.copy(sand).multiplyScalar(0.92 + n * 0.16);
    else if (y > -0.04) c.copy(foam);
    else c.copy(wet);
    if (slope > 0.22 && y > 0.1) c.lerp(rock, smooth(0.22, 0.4, slope));
    if (y > cliffH * 0.55) c.lerp(path, 1 - smooth(0.35, 0.65, distToPath(x, z)));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const detail = speckleTexture(rand, 0.22);
  detail.repeat.set(R, R);
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.95, metalness: 0 }));
  geo.attributes.uv = new THREE.Float32BufferAttribute(Array.from({ length: posAttr.count * 2 }, (_, k) => (k % 2 === 0 ? posAttr.getX(k >> 1) : posAttr.getZ(k >> 1)) / (2 * R) + 0.5), 2);
  terrain.receiveShadow = true;
  terrain.name = "terrain";
  group.add(terrain);

  let water = null;
  let waterNormal = null;
  if (kind.water) {
    waterNormal = waterNormalTexture(noise);
    waterNormal.repeat.set(90, 90);
    water = new THREE.Mesh(
      new THREE.CircleGeometry(360, 96).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: pick(palette, /ocean|blue|sea|water/, 0x2a76b0).multiplyScalar(0.75), roughness: 0.16, metalness: 0.05, normalMap: waterNormal, normalScale: new THREE.Vector2(0.45, 0.45), envMapIntensity: 1.2 }),
    );
    water.receiveShadow = true;
    water.name = "water";
    group.add(water);
  } else if (floating) {
    addIslandBase(group, R + 1.0, rock.clone().multiplyScalar(0.8), 0x5b4636);
  }

  return {
    group, R, kind, coastDir, coastS, pathPoints, cliffH,
    heightAt,
    isLand: (x, z) => Math.hypot(x, z) < R + 0.2 && heightAt(x, z) > 0.12,
    isWater: (x, z) => heightAt(x, z) < -0.25,
    waterLevel: kind.water ? 0 : null,
    update(t) {
      if (waterNormal) waterNormal.offset.set(t * 0.012, t * 0.007);
    },
  };
}

function addIslandBase(group, R, rimColor, bottomColor) {
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.96, 0.32, 128, 1, true), new THREE.MeshStandardMaterial({ color: rimColor, roughness: 0.8 }));
  skirt.position.y = -0.16;
  group.add(skirt);
  const under = new THREE.Mesh(new THREE.ConeGeometry(R * 0.96, R * 0.75, 64, 1, true), new THREE.MeshStandardMaterial({ color: bottomColor, roughness: 1, side: THREE.DoubleSide }));
  under.rotation.x = Math.PI;
  under.position.y = -0.32 - R * 0.375;
  group.add(under);
}

const PERSON = /person|people|man|woman|kid|child|friend|surfer|hiker|runner|player|guitarist|chef|student|cyclist/;
const TREE = /tree|cypress|palm|pine|oak|bush/;
const ANIMAL = /dog|cat|sea ?lion|seal|cow|bird|duck|horse|goose/;

export function parsePlace(place, ids, selfId) {
  const p = String(place || "").toLowerCase();
  const ref = ids.find((id) => id !== selfId && new RegExp("\\b" + id.replace(/[^a-z0-9]/g, ".") + "s?\\b").test(p));
  if (ref) {
    if (/^on\b|\bon top\b|\bon the\b|\bon\s/.test(p)) return { kind: "on", ref };
    if (/around|surround|circle/.test(p)) return { kind: "around", ref };
    return { kind: "near", ref };
  }
  if (/center|centre|middle/.test(p)) return { kind: "center" };
  if (/backdrop|behind|background|back wall/.test(p)) return { kind: "backdrop" };
  if (/over (the )?water|on stilts|pier/.test(p)) return { kind: "over-water" };
  if (/in (the )?water|waves|in the sea|in the ocean|in the lake/.test(p)) return { kind: "in-water" };
  if (/path|road|trail|street|sidewalk/.test(p)) return { kind: "path" };
  if (/cliff/.test(p)) return { kind: "cliff-edge" };
  if (/edge|rim|corner|wall/.test(p)) return { kind: "edge" };
  return { kind: "scatter" };
}

function obbCorners(o) {
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => {
    const lx = a * o.hx, lz = b * o.hz;
    return [o.x + lx * c + lz * s, o.z - lx * s + lz * c];
  });
}

function obbOverlap(a, b, margin = 0) {
  const A = { ...a, hx: a.hx + margin, hz: a.hz + margin };
  const ca = obbCorners(A), cb = obbCorners(b);
  const axes = [a.yaw, a.yaw + Math.PI / 2, b.yaw, b.yaw + Math.PI / 2].map((t) => [Math.cos(t), -Math.sin(t)]);
  for (const [ax, az] of axes) {
    const pa = ca.map(([x, z]) => x * ax + z * az), pb = cb.map(([x, z]) => x * ax + z * az);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
  }
  return true;
}

export function layoutWorld({ objects, templates, ground, seed, raycastDown, spawn }) {
  const rand = mulberry32(seed);
  const ids = objects.map((o) => o.id);
  const rules = new Map(objects.map((o) => [o.id, parsePlace(o.place, ids, o.id)]));
  const hero = objects.find((o) => rules.get(o.id).kind === "center") ?? [...objects].sort((a, b) => b.size_m - a.size_m)[0];
  const depth = (o, seen = new Set()) => {
    const r = rules.get(o.id);
    if (!r.ref || seen.has(o.id)) return 0;
    seen.add(o.id);
    return 1 + depth(objects.find((x) => x.id === r.ref), seen);
  };
  const ordered = [...objects].sort((a, b) => {
    const ka = rules.get(a.id).kind === "center" ? -1 : 0, kb = rules.get(b.id).kind === "center" ? -1 : 0;
    return ka - kb || depth(a) - depth(b) || b.size_m - a.size_m;
  });
  const R = ground.R;
  const placed = [];
  const blockers = [{ x: spawn.x, z: spawn.z, hx: 0.9, hz: 0.9, yaw: 0, id: "spawn" }];
  const faceYaw = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
  const byId = (id) => placed.filter((p) => p.id === id);

  for (const o of ordered) {
    const tpl = templates.get(o.id);
    if (!tpl) continue;
    const rule = rules.get(o.id);
    const text = (o.id + " " + o.prompt).toLowerCase();
    const isPerson = PERSON.test(text), isTree = TREE.test(text), isAnimal = ANIMAL.test(text);
    const hx0 = tpl.size.x / 2, hz0 = tpl.size.z / 2;
    const footR = Math.max(hx0, hz0);
    const refs = rule.ref ? byId(rule.ref) : [];
    const ref = refs[0];
    for (let i = 0; i < (o.count || 1); i++) {
      const jitter = isPerson ? 0.94 + rand() * 0.12 : 1;
      let best = null;
      const consider = (x, z, yaw, extra = {}) => {
        const cand = { x, z, yaw, hx: hx0 * jitter, hz: hz0 * jitter, ...extra };
        const others = cand.parent ? placed.filter((p) => p.parent === cand.parent) : [...blockers, ...placed.filter((p) => !p.parent)];
        let overlaps = 0;
        for (const b of others) if (obbOverlap(cand, b, 0.05)) overlaps++;
        const score = overlaps * 10 + (extra.penalty || 0);
        if (!best || score < best.score) best = { ...cand, score };
        return overlaps === 0 && !extra.penalty;
      };
      const tries = 60;
      if (rule.kind === "center") {
        const yaw = tpl.size.z > tpl.size.x ? Math.PI / 2 : 0;
        consider(0, 0, yaw);
      } else if (rule.kind === "on" && ref && raycastDown) {
        const c = Math.cos(ref.yaw), s = Math.sin(ref.yaw);
        const hits = [];
        for (let k = 0; k < 80; k++) {
          const lx = (rand() * 2 - 1) * Math.max(0.05, ref.hx * 0.8 - footR * 0.6);
          const lz = (rand() * 2 - 1) * Math.max(0.05, ref.hz * 0.8 - footR * 0.6);
          const x = ref.x + lx * c + lz * s, z = ref.z - lx * s + lz * c;
          const hit = raycastDown(ref.object, x, z);
          if (hit && hit.normalY > 0.8) hits.push({ x, z, y: hit.y });
        }
        const bins = new Map();
        for (const h of hits) {
          const k = Math.round(h.y / 0.04);
          bins.set(k, (bins.get(k) || 0) + 1);
        }
        const topBin = [...bins.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        const surface = hits.filter((h) => Math.abs(Math.round(h.y / 0.04) - topBin) <= 1);
        for (const h of surface.slice(0, tries)) {
          if (consider(h.x, h.z, faceYaw(h.x, h.z, spawn.x, spawn.z) + (rand() - 0.5) * 0.5, { y: h.y, parent: ref })) break;
        }
        if (!surface.length) consider(ref.x, ref.z, 0, { y: ref.y + ref.height, parent: ref });
      } else if (rule.kind === "around" && ref) {
        const n = o.count || 1;
        const c = Math.cos(ref.yaw), s = Math.sin(ref.yaw);
        const ex = ref.hx + footR * 0.75 + 0.25, ez = ref.hz + footR * 0.75 + 0.25;
        const per = 4 * (ex + ez);
        const start = 0.5 / n + rand() * 0.1;
        for (let k = 0; k < 24; k++) {
          let u = (((i + start) / n + k * 0.013 * (k % 2 ? 1 : -1)) % 1 + 1) % 1;
          let d = u * per, lx, lz;
          if (d < 2 * ex) { lx = -ex + d; lz = ez; }
          else if ((d -= 2 * ex) < 2 * ez) { lx = ex; lz = ez - d; }
          else if ((d -= 2 * ez) < 2 * ex) { lx = ex - d; lz = -ez; }
          else { d -= 2 * ex; lx = -ex; lz = -ez + d; }
          const x = ref.x + lx * c + lz * s, z = ref.z - lx * s + lz * c;
          const hx = hero ? (byId(hero.id)[0] ?? ref) : ref;
          if (consider(x, z, faceYaw(x, z, hx.x, hx.z), { penalty: ground.isLand(x, z) ? 0 : 5 })) break;
        }
      } else if (rule.kind === "near" && ref) {
        for (let k = 0; k < tries; k++) {
          const a = rand() * Math.PI * 2;
          const dist = Math.max(ref.hx, ref.hz) * 0.7 + footR + 0.2 + rand() * 1.2;
          const x = ref.x + Math.sin(a) * dist, z = ref.z + Math.cos(a) * dist;
          if (!ground.isLand(x, z)) continue;
          if (consider(x, z, faceYaw(x, z, ref.x, ref.z) + (rand() - 0.5) * 0.8)) break;
        }
      } else if (rule.kind === "backdrop") {
        for (let k = 0; k < tries; k++) {
          const a = Math.PI + (k === 0 ? 0 : (rand() - 0.5) * 1.2) + (i - ((o.count || 1) - 1) / 2) * 0.45;
          const r = R - hz0 - 0.15;
          const x = Math.sin(a) * r, z = Math.cos(a) * r;
          if (consider(x, z, faceYaw(x, z, 0, 0))) break;
        }
      } else if (rule.kind === "edge" || (rule.kind === "cliff-edge" && !ground.coastS)) {
        for (let k = 0; k < tries; k++) {
          const a = rand() * Math.PI * 2;
          const r = R - footR - 0.35;
          const x = Math.sin(a) * r, z = Math.cos(a) * r;
          if (!ground.isLand(x, z)) continue;
          if (consider(x, z, faceYaw(x, z, 0, 0))) break;
        }
      } else if (rule.kind === "cliff-edge") {
        for (let k = 0; k < tries; k++) {
          const t = (rand() * 2 - 1) * (R - 1.5);
          const s = ground.coastS(t) - 0.5 - (isTree ? 0.4 : footR);
          const x = t, z = -s;
          if (!ground.isLand(x, z) || Math.hypot(x - spawn.x, z - spawn.z) < 2.5) continue;
          if (consider(x, z, rand() * Math.PI * 2)) break;
        }
      } else if (rule.kind === "path" && ground.pathPoints?.length > 1) {
        const pts = ground.pathPoints;
        for (let k = 0; k < tries; k++) {
          const j = Math.floor(rand() * (pts.length - 1));
          const a = pts[j], b = pts[j + 1];
          const tx = b.x - a.x, tz = b.y - a.y, len = Math.hypot(tx, tz);
          const side = rand() < 0.5 ? -1 : 1;
          const off = 0.55 + Math.min(hx0, hz0);
          const x = a.x + (-tz / len) * off * side, z = a.y + (tx / len) * off * side;
          if (!ground.isLand(x, z)) continue;
          const along = Math.atan2(tx, tz);
          const yaw = /bench|chair|seat/.test(text) ? Math.atan2(ground.coastDir.x, ground.coastDir.y) : along + Math.PI / 2;
          if (consider(x, z, yaw)) break;
        }
      } else if (rule.kind === "over-water" && ground.coastS) {
        const t = 2.6 + (rand() - 0.5) * 1.5;
        const along = Math.atan2(ground.coastDir.x, ground.coastDir.y);
        const yaw = hx0 > hz0 ? along + Math.PI / 2 : along;
        const half = Math.max(hx0, hz0);
        const s = ground.coastS(t) + half + 0.4;
        consider(t, -s, yaw, { floating: true, base: -0.9 });
      } else if (rule.kind === "in-water" && ground.waterLevel != null) {
        for (let k = 0; k < tries; k++) {
          const t = (rand() * 2 - 1) * R * 1.3;
          const s = ground.coastS(t) + 5 + rand() * 7;
          const x = t, z = -s;
          if (!ground.isWater(x, z)) continue;
          if (consider(x, z, Math.atan2(-ground.coastDir.x, -ground.coastDir.y) + (rand() - 0.5) * 1.6, { floating: true, base: -tpl.size.y * 0.32 })) break;
        }
      } else {
        for (let k = 0; k < tries; k++) {
          const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * (R - footR - 0.5);
          const x = Math.sin(a) * r, z = Math.cos(a) * r;
          if (!ground.isLand(x, z)) continue;
          if (consider(x, z, isPerson && hero ? faceYaw(x, z, 0, 0) : rand() * Math.PI * 2)) break;
        }
      }
      if (!best) continue;
      const object = tpl.object.clone(true);
      object.scale.multiplyScalar(jitter);
      const groundY = best.y ?? best.base ?? Math.min(ground.heightAt(best.x, best.z), ground.heightAt(best.x + 0.3, best.z), ground.heightAt(best.x - 0.3, best.z), ground.heightAt(best.x, best.z + 0.3), ground.heightAt(best.x, best.z - 0.3)) - 0.02;
      object.position.set(best.x, groundY, best.z);
      object.rotation.y = best.yaw;
      object.updateMatrixWorld(true);
      const p = {
        id: o.id, index: i, object, x: best.x, z: best.z, y: groundY, yaw: best.yaw, hx: best.hx, hz: best.hz,
        height: tpl.size.y * jitter, parent: best.parent ?? null, floating: !!best.floating, overlaps: best.score,
        isPerson, isTree, isAnimal, rule: rule.kind,
        anim: rule.kind === "in-water" ? "bob" : isPerson ? "cheer" : isTree ? "sway" : isAnimal ? "breathe" : null,
        phase: rand() * Math.PI * 2,
      };
      const shrink = isTree ? 0.18 : isPerson ? 0.55 : 0.92;
      p.collider = !p.parent && !p.floating && p.height > 0.25 ? { x: p.x, z: p.z, yaw: p.yaw, hx: Math.max(0.12, p.hx * shrink), hz: Math.max(0.12, p.hz * shrink) } : null;
      if (best.floating && o.size_m >= 3) p.walkable = true;
      placed.push(p);
    }
  }
  return { placed, hero: hero?.id ?? null };
}
