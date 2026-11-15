// Throwaway harness for island.js (delete when done).
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { rng } from "./core.js";
const { buildIsland } = await import("./island.js?v=" + Date.now());

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? Number(q.get(k)) : d);
const S = num("size", 900);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(S, S);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#e9c3a0");
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
scene.add(new THREE.HemisphereLight("#ffd9a8", "#5a3d34", 0.55));
const sun = new THREE.DirectionalLight("#ffad5c", 3.2);
const el = THREE.MathUtils.degToRad(num("sunel", 16)), az = THREE.MathUtils.degToRad(-55);
sun.position.set(Math.sin(az) * Math.cos(el) * 40, Math.sin(el) * 40, Math.cos(az) * Math.cos(el) * 40);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 100 });
scene.add(sun);

const spec = await (await fetch(`scenes/${q.get("scene") ?? "islands/_layout-test"}.json?v=${Date.now()}`)).json();
if (q.has("biome")) spec.biome = q.get("biome");
if (q.get("nolandmark")) delete spec.landmark;
if (q.has("n")) spec.vignettes = spec.vignettes.slice(0, Number(q.get("n")));
const isl = buildIsland(spec, { rand: rng(77), time: spec.time });
scene.add(isl.group);
let tris = 0;
isl.group.traverse((o) => { if (o.isMesh) { o.castShadow = !o.material.transparent; o.receiveShadow = true; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });

if (q.get("debug") !== "0") {
  const colors = ["#e74c3c", "#3498db", "#f1c40f", "#9b59b6", "#1abc9c"];
  isl.plots.forEach((p, i) => {
    const d = new THREE.Mesh(new THREE.CircleGeometry(p.radius, 48), new THREE.MeshBasicMaterial({ color: colors[i % 5], transparent: true, opacity: 0.35, depthWrite: false }));
    d.rotation.x = -Math.PI / 2; d.position.set(p.x, 0.06, p.z); scene.add(d);
    const dir = new THREE.Vector3(Math.sin(p.rot), 0, Math.cos(p.rot));
    scene.add(new THREE.ArrowHelper(dir, new THREE.Vector3(p.x, 0.3, p.z), p.radius * 0.9, colors[i % 5], 0.5, 0.35));
    const lbl = new THREE.Mesh(new THREE.SphereGeometry(0.15 + i * 0.06, 12, 8), new THREE.MeshBasicMaterial({ color: "#000" }));
    lbl.position.set(p.x, 0.4, p.z); scene.add(lbl);
  });
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(isl.path.map(([x, z]) => new THREE.Vector3(x, 0.12, z))), new THREE.LineBasicMaterial({ color: "#ff00ff" })));
  if (isl.landmark) {
    const d = new THREE.Mesh(new THREE.CircleGeometry(isl.landmark.radius, 32), new THREE.MeshBasicMaterial({ color: "#000", transparent: true, opacity: 0.3 }));
    d.rotation.x = -Math.PI / 2; d.position.y = 0.06; scene.add(d);
  }
  const free = [];
  for (let x = -isl.radius; x <= isl.radius; x += 0.3) for (let z = -isl.radius; z <= isl.radius; z += 0.3) if (isl.isFree(x, z)) free.push(new THREE.Vector3(x, 0.08, z));
  scene.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(free), new THREE.PointsMaterial({ color: "#0b3d0b", size: 3, sizeAttenuation: false })));
}

// Diagnostics: plot gaps and path clearance.
const diag = { radius: isl.radius, tris, plots: isl.plots.map((p) => ({ x: +p.x.toFixed(2), z: +p.z.toFixed(2), rotDeg: +(p.rot * 180 / Math.PI).toFixed(1), r: p.radius, d: +Math.hypot(p.x, p.z).toFixed(2) })) };
diag.gaps = isl.plots.map((p, i) => { const o = isl.plots[(i + 1) % isl.plots.length]; return +(Math.hypot(p.x - o.x, p.z - o.z) - p.radius - o.radius).toFixed(2); });
diag.pathIntoPlot = isl.plots.map((p) => +Math.max(...isl.path.map(([x, z]) => p.radius - (Math.hypot(x - p.x, z - p.z) - 0.45))).toFixed(2));
diag.pathPts = isl.path.length;
diag.heightEdge = [0, 0.2, 0.6, 1.2, 2].map((d) => +isl.heightAt(0, isl.radius + d).toFixed(3));
const mk = (sizes, lm) => ({ biome: "meadow", landmark: lm ? { type: "tree" } : undefined, vignettes: sizes.map((s, i) => ({ size: s, hero: s === "large" && !sizes.slice(0, i).includes("large") })) });
diag.radii = {};
for (const [name, sizes] of Object.entries({ "4:m,L,m,s": ["medium", "large", "medium", "small"], "5:s,m,L,s,m": ["small", "medium", "large", "small", "medium"], "5:m,m,L,m,m": ["medium", "medium", "large", "medium", "medium"], "4:s,s,L,s": ["small", "small", "large", "small"] }))
  for (const lm of [true, false]) diag.radii[name + (lm ? "+lm" : "")] = buildIsland(mk(sizes, lm), { rand: rng(77) }).radius;

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 300);
const yaw = THREE.MathUtils.degToRad(num("yaw", 0)), elev = THREE.MathUtils.degToRad(num("elev", 35)), dist = num("dist", (isl.radius + 3) * 2.75);
camera.position.set(Math.sin(yaw) * Math.cos(elev) * dist, Math.sin(elev) * dist, Math.cos(yaw) * Math.cos(elev) * dist);
camera.lookAt(0, num("ty", 0), 0);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(S, S), 0.55, 0.5, 1.25));
composer.addPass(new OutputPass());
let frames = 0;
(function loop() {
  composer.render();
  if (++frames === 3) { window.stats = diag; window.ready = true; } else requestAnimationFrame(loop);
})();
