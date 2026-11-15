import { readdirSync, statSync, existsSync } from "node:fs";
import { dedup, prune, weld, simplify, textureCompress, draco, meshopt, quantize, resample, flatten, join } from "@gltf-transform/functions";
import { MeshoptSimplifier, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";
import { createIO, stats } from "./inspect.mjs";
import { parseArgs, list, OUT, writeJson, readJson, ensureDir } from "./lib.mjs";

export const PRESETS = {
  "web": { tris: 0, tex: 2048, format: "webp", compress: "meshopt" },
  "phone-200k": { tris: 200000, tex: 2048, format: "webp", compress: "meshopt" },
  "phone-100k": { tris: 100000, tex: 1024, format: "webp", compress: "meshopt" },
  "phone-50k": { tris: 50000, tex: 1024, format: "webp", compress: "meshopt" },
  "phone-20k": { tris: 20000, tex: 1024, format: "webp", compress: "meshopt" },
  "phone-100k-draco": { tris: 100000, tex: 1024, format: "webp", compress: "draco" },
  "phone-100k-plain": { tris: 100000, tex: 1024, format: "jpeg", compress: "quantize" },
  "phone-50k-plain": { tris: 50000, tex: 1024, format: "jpeg", compress: "quantize" },
};

export async function optimizeDoc(doc, preset) {
  const before = stats(doc, 0).triangles;
  const steps = [dedup(), flatten(), join(), weld()];
  if (preset.tris && before > preset.tris) {
    await MeshoptSimplifier.ready;
    steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: preset.tris / before, error: 0.02 }));
  }
  steps.push(resample(), prune());
  steps.push(textureCompress({ encoder: sharp, targetFormat: preset.format, resize: [preset.tex, preset.tex], quality: 85 }));
  if (preset.compress === "meshopt") steps.push(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  if (preset.compress === "draco") steps.push(draco({ method: "edgebreaker" }));
  if (preset.compress === "quantize") steps.push(quantize());
  await doc.transform(...steps);
  return doc;
}

if (import.meta.url === "file://" + process.argv[1]) {
  const args = parseArgs();
  const tag = args.tag ?? "matrix";
  const outTag = args.out ?? tag + "-mobile";
  const candidates = list(args.candidates);
  const days = list(args.days);
  const presets = list(args.presets).length ? list(args.presets) : Object.keys(PRESETS);
  const io = await createIO();
  const report = readJson(OUT + outTag + "/optimize.json", {});
  for (const cand of candidates) {
    const dir = OUT + tag + "/" + cand + "/";
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".glb"))) {
      const day = f.replace(/\.glb$/, "");
      if (days.length && !days.includes(day)) continue;
      for (const name of presets) {
        const target = OUT + outTag + "/" + cand + "@" + name + "/" + day + ".glb";
        if (!args.force && existsSync(target)) continue;
        const t0 = performance.now();
        const doc = await io.read(dir + f);
        await optimizeDoc(doc, PRESETS[name]);
        ensureDir(OUT + outTag + "/" + cand + "@" + name);
        await io.write(target, doc);
        const s = stats(await io.read(target), statSync(target).size);
        report[cand + "@" + name + "/" + day] = { preset: name, source_bytes: statSync(dir + f).size, bytes: s.file_bytes, triangles: s.triangles, texture_max_px: s.texture_max_px, textures: s.textures, extensions: s.extensions, seconds: Number(((performance.now() - t0) / 1000).toFixed(2)) };
        console.log(cand, day, name, (s.file_bytes / 1e6).toFixed(2) + "MB", s.triangles + " tris", "tex " + s.texture_max_px);
      }
    }
  }
  writeJson(OUT + outTag + "/optimize.json", report);
}
