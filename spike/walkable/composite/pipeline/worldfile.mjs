import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const compositeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const walkableDir = path.resolve(compositeDir, "..");
export const assetsDir = path.join(compositeDir, "assets");
export const scenes = JSON.parse(fs.readFileSync(path.join(walkableDir, "scenes.json"), "utf8"));

export function sceneSpec(day) {
  const d = scenes.days[day];
  if (!d || !d.objects) throw new Error("no full scene spec for '" + day + "'");
  return { day, title: d.title, transcript: d.transcript, time_of_day: d.time_of_day, weather: d.weather, palette: d.palette, ground: d.ground, objects: d.objects, style: scenes.style };
}

export function readWorld(day) {
  const p = path.join(compositeDir, "worlds", day + ".json");
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  return { day, spec: sceneSpec(day), panorama: null, default_set: null, sets: {} };
}

export function writeWorld(world) {
  world.spec = sceneSpec(world.day);
  const p = path.join(compositeDir, "worlds", world.day + ".json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(world, null, 2) + "\n");
  return p;
}

export function readManifest() {
  const p = path.join(compositeDir, "manifest.json");
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  return { note: "Every file the composite page needs. fetch-assets.mjs downloads each url to assets/<file> and checks bytes and sha256.", files: [] };
}

export function upsertManifest(entries) {
  const m = readManifest();
  for (const e of entries) {
    const i = m.files.findIndex((f) => f.file === e.file);
    if (i >= 0) m.files[i] = e;
    else m.files.push(e);
  }
  m.files.sort((a, b) => a.file.localeCompare(b.file));
  fs.writeFileSync(path.join(compositeDir, "manifest.json"), JSON.stringify(m, null, 2) + "\n");
}
