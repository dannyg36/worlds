// Clay figurines: people and dogs. Chunky stop-motion proportions, bead eyes.
// Bodies are built from a few shared unit geometries (scaled per mesh) so a crowd stays cheap.
import { THREE, mat, glowMat, glassMat, group, shade, pick } from "../core.js";

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const Z = V(0, 0, 1);

const GEO = {
  limb: new THREE.CylinderGeometry(1, 1, 1, 10, 1, true),
  joint: new THREE.SphereGeometry(1, 8, 5),
  ball: new THREE.SphereGeometry(1, 10, 7),
  box: new THREE.BoxGeometry(1, 1, 1),
  head: new THREE.SphereGeometry(1, 18, 12),
  bead: new THREE.SphereGeometry(1, 7, 5),
  hairCap: new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI * 0.56),
  disc: new THREE.CylinderGeometry(1, 1, 1, 14),
  smile: new THREE.TorusGeometry(1, 0.24, 4, 8, Math.PI),
  hem: new THREE.TorusGeometry(1, 0.13, 4, 14),
  ring: new THREE.TorusGeometry(1, 0.17, 6, 12, Math.PI),
  torso: new THREE.LatheGeometry(
    [[0, 0], [0.12, 0.005], [0.165, 0.04], [0.18, 0.12], [0.172, 0.24], [0.15, 0.33], [0.105, 0.395], [0.04, 0.425], [0, 0.43]].map(
      ([r, y]) => new THREE.Vector2(r, y),
    ),
    12,
  ),
};

function add(parent, geo, m, pos, scale = 1, rot) {
  const o = new THREE.Mesh(geo, typeof m === "string" ? mat(m) : m);
  o.position.copy(pos);
  if (typeof scale === "number") o.scale.setScalar(scale);
  else o.scale.set(...scale);
  if (rot) o.rotation.set(...rot);
  parent.add(o);
  return o;
}

// Sausage limb from a to b (capsule, so joints are round and seamless). Geometry shared per size.
const capCache = new Map();
function limb(parent, a, b, r, m) {
  const d = b.clone().sub(a);
  const len = Math.max(0.01, Math.round(d.length() * 100) / 100);
  const key = r.toFixed(3) + "|" + len;
  if (!capCache.has(key)) capCache.set(key, new THREE.CapsuleGeometry(r, len, 2, 9));
  const o = new THREE.Mesh(capCache.get(key), m);
  o.position.copy(a).addScaledVector(d, 0.5);
  o.quaternion.setFromUnitVectors(UP, d.normalize());
  parent.add(o);
  return o;
}

// Two-bone solve: elbow/knee position for a target, bending toward `pole`.
function ik(S, W, l1, l2, pole) {
  const d = W.clone().sub(S);
  const len = Math.min(d.length(), (l1 + l2) * 0.995);
  const dir = d.normalize();
  const a = (l1 * l1 - l2 * l2 + len * len) / (2 * len);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const p = pole.clone().normalize();
  const perp = p.addScaledVector(dir, -p.dot(dir)).normalize();
  return { elbow: S.clone().addScaledVector(dir, a).addScaledVector(perp, h), wrist: S.clone().addScaledVector(dir, len) };
}

const SKIN = ["#f3cfb3", "#eab896", "#d39a72", "#b57a52", "#8d5a3b", "#6a4029"];
const SHIRT = ["#d9534f", "#3f7cc4", "#f0b13a", "#5a9e6f", "#e07a5f", "#8e6bbf", "#f2ede2", "#2f7f86", "#e8a0b4", "#f2d16b"];
const PANTS = ["#33415e", "#5b4636", "#2f3640", "#7d6c55", "#46607a", "#9b7a52", "#4b5d3a"];
const HAIR = ["#2b1d16", "#4a2f1f", "#6b4226", "#a8693a", "#dcb46e", "#1d1a1a", "#b5452d"];
const SHOES = ["#3a2a20", "#2b2b2e", "#efe9dd", "#7a3b2e", "#40536b"];
const ACCENT = ["#d64545", "#2f6fb5", "#f2b134", "#3c8a5a", "#e46f9a", "#f08a3c"];
const STYLES = ["short", "long", "bun", "curly", "bald", "cap"];
const POSES = ["sit", "stand", "wave", "walk", "cheer", "play-guitar"];

