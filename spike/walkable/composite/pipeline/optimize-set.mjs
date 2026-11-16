#!/usr/bin/env node
// Optimize every GLB of one asset set into a new set: node pipeline/optimize-set.mjs --day hackathon --from raw-set --to opt-set [--textures ktx2|webp]
import path from "node:path";
import { optimizeGlb, hasKtx } from "./optimize.mjs";
import { assetsDir, readWorld, writeWorld } from "./worldfile.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []));
export const budgetFor = (sizeM) => (sizeM >= 4 ? { targetTris: 24000, texSize: 1024 } : sizeM >= 1.5 ? { targetTris: 14000, texSize: 1024 } : sizeM >= 0.8 ? { targetTris: 8000, texSize: 512 } : { targetTris: 4000, texSize: 512 });

export async function optimizeSet(day, from, to, textures = hasKtx ? "ktx2" : "webp") {
  const world = readWorld(day);
  const src = world.sets[from];
  if (!src) throw new Error("no set " + from + " in " + day);
  const t0 = Date.now();
  const objects = {};
  const report = {};
  await Promise.all(Object.entries(src.objects).map(async ([id, a]) => {
    const spec = world.spec.objects.find((o) => o.id === id);
    const file = day + "/" + to + "/" + id + ".glb";
    const r = await optimizeGlb(path.join(assetsDir, a.file), path.join(assetsDir, file), { ...budgetFor(spec?.size_m ?? 1), textures });
    objects[id] = { ...a, file, bytes: r.out_bytes, raw_file: a.file, raw_bytes: r.in_bytes, tris: r.tris_out, tris_raw: r.tris_in, textures: r.textures_out };
    report[id] = r;
  }));
  world.sets[to] = { ...src, label: (src.label || from) + " · optimized (" + textures + ", meshopt)", objects, optimized_from: from, optimize_ms: Date.now() - t0 };
  writeWorld(world);
  return { day, to, ms: Date.now() - t0, report };
}

if (process.argv[1]?.endsWith("optimize-set.mjs")) {
  const r = await optimizeSet(args.day, args.from, args.to, args.textures);
  const rows = Object.entries(r.report).map(([id, x]) => id.padEnd(12) + (x.in_bytes / 1024).toFixed(0).padStart(8) + " KB -> " + (x.out_bytes / 1024).toFixed(0).padStart(6) + " KB  tris " + x.tris_in + " -> " + x.tris_out + "  " + x.textures_out.join(", "));
  console.log(rows.join("\n") + "\n" + r.day + "/" + r.to + " in " + r.ms + " ms");
}
