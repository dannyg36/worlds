import { readdirSync, statSync, existsSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds, getGLPrimitiveCount, listTextureSlots } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { parseArgs, writeJson, OUT } from "./lib.mjs";

export async function createIO() {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    "draco3d.decoder": await draco3d.createDecoderModule(),
    "draco3d.encoder": await draco3d.createEncoderModule(),
    "meshopt.decoder": MeshoptDecoder,
    "meshopt.encoder": MeshoptEncoder,
  });
}

export function stats(doc, fileBytes) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  let triangles = 0, points = 0, lines = 0, vertices = 0, primitives = 0, vertexColors = false;
  const modes = new Set();
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    for (const prim of mesh.listPrimitives()) {
      primitives++;
      const mode = prim.getMode();
      modes.add(mode);
      vertices += prim.getAttribute("POSITION")?.getCount() ?? 0;
      if (prim.getAttribute("COLOR_0")) vertexColors = true;
      const count = getGLPrimitiveCount(prim);
      if (mode === 4 || mode === 5 || mode === 6) triangles += count;
      else if (mode === 0) points += count;
      else lines += count;
    }
  });
  const textures = root.listTextures().map((texture) => {
    const size = texture.getSize();
    return { mime: texture.getMimeType(), width: size?.[0] ?? null, height: size?.[1] ?? null, bytes: texture.getImage()?.byteLength ?? 0, slots: listTextureSlots(texture) };
  });
  const materials = root.listMaterials().map((material) => ({
    unlit: material.getExtension("KHR_materials_unlit") != null,
    metallic: material.getMetallicFactor(),
    roughness: material.getRoughnessFactor(),
    doubleSided: material.getDoubleSided(),
    alpha: material.getAlphaMode(),
    maps: ["BaseColor", "MetallicRoughness", "Normal", "Occlusion", "Emissive"].filter((slot) => material["get" + slot + "Texture"]()),
  }));
  const { min, max } = getBounds(scene);
  const dims = max.map((v, i) => Number((v - min[i]).toFixed(4)));
  const maxTex = textures.reduce((m, t) => Math.max(m, t.width ?? 0, t.height ?? 0), 0);
  return {
    file_bytes: fileBytes,
    triangles, points, lines, vertices, primitives,
    meshes: root.listMeshes().length,
    modes: [...modes],
    vertex_colors: vertexColors,
    materials: materials.length,
    material_detail: materials,
    textures: textures.length,
    texture_max_px: maxTex,
    texture_bytes: textures.reduce((s, t) => s + t.bytes, 0),
    texture_detail: textures,
    pbr_maps: [...new Set(materials.flatMap((m) => m.maps))],
    bounds_dims: dims,
    extensions: root.listExtensionsUsed().map((e) => e.extensionName),
    generator: root.getAsset().generator ?? null,
  };
}

export async function inspectFile(io, path) {
  const doc = await io.read(path);
  return stats(doc, statSync(path).size);
}

if (import.meta.url === "file://" + process.argv[1]) {
  const args = parseArgs();
  const io = await createIO();
  const tag = args.tag ?? "matrix";
  const base = OUT + tag + "/";
  const files = [];
  for (const cand of readdirSync(base)) {
    const dir = base + cand + "/";
    if (!statSync(base + cand).isDirectory()) continue;
    for (const f of readdirSync(dir)) if (f.endsWith(".glb")) files.push(dir + f);
  }
  const out = {};
  for (const file of files) {
    const key = file.slice(base.length).replace(/\.glb$/, "");
    try {
      out[key] = await inspectFile(io, file);
    } catch (error) {
      out[key] = { error: String(error).slice(0, 500) };
    }
    const s = out[key];
    console.log(key, s.error ?? [s.triangles + " tris", s.points ? s.points + " pts" : "", (s.file_bytes / 1e6).toFixed(1) + "MB", s.textures + " tex @" + s.texture_max_px, s.pbr_maps.join("+")].join(" "));
  }
  writeJson(base + "stats.json", out);
}