// Hand targets relative to the shoulder, x pointing outward from the body. pole = elbow bend hint (same convention).
const ARM = {
  down: { off: [0.05, -0.37, 0.05], pole: [0.3, 0, -1] },
  swingF: { off: [0.03, -0.34, 0.16], pole: [0.2, 0, -1] },
  swingB: { off: [0.05, -0.34, -0.15], pole: [0.2, 0, -1] },
  wave: { off: [0.16, 0.32, 0.07], pole: [1, -0.6, 0] },
  cheer: { off: [0.15, 0.36, 0.08], pole: [1, -0.4, 0] },
  table: { off: [-0.06, -0.06, 0.37], pole: [1, -0.7, 0] },
  glass: { off: [-0.02, -0.12, 0.25], pole: [0.3, -1, -0.2] },
  glassSit: { off: [-0.02, -0.03, 0.29], pole: [0.5, -1, 0] },
  phone: { off: [-0.13, -0.06, 0.25], pole: [0.6, -1, 0] },
  umbrella: { off: [0.07, 0.0, 0.17], pole: [0.6, -1, 0] },
};

function armTarget(S, side, key) {
  const a = ARM[key];
  return {
    W: S.clone().add(V(a.off[0] * side, a.off[1], a.off[2])),
    pole: V(a.pole[0] * side, a.pole[1], a.pole[2]),
  };
}

// ---------- held props (origin = centre of the gripping hand) ----------
function glassProp() {
  const g = group();
  add(g, GEO.disc, glassMat(), V(0, -0.045, 0), [0.032, 0.006, 0.032]);
  add(g, GEO.disc, glassMat(), V(0, -0.005, 0), [0.007, 0.08, 0.007]);
  const bowl = new THREE.Mesh(
    new THREE.LatheGeometry([[0.005, 0], [0.032, 0.012], [0.042, 0.05], [0.04, 0.09]].map(([r, y]) => new THREE.Vector2(r, y)), 14),
    glassMat("#e8f4ff", 0.3),
  );
  bowl.position.y = 0.035;
  g.add(bowl);
  add(g, GEO.disc, mat("#8a1d2c", { rough: 0.3, clay: false }), V(0, 0.065, 0), [0.036, 0.04, 0.036]);
  return g;
}

function phoneProp() {
  const g = group();
  add(g, GEO.box, "#2b2b33", V(), [0.075, 0.135, 0.018]);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.062, 0.115), glowMat("#bfe2ff", 1.4));
  screen.position.z = -0.0095;
  screen.rotation.y = Math.PI;
  g.add(screen);
  g.position.y = 0.03;
  g.rotation.x = 0.6;
  const w = group();
  w.add(g);
  return w;
}

function umbrellaProp(color) {
  const g = group();
  const pole = mat("#3a2a22");
  add(g, GEO.limb, pole, V(0, 0.4, 0), [0.012, 0.95, 0.012]);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.012, 6, 10, Math.PI), pole);
  hook.position.set(0.035, -0.07, 0);
  hook.rotation.z = Math.PI;
  g.add(hook);
  const canopy = new THREE.Mesh(
    new THREE.LatheGeometry([[0.62, 0], [0.56, 0.09], [0.42, 0.18], [0.2, 0.25], [0, 0.27]].map(([r, y]) => new THREE.Vector2(r, y)), 8),
    mat(color, { side: THREE.DoubleSide, flat: true }),
  );
  canopy.position.y = 0.66;
  g.add(canopy);
  add(g, GEO.bead, pole, V(0, 0.94, 0), [0.018, 0.03, 0.018]);
  return g;
}

function guitarProp() {
  const g = group();
  const wood = mat("#c98443");
  const dark = mat("#5a3822");
  const R = [Math.PI / 2, 0, 0];
  add(g, GEO.disc, wood, V(0, 0, 0), [0.15, 0.075, 0.15], R);
  add(g, GEO.disc, wood, V(0.165, 0, 0), [0.112, 0.075, 0.112], R);
  add(g, GEO.disc, mat("#2a1810"), V(0.11, 0, 0.036), [0.042, 0.006, 0.042], R);
  add(g, GEO.disc, mat("#e9d2a6"), V(0.11, 0, 0.035), [0.052, 0.004, 0.052], R);
  limb(g, V(0.24, 0, 0.012), V(0.6, 0, 0.012), 0.024, dark);
  add(g, GEO.box, dark, V(0.64, 0, 0.012), [0.1, 0.066, 0.03], [0, 0, -0.12]);
  add(g, GEO.box, dark, V(-0.07, 0, 0.04), [0.025, 0.085, 0.014]);
  const strings = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.022, 0.004), mat("#ece6da", { clay: false, rough: 0.4 }));
  strings.position.set(0.26, 0, 0.04);
  g.add(strings);
  return g;
}

