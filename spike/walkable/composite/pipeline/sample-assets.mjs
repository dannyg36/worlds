#!/usr/bin/env node
// Dev-only stand-ins (CC0 Khronos sample models + Poly Haven panoramas) used to build the renderer before fal assets exist.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { assetsDir, readWorld, writeWorld } from "./worldfile.mjs";

const khronos = (n) => "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/" + n + "/glTF-Binary/" + n + ".glb";
const pano = (n) => "https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/" + n + ".jpg";
const plan = {
  hackathon: { pano: "lebombo", objects: { table: "GlamVelvetSofa", monitor: "BoomBox", cans: "WaterBottle", pizza: "IridescentDishWithOlives", person: "CesiumMan", whiteboard: "Lantern", beanbag: "SheenChair", window: "ChairDamaskPurplegold" } },
  "santa-cruz": { pano: "umhlanga_sunrise", objects: { wharf: "GlamVelvetSofa", sealion: "Fox", bike: "ToyCar", surfer: "CesiumMan", chowder: "ChairDamaskPurplegold", cypress: "Lantern", bench: "SheenChair" } },
};

async function get(url, dest) {
  if (fs.existsSync(dest)) return fs.readFileSync(dest);
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + " " + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return buf;
}

for (const [day, p] of Object.entries(plan)) {
  const world = readWorld(day);
  const objects = {};
  for (const [id, name] of Object.entries(p.objects)) {
    const file = "sample/" + name + ".glb";
    const buf = await get(khronos(name), path.join(assetsDir, file));
    objects[id] = { file, bytes: buf.length };
  }
  const raw = path.join(assetsDir, "sample", p.pano + ".full.jpg");
  await get(pano(p.pano), raw);
  const panoFile = "sample/" + p.pano + ".jpg";
  await sharp(raw).resize(4096, 2048).jpeg({ quality: 86 }).toFile(path.join(assetsDir, panoFile));
  world.sets.sample = { label: "dev stand-ins (Khronos CC0 models), not generated", objects };
  if (!world.panorama) world.panorama = { file: panoFile, source: pano(p.pano), yaw_deg: 0, height_m: 1.7 };
  if (!world.default_set) world.default_set = "sample";
  console.log("wrote", writeWorld(world));
}
