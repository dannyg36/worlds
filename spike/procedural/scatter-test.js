// Throwaway harness for scatter.js: a stand-in island (9 m disc, 5 plots, ring path) rendered per biome.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { mat, rng, cyl, box, put } from "./core.js";
import { scatter } from "./scatter.js";
import { buildIsland } from "./island.js";

const q = new URLSearchParams(location.search);
const biome = q.get("biome") ?? "meadow", time = q.get("time") ?? "golden-hour";
const SIZE = Number(q.get("size") ?? 1000);
const spec = await (await fetch("scenes/islands/_layout-test.json")).json();
spec.biome = biome; spec.time = time;
const island = buildIsland(spec, { rand: rng(77), time });
const R = island.radius;
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

const stage = island.group;
stage.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; } });
scene.add(stage);
// plot placeholders: a backdrop and a figure so the breathing margin and front rule are visible
for (const p of island.plots) {
  const g = new THREE.Group();
  put(g, box(p.radius * 1.4, 1.4, 0.2, mat("#d8c6a8")), 0, 0.7, -p.radius + 0.3);
  put(g, box(0.4, 1.4, 0.4, mat("#3b6ea5")), 0.4, 0.7, 0.3);
  g.position.set(p.x, 0, p.z); g.rotation.y = p.rot; scene.add(g);
}
put(scene, cyl(0.3, 0.4, 4, mat("#c06a9a")), 0, 2, 0);
const t0 = performance.now();
const filler = scatter(island, spec, { rand: rng(99), time });
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