// ---------- head ----------
function buildHead(R, skin, hair, style, capColor, r) {
  const hg = group();
  const S = [1, 0.94, 0.96];
  const skinM = mat(skin);
  add(hg, GEO.head, skinM, V(), [R * S[0], R * S[1], R * S[2]]);
  // Place something on the face surface, z axis along the surface normal.
  const surf = (x, y, lift = 0) => {
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    const n = V(x, y, z).normalize();
    return { pos: V(x * R * S[0], y * R * S[1], z * R * S[2]).addScaledVector(n, lift * R), q: new THREE.Quaternion().setFromUnitVectors(Z, n) };
  };
  const onFace = (geo, m, x, y, scale, lift = 0) => {
    const s = surf(x, y, lift);
    const o = add(hg, geo, m, s.pos, scale);
    o.quaternion.copy(s.q);
    return o;
  };
  const eyeM = mat("#1c1412", { rough: 0.25, clay: false });
  const e = R * 0.125;
  onFace(GEO.bead, eyeM, 0.3, -0.04, [e, e * 1.2, e * 0.6]);
  onFace(GEO.bead, eyeM, -0.3, -0.04, [e, e * 1.2, e * 0.6]);
  const blush = "#" + new THREE.Color(skin).lerp(new THREE.Color("#ff6f7a"), 0.42).getHexString();
  onFace(GEO.bead, mat(blush), 0.5, -0.3, [R * 0.17, R * 0.12, R * 0.05]);
  onFace(GEO.bead, mat(blush), -0.5, -0.3, [R * 0.17, R * 0.12, R * 0.05]);
  onFace(GEO.bead, mat(shade(skin, -0.03)), 0, -0.2, [R * 0.15, R * 0.13, R * 0.12]);
  const smile = onFace(GEO.smile, mat("#6e2e26", { clay: false, rough: 0.6 }), 0, -0.42, R * 0.17);
  smile.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(Z, Math.PI));
  // Brows give the face its warmth.
  const browM = mat(shade(hair, -0.05));
  for (const sx of [1, -1]) {
    const b = onFace(GEO.bead, browM, 0.3 * sx, 0.2, [R * 0.13, R * 0.035, R * 0.04], 0.02);
    b.rotateZ(-0.15 * sx);
  }
  const ears = style !== "long";
  if (ears) for (const sx of [1, -1]) add(hg, GEO.bead, skinM, V(sx * R * 0.97, -R * 0.08, 0), [R * 0.12, R * 0.22, R * 0.17]);

  const hairM = mat(hair, { side: THREE.DoubleSide });
  const capHair = (k = 1.07, tilt = -0.42) => add(hg, GEO.hairCap, hairM, V(0, 0, -R * 0.02), [R * k, R * k * 0.97, R * k * 1.02], [tilt, 0, 0]);
  const fringe = () => {
    const f = add(hg, GEO.ball, hairM, V(R * 0.18, R * 0.72, R * 0.6), [R * 0.48, R * 0.2, R * 0.3], [0.65, 0, -0.35]);
    add(hg, GEO.ball, hairM, V(-R * 0.3, R * 0.75, R * 0.55), [R * 0.32, R * 0.17, R * 0.26], [0.6, 0, 0.4]);
    return f;
  };
  if (style === "short") {
    capHair();
    fringe();
  } else if (style === "long") {
    capHair(1.07, -0.3);
    fringe();
    add(hg, GEO.ball, hairM, V(0, -R * 0.45, -R * 0.42), [R * 1.0, R * 1.15, R * 0.62]);
    for (const sx of [1, -1]) add(hg, GEO.ball, hairM, V(sx * R * 0.86, -R * 0.38, -R * 0.08), [R * 0.3, R * 0.95, R * 0.55], [0, 0, sx * 0.08]);
  } else if (style === "bun") {
    capHair(1.06, -0.2);
    add(hg, GEO.ball, hairM, V(0, R * 0.92, -R * 0.42), R * 0.4);
    fringe();
  } else if (style === "curly") {
    capHair(1.04, -0.35);
    const dirs = [];
    for (let i = 0; i < 12; i++) {
      const y = 1 - (i + 0.5) / 12 * 1.25; // cover the top and back, stop above the eyes
      const rad = Math.sqrt(Math.max(0, 1 - y * y));
      const a = i * 2.39996 + 0.4;
      dirs.push(V(Math.cos(a) * rad, y, Math.sin(a) * rad));
    }
    for (const d of dirs) {
      d.applyAxisAngle(V(1, 0, 0), -0.45); // tilt back, off the face
      if (d.z > 0.55 && d.y < 0.5) continue;
      add(hg, GEO.joint, hairM, d.clone().multiplyScalar(R * 0.98), R * (0.3 + r() * 0.06));
    }
  } else if (style === "cap") {
    capHair(1.06, -0.55);
    const cm = mat(capColor);
    add(hg, GEO.hairCap, mat(capColor, { side: THREE.DoubleSide }), V(0, R * 0.08, 0), [R * 1.1, R * 1.0, R * 1.1], [-0.12, 0, 0]);
    add(hg, GEO.disc, cm, V(0, R * 0.32, R * 0.92), [R * 0.62, R * 0.07, R * 0.58], [0.12, 0, 0]);
    add(hg, GEO.bead, cm, V(0, R * 1.12, -R * 0.05), R * 0.1);
  } else {
    // bald: flattened clay tufts hugging the head behind the ears and at the nape
    for (const [x, y, z, w, h] of [[0.8, 0.02, -0.55, 0.36, 0.3], [-0.8, 0.02, -0.55, 0.36, 0.3], [0, -0.12, -1, 0.62, 0.32]]) {
      const n = V(x, y, z).normalize();
      const t = add(hg, GEO.ball, hairM, n.clone().multiplyScalar(R * 0.93), [R * w, R * h, R * 0.16]);
      t.quaternion.setFromUnitVectors(Z, n);
    }
  }
  return hg;
}

