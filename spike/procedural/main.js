// Spike harness: renders a scene or island spec with world.js.
// URL params: scene=<path under scenes/, no .json> | gallery=<module or "all">, yaw, elev, dist, tx, ty, tz,
//             size, time, pano=<name in pano/>, post=0, merge=0, fit=0, quality=low, lights, still=1, rotate=1, focus=<vignette index>
import { createWorld, MODULE_PARTS, registry } from "./world.js";

const q = new URLSearchParams(location.search);
const num = (k) => (q.has(k) ? Number(q.get(k)) : undefined);
const size = num("size");

let spec;
if (q.has("gallery")) {
  const names = q.get("gallery") === "all" ? Object.keys(registry).filter((t) => t !== "custom") : MODULE_PARTS[q.get("gallery")] ?? [];
  const cols = Math.ceil(Math.sqrt(names.length));
  const step = 9 / Math.max(cols, 1);
  spec = {
    title: "gallery", time: q.get("time") ?? "golden-hour", base: { shape: "square", surface: "wood" },
    objects: names.map((t, i) => ({
      type: t,
      at: [-4.5 + step * (0.5 + (i % cols)), -4.5 + step * (0.5 + Math.floor(i / cols))],
      ...(t === "string-lights" ? { points: [[-0.6, 1.4, 0], [0.6, 1.4, 0]] } : {}),
    })),
  };
} else {
  const name = q.get("scene") ?? "birthday-dinner.image";
  spec = await (await fetch(`scenes/${name}.json?v=${Date.now()}`)).json();
}

const world = await createWorld(document.body, spec, {
  width: size ?? innerWidth,
  height: size ?? innerHeight,
  pixelRatio: size ? 1 : undefined,
  post: q.get("post") !== "0",
  merge: q.get("merge") !== "0",
  fit: q.get("fit") !== "0",
  quality: q.get("quality") ?? "high",
  maxLights: num("lights"),
  time: q.has("gallery") ? undefined : q.get("time") ?? undefined,
  yaw: num("yaw"), elev: num("elev"), dist: num("dist"), tx: num("tx"), ty: num("ty"), tz: num("tz"),
  panoUrl: q.has("pano") ? `pano/${q.get("pano")}.jpg` : undefined,
  still: q.get("still") === "1",
  autoRotate: q.get("rotate") === "1",
  onReady(stats) {
    window.stats = stats;
    window.ready = true;
    console.log("stats", JSON.stringify(stats));
  },
});
window.world = world;
if (q.has("focus")) world.focusVignette(Number(q.get("focus")));
if (!size) addEventListener("resize", () => world.setSize(innerWidth, innerHeight));
