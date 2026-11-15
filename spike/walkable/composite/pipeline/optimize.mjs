#!/usr/bin/env node
// Optimize one generated GLB for the phone: dedup, weld, simplify to a triangle budget, downsize textures,
// encode them as KTX2 (ETC1S, needs KTX-Software) or WebP, and compress geometry with meshopt.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, weld, simplify, textureCompress, meshopt, flatten, join } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const ktxHome = process.env.KTX_HOME || path.join(os.homedir(), ".capy/work/ktx/KTX-Software-4.4.2-Linux-x86_64");
export const hasKtx = fs.existsSync(path.join(ktxHome, "bin/ktx"));
if (hasKtx) {
  process.env.PATH = path.join(ktxHome, "bin") + path.delimiter + process.env.PATH;
  process.env.LD_LIBRARY_PATH = path.join(ktxHome, "lib") + (process.env.LD_LIBRARY_PATH ? path.delimiter + process.env.LD_LIBRARY_PATH : "");
}

let io = null;
async function getIO() {
  if (io) return io;
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
  io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
  return io;
}

export function inspect(doc) {
  let tris = 0, verts = 0, prims = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      prims++;
      const pos = p.getAttribute("POSITION");
      verts += pos ? pos.getCount() : 0;
      const idx = p.getIndices();
      tris += Math.floor((idx ? idx.getCount() : pos ? pos.getCount() : 0) / 3);
    }
  }
  const textures = doc.getRoot().listTextures().map((t) => ({ mime: t.getMimeType(), size: t.getSize(), bytes: t.getImage()?.byteLength ?? 0 }));
  return { tris, verts, prims, materials: doc.getRoot().listMaterials().length, textures };
}

export async function optimizeGlb(input, output, { targetTris = 15000, texSize = 1024, textures = hasKtx ? "ktx2" : "webp", quality = 128 } = {}) {
  const t0 = Date.now();
  const io = await getIO();
  const doc = await io.read(input);
  const before = inspect(doc);
  const ratio = Math.min(1, targetTris / Math.max(1, before.tris));
  await doc.transform(dedup(), prune(), flatten(), join(), weld());
  if (ratio < 1) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.004, lockBorder: false }));
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: textures === "webp" ? "webp" : "png", resize: [texSize, texSize], quality: 86 }));
  if (textures === "ktx2") {
    const { toktx, Mode } = await import("@gltf-transform/cli");
    await doc.transform(toktx({ mode: Mode.ETC1S, quality, compression: 2 }));
  }
  await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  await io.write(output, doc);
  const after = inspect(doc);
  return {
    in_bytes: fs.statSync(input).size, out_bytes: fs.statSync(output).size,
    tris_in: before.tris, tris_out: after.tris, verts_in: before.verts, verts_out: after.verts,
    textures_in: before.textures.map((t) => t.size?.join("x") + " " + t.mime), textures_out: after.textures.map((t) => t.size?.join("x") + " " + t.mime),
    texture_mode: textures, ms: Date.now() - t0,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output, ...rest] = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) opts[rest[i].replace(/^--/, "")] = isNaN(Number(rest[i + 1])) ? rest[i + 1] : Number(rest[i + 1]);
  const r = await optimizeGlb(input, output, { targetTris: opts.tris, texSize: opts.tex, textures: opts.textures, quality: opts.quality });
  console.log(JSON.stringify(r, null, 2));
}