// ---------- person ----------
function person(p, ctx) {
  const r = ctx.rand;
  const kid = !!p.kid;
  const skin = p.skin ?? pick(r, SKIN);
  const shirt = p.shirt ?? p.color ?? pick(r, SHIRT);
  const pants = p.pants ?? pick(r, PANTS);
  const hair = p.hair ?? (p.hairStyle === "bald" && r() < 0.6 ? "#9a948c" : pick(r, HAIR));
  const style = STYLES.includes(p.hairStyle) ? p.hairStyle : pick(r, ["short", "short", "long", "long", "bun", "curly", "cap", "bald"]);
  const pose = POSES.includes(p.pose) ? p.pose : "stand";
  const holding = ["glass", "phone", "umbrella"].includes(p.holding) && pose !== "play-guitar" ? p.holding : "none";
  const longSleeve = r() < 0.5;
  const shoeC = pick(r, SHOES);
  const capColor = pick(r, ACCENT);
  const umbColor = pick(r, ACCENT);
  const rollHead = (r() - 0.5) * 0.14;

  const skinM = mat(skin), shirtM = mat(shirt), pantsM = mat(pants), shoeM = mat(shoeC);

  const root = group();
  const body = group();
  root.add(body);
  const seated = pose === "sit";

  // --- legs (explicit joints, x = +/- side) ---
  let hipY = 0.6, legs;
  if (seated) {
    hipY = 0.55;
    legs = (s) => ({ hip: V(0.1 * s, 0.55, -0.04), knee: V(0.105 * s, 0.55, 0.26), ankle: V(0.11 * s, 0.1, 0.29), pitch: 0 });
  } else if (pose === "walk") {
    legs = (s) =>
      s > 0
        ? { hip: V(0.095, 0.6, 0.02), knee: V(0.1, 0.35, 0.115), ankle: V(0.1, 0.09, 0.135), pitch: -0.08 }
        : { hip: V(-0.095, 0.6, -0.01), knee: V(-0.1, 0.35, -0.06), ankle: V(-0.1, 0.13, -0.21), pitch: 0.55 };
  } else {
    const w = pose === "play-guitar" || pose === "cheer" ? 0.125 : 0.1;
    legs = (s) => ({ hip: V(0.095 * s, 0.6, 0), knee: V((w * 0.9 + 0.01) * s, 0.345, 0.015), ankle: V(w * s, 0.09, 0), pitch: 0, yaw: 0.12 * s });
  }
  for (const s of [1, -1]) {
    const L = legs(s);
    limb(body, L.hip, L.knee, 0.078, pantsM);
    limb(body, L.knee, L.ankle, 0.074, pantsM);
    const shoe = new THREE.Mesh(GEO.ball, shoeM);
    shoe.scale.set(0.072, 0.052, 0.11);
    shoe.rotation.set(L.pitch, L.yaw ?? 0, 0);
    shoe.position.copy(L.ankle).add(V(0, -0.03, 0.035).applyEuler(shoe.rotation));
    body.add(shoe);
  }

  // --- pelvis + torso ---
  const T = seated ? V(0, 0.52, -0.08) : V(0, hipY, pose === "walk" ? 0.005 : 0);
  const lean = seated ? 0.07 : pose === "walk" ? 0.06 : pose === "cheer" ? -0.05 : 0;
  const tEuler = new THREE.Euler(lean, 0, 0);
  const tp = (x, y, z) => V(x, y, z).applyEuler(tEuler).add(T);
  add(body, GEO.ball, pantsM, seated ? V(0, 0.56, -0.06) : V(0, hipY + 0.03, 0), [0.165, 0.095, 0.125]);
  add(body, GEO.torso, shirtM, T, [1, 1, 0.84], [lean, 0, 0]);
  add(body, GEO.hem, shirtM, tp(0, 0.03, 0), [0.158, 0.158 * 0.84, 0.158], [Math.PI / 2 + lean, 0, 0]);
  // a soft collar roll where the neck meets the shirt
  add(body, GEO.bead, shirtM, tp(0, 0.395, 0), [0.1, 0.045, 0.09]);
  add(body, GEO.bead, skinM, tp(0, 0.43, 0.0), [0.058, 0.08, 0.058]);

  // --- head ---
  const R = kid ? 0.2 * 1.15 : 0.2;
  const headUp = { phone: 0.22, glass: 0.0 }[holding] ?? 0;
  const pitch = (pose === "cheer" ? -0.18 : 0) + headUp + (seated ? -0.04 : 0);
  const hg = buildHead(R, skin, hair, style, capColor, r);
  hg.position.copy(tp(0, 0.415 + R * 0.95, 0.01));
  hg.rotation.set(pitch, 0, rollHead + (pose === "wave" ? 0.1 : 0) + (pose === "play-guitar" ? -0.12 : 0));
  body.add(hg);

  // --- arms ---
  const shoulder = (s) => tp(0.165 * s, 0.325, 0);
  let armKey = { L: "down", R: "down" }; // L = +x (character's left)
  if (seated) armKey = { L: "table", R: "table" };
  if (pose === "wave") armKey.R = "wave";
  if (pose === "cheer") armKey = { L: "cheer", R: "cheer" };
  if (pose === "walk") armKey = { L: "swingB", R: "swingF" };
  const holdSide = pose === "wave" ? "L" : "R";
  if (holding !== "none" && pose !== "cheer") armKey[holdSide] = holding === "glass" && seated ? "glassSit" : holding;

  const targets = {};
  for (const [k, s] of [["L", 1], ["R", -1]]) targets[k] = armTarget(shoulder(s), s, armKey[k]);

  let guitar;
  if (pose === "play-guitar") {
    guitar = guitarProp();
    guitar.position.set(-0.03, 0.8, 0.21);
    guitar.rotation.set(-0.05, -0.12, 0.5);
    guitar.updateMatrixWorld(true);
    body.add(guitar);
    targets.R = { W: guitar.localToWorld(V(0.03, 0.04, 0.085)), pole: V(-1, -0.6, -0.3) };
    targets.L = { W: guitar.localToWorld(V(0.48, -0.035, 0.0)), pole: V(0.6, -1, -0.2) };
  }

  const hands = {};
  for (const [k, s] of [["L", 1], ["R", -1]]) {
    const S = shoulder(s);
    const { elbow, wrist } = ik(S, targets[k].W, 0.21, 0.2, targets[k].pole);
    if (longSleeve || kid) {
      limb(body, S, elbow, 0.056, shirtM);
      limb(body, elbow, wrist, 0.053, shirtM);
    } else {
      limb(body, S, S.clone().lerp(elbow, 0.5), 0.062, shirtM);
      limb(body, S, elbow, 0.048, skinM);
      limb(body, elbow, wrist, 0.048, skinM);
    }
    const dir = wrist.clone().sub(elbow).normalize();
    const hand = wrist.clone().addScaledVector(dir, 0.03);
    const h = add(body, GEO.ball, skinM, hand, [0.058, 0.062, 0.052]);
    h.quaternion.setFromUnitVectors(UP, dir);
    hands[k] = hand;
  }

  if (holding !== "none") {
    const hand = hands[holdSide];
    const prop = holding === "glass" ? glassProp() : holding === "phone" ? phoneProp() : umbrellaProp(umbColor);
    prop.position.copy(hand);
    if (holding === "umbrella") prop.rotation.set(-0.12, 0, 0.06 * (holdSide === "R" ? -1 : 1));
    if (holding === "phone") prop.position.add(V(0, 0.01, 0.03));
    if (holding === "glass") prop.position.add(V(0, 0.01, 0.02));
    body.add(prop);
  }

  if (kid) {
    body.scale.setScalar(0.72);
    if (seated) body.position.y = 0.55 * (1 - 0.72);
  }
  return { group: root };
}

