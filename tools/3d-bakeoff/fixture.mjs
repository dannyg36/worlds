import { getBounds } from "@gltf-transform/functions";
import { createIO, stats } from "./inspect.mjs";
import { parseArgs, list, OUT, readJson, writeJson, ensureDir } from "./lib.mjs";

const args = parseArgs();
const tag = args.tag ?? "matrix";
const candidate = args.candidate;
const yaw = Number(args.yaw ?? 0);
const days = list(args.days).length ? list(args.days) : Object.keys(readJson(new URL("./days.json", import.meta.url).pathname));
const io = await createIO();
const manifest = readJson(OUT + "fixtures/manifest.json", {});

for (const day of days) {
  const doc = await io.read(OUT + tag + "/" + candidate + "/" + day + ".glb");
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const world = doc.createNode("world");
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    world.addChild(child);
  }
  scene.addChild(world);
  world.setRotation([0, Math.sin((yaw * Math.PI) / 360), 0, Math.cos((yaw * Math.PI) / 360)]);
  let { min, max } = getBounds(scene);
  const scale = 1 / Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  world.setScale([scale, scale, scale]);
  ({ min, max } = getBounds(scene));
  world.setTranslation([-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2]);
  const file = OUT + "fixtures/" + candidate + "/" + day + ".glb";
  ensureDir(OUT + "fixtures/" + candidate);
  await io.write(file, doc);
  const s = stats(await io.read(file), 0);
  ({ min, max } = getBounds(scene));
  const record = readJson(OUT + tag + "/" + candidate + "/" + day + ".json", {});
  manifest[candidate + "/" + day] = { day, candidate, model: record.model, provider: record.provider, triangles: s.triangles, textures: s.textures, texture_max_px: s.texture_max_px, pbr_maps: s.pbr_maps, size: max.map((v, i) => Number((v - min[i]).toFixed(3))), yaw_applied_deg: yaw, generation_s: record.attempts?.at(-1)?.timeline?.result_s ?? null };
  console.log(candidate, day, s.triangles + " tris", "size " + manifest[candidate + "/" + day].size.join(" x "));
}
writeJson(OUT + "fixtures/manifest.json", manifest);
