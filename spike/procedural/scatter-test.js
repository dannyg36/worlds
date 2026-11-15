// Throwaway harness for scatter.js: a stand-in island (9 m disc, 5 plots, ring path) rendered per biome.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { mat, rng, cyl, box, put } from "./core.js";
import { scatter } from "./scatter.js";

const q = new URLSearchParams(location.search);
const biome = q.get("biome") ?? "meadow", time = q.get("time") ?? "golden-hour";
const SIZE = Number(q.get("size") ?? 1000);
const R = 9;
const plotDefs = [[200, 2.0], [260, 2.6], [0, 3.2], [100, 2.6], [150, 2.0]];
const plots = plotDefs.map(([deg, radius]) => {
  const a = THREE.MathUtils.degToRad(deg), d = 5.4;
  return { x: Math.sin(a) * d, z: Math.cos(a) * d, rot: deg > 90 && deg < 270 ? 0 : a * 0.3, radius };
});
const path = [];
for (let t = 200; t >= -100 + 0.01; t -= 6) {
  const a = THREE.MathUtils.degToRad(t), d = 5.4 + Math.sin(t * 0.05) * 0.4;
  path.push([Math.sin(a) * d, Math.cos(a) * d]);
}
const landmark = { x: 0, z: 0, radius: 1.3 };
const segDist = (x, z) => {
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, az] = path[i], [bx, bz] = path[i + 1], dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
};
const island = {
  radius: R, plots, path, landmark,
  isFree(x, z, c) {
    if (Math.hypot(x, z) > R - c) return false;
    for (const p of plots) if (Math.hypot(x - p.x, z - p.z) < p.radius + c) return false;
    if (Math.hypot(x - landmark.x, z - landmark.z) < landmark.radius + c) return false;
    return segDist(x, z) >= 0.45 + c;
  },
  heightAt(x, z) {
    const d = Math.hypot(x, z);
    return d <= R ? 0 : d < R + 1.4 ? -(d - R) * 0.35 : -0.6;
  },
};

const TIMES = {
  "golden-hour": { sun: "#ffad5c", sunI: 3.2, elev: 22, az: -55, hemi: ["#ffd9a8", "#5a3d34"], hemiI: 0.7, bg: "#e8b08a" },
  noon: { sun: "#ffffff", sunI: 3.0, elev: 62, az: -30, hemi: ["#d6e8ff", "#6b5a4a"], hemiI: 0.8, bg: "#c9dcef" },
  night: { sun: "#9fb2ff", sunI: 0.5, elev: 40, az: 30, hemi: ["#3b4a8a", "#1a1420"], hemiI: 0.5, bg: "#1b2148" },
  dusk: { sun: "#ff9a6b", sunI: 0.9, elev: 8, az: -60, hemi: ["#6f78c9", "#3a2a2a"], hemiI: 0.6, bg: "#5b4f88" },
};
const T = TIMES[time] ?? TIMES["golden-hour"];
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(T.bg);
scene.add(new THREE.HemisphereLight(T.hemi[0], T.hemi[1], T.hemiI));
const sun = new THREE.DirectionalLight(T.sun, T.sunI);
const el = THREE.MathUtils.degToRad(T.elev), az = THREE.MathUtils.degToRad(T.az);
sun.position.set(Math.sin(az) * Math.cos(el) * 30, Math.sin(el) * 30, Math.cos(az) * Math.cos(el) * 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 80 });
sun.shadow.bias = -0.0004;
scene.add(sun);

const GROUND = { meadow: "#6a9a48", autumn: "#8a8a48", snow: "#e8eef5", beach: "#8fae58", desert: "#d9b07a", city: "#7a9a58" };
const stage = new THREE.Group();
put(stage, cyl(R, R, 0.3, mat(GROUND[biome] ?? GROUND.meadow), 96), 0, -0.15, 0);
put(stage, cyl(R + 0.05, R + 1.6, 0.6, mat(biome === "snow" ? "#dfe6ee" : "#e6cf9a"), 96), 0, -0.6, 0);
const water = new THREE.Mesh(new THREE.CircleGeometry(30, 64), mat("#4f8fb0", { clay: false, rough: 0.3 }));
water.rotation.x = -Math.PI / 2; water.position.y = -0.62; stage.add(water);
for (const p of plots) {
  const g = new THREE.Group();
  put(g, cyl(p.radius, p.radius, 0.04, mat("#b8a890"), 48), 0, 0.02, 0);
  put(g, box(p.radius * 1.4, 1.4, 0.2, mat("#d8c6a8")), 0, 0.7, -p.radius + 0.3);
  put(g, box(0.4, 1.4, 0.4, mat("#3b6ea5")), 0.4, 0.7, 0.3);
  g.position.set(p.x, 0, p.z); g.rotation.y = p.rot; stage.add(g);
}
for (let i = 0; i + 1 < path.length; i++) {
  const [ax, az] = path[i], [bx, bz] = path[i + 1];
  const m = box(0.9, 0.03, Math.hypot(bx - ax, bz - az) + 0.05, mat("#c9b48e"));
  m.position.set((ax + bx) / 2, 0.015, (az + bz) / 2); m.rotation.y = Math.atan2(bx - ax, bz - az); stage.add(m);
}
put(stage, cyl(0.3, 0.4, 4, mat("#c06a9a")), 0, 2, 0);
stage.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = true; } });
water.castShadow = false;
scene.add(stage);

const t0 = performance.now();
const filler = scatter(island, { biome, time }, { rand: rng(99), time });
const ms = Math.round(performance.now() - t0);
scene.add(filler);

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 300);
const yaw = THREE.MathUtils.degToRad(Number(q.get("yaw") ?? 0)), elev = THREE.MathUtils.degToRad(Number(q.get("elev") ?? 38));
const dist = Number(q.get("dist") ?? Math.max(18, (R + 3) * 2.75));
camera.position.set(Math.sin(yaw) * Math.cos(elev) * dist, Math.sin(elev) * dist, Math.cos(yaw) * Math.cos(elev) * dist);
camera.lookAt(0, 0, 0);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(SIZE, SIZE), time === "night" || time === "dusk" ? 0.9 : 0.25, 0.5, 1.2));
composer.addPass(new OutputPass());

// Measure the filler alone (main pass only, no shadows) then render the full frame.
renderer.info.autoReset = false;
stage.visible = false; renderer.shadowMap.autoUpdate = false;
renderer.info.reset(); renderer.render(scene, camera);
const fill = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
stage.visible = true; renderer.shadowMap.autoUpdate = true; renderer.shadowMap.needsUpdate = true;
let frames = 0;
(function loop() {
  composer.render();
  if (++frames === 3) {
    window.stats = { biome, time, scatterMs: ms, ...filler.userData.stats, measuredCalls: fill.calls, measuredTris: fill.tris,
      kinds: Object.fromEntries(filler.children.map((m) => [m.name.replace("filler:", ""), m.count])) };
    window.ready = true;
  } else requestAnimationFrame(loop);
})();