// ---------- dog ----------
const DOG = ["#c98b4f", "#e9d5b3", "#3b302a", "#a3653a", "#f1ebe0", "#7d5a3c", "#d9a35f"];

function dog(p, ctx) {
  const r = ctx.rand;
  const c = p.color ?? pick(r, DOG);
  const light = shade(c, 0.14);
  const dark = shade(c, -0.14);
  const M = mat(c), lightM = mat(light), darkM = mat(dark);
  const root = group();
  const g = group();
  root.add(g);

  add(g, GEO.ball, M, V(0, 0.3, -0.02), [0.15, 0.14, 0.25]);
  add(g, GEO.ball, lightM, V(0, 0.29, 0.12), [0.11, 0.11, 0.12]);
  // legs
  for (const [x, z] of [[0.08, 0.13], [-0.08, 0.13], [0.085, -0.15], [-0.085, -0.15]]) {
    limb(g, V(x, 0.27, z), V(x, 0.045, z + 0.01), 0.05, M);
    add(g, GEO.joint, lightM, V(x, 0.035, z + 0.03), [0.056, 0.038, 0.07]);
  }
  // tail, wagging up
  const tailA = V(0, 0.36, -0.24), tailB = V(0.03, 0.52, -0.33);
  limb(g, tailA, tailB, 0.028, M);
  add(g, GEO.joint, lightM, tailB, 0.034);
  // collar
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.02, 4, 12), mat("#c9393b"));
  collar.position.set(0, 0.42, 0.2);
  collar.rotation.set(Math.PI / 2 - 0.6, 0, 0);
  g.add(collar);
  add(g, GEO.bead, mat("#f2c14e", { rough: 0.35 }), V(0, 0.36, 0.28), 0.022);
  // head
  const hg = group();
  hg.position.set(0, 0.5, 0.25);
  hg.rotation.set(0.05, 0, (r() - 0.5) * 0.3);
  g.add(hg);
  add(hg, GEO.ball, M, V(), [0.15, 0.135, 0.14]);
  add(hg, GEO.ball, lightM, V(0, -0.045, 0.11), [0.085, 0.065, 0.09]);
  add(hg, GEO.bead, mat("#1c1412", { rough: 0.25, clay: false }), V(0, -0.02, 0.2), [0.03, 0.024, 0.024]);
  const eyeM = mat("#1c1412", { rough: 0.25, clay: false });
  for (const sx of [1, -1]) {
    add(hg, GEO.bead, eyeM, V(sx * 0.06, 0.035, 0.125), [0.019, 0.023, 0.012], [0, sx * 0.4, 0]);
    const ear = add(hg, GEO.ball, darkM, V(sx * 0.13, 0.0, -0.01), [0.045, 0.1, 0.07], [0.15, 0, sx * 0.35]);
    ear.position.y -= 0.01;
  }
  if (p.holding === "ball") {
    add(hg, GEO.ball, mat("#d6e04a"), V(0, -0.09, 0.17), 0.058);
  } else {
    add(hg, GEO.bead, mat("#e5737f"), V(0, -0.1, 0.14), [0.03, 0.012, 0.04], [0.3, 0, 0]);
  }
  if (p.size === "small") g.scale.setScalar(0.7);
  return { group: root };
}

export const parts = { person, dog };
