#!/usr/bin/env node
// Validates scene specs against SCHEMA.md.
// Usage: node spike/procedural/validate.mjs <spec.json> [...more]
// Also importable: import { validate } from "./validate.mjs".

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Keep these in sync with SCHEMA.md.
export const TYPES = [
  "table", "chair", "bench", "stool", "counter", "desk", "shelf",
  "person", "dog",
  "wall", "roof", "post", "fence", "awning",
  "string-lights", "lamp-post", "lantern",
  "tree", "bush", "potted-plant", "planter", "rock",
  "plate", "glass", "bottle", "cake", "candle", "bread-basket", "vase",
  "book", "laptop", "mug", "guitar", "crate", "umbrella", "bike",
  "box", "sphere", "cylinder", "cone",
];
export const TIMES = ["dawn", "morning", "noon", "golden-hour", "dusk", "night", "overcast", "rain", "snow"];
export const SHAPES = ["round", "square"];
export const SURFACES = ["cobblestone", "grass", "wood", "tile", "sand", "snow", "asphalt", "carpet", "water"];
const BASE_HALF = 4.5;
const DENSITY = [40, 90];

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isPair = (v) => Array.isArray(v) && v.length === 2 && v.every(isNum);
const isTriple = (v) => Array.isArray(v) && v.length === 3 && v.every(isNum);

export function validate(spec) {
  const errors = [];
  const warnings = [];
  const stats = { objects: 0, types: {}, people: 0 };

  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    errors.push("spec is not a JSON object");
    return { errors, warnings, stats };
  }
  if (typeof spec.title !== "string" || !spec.title.trim()) warnings.push("missing title");
  if (!TIMES.includes(spec.time)) errors.push(`time ${JSON.stringify(spec.time)} is not one of ${TIMES.join(", ")}`);
  const base = spec.base ?? {};
  if (!SHAPES.includes(base.shape)) errors.push(`base.shape ${JSON.stringify(base.shape)} is not one of ${SHAPES.join(", ")}`);
  if (!SURFACES.includes(base.surface)) errors.push(`base.surface ${JSON.stringify(base.surface)} is not one of ${SURFACES.join(", ")}`);
  if (!Array.isArray(spec.objects)) {
    errors.push("objects is not an array");
    return { errors, warnings, stats };
  }

  const objects = spec.objects;
  const label = (o, i) => `objects[${i}]${o?.id !== undefined ? ` "${o.id}"` : ""} (${o?.type ?? "no type"})`;

  const ids = new Map();
  objects.forEach((o, i) => {
    if (o?.id === undefined) return;
    if (ids.has(o.id)) errors.push(`${label(o, i)}: id duplicates objects[${ids.get(o.id)}]`);
    else ids.set(o.id, i);
  });

  objects.forEach((o, i) => {
    const where = label(o, i);
    if (!o || typeof o !== "object" || Array.isArray(o)) {
      errors.push(`objects[${i}]: not an object`);
      return;
    }
    stats.objects++;
    stats.types[o.type] = (stats.types[o.type] ?? 0) + 1;
    if (o.type === "person") stats.people++;

    if (!TYPES.includes(o.type)) errors.push(`${where}: unknown type`);
    // string-lights `points` are absolute (anchored on post tops), so their `at` is optional.
    if (o.type === "string-lights" && o.at === undefined) {
      // nothing to place
    } else if (!isPair(o.at)) {
      errors.push(`${where}: at must be [x, z] numbers, got ${JSON.stringify(o.at)}`);
    } else if (o.on === undefined) {
      const [x, z] = o.at;
      const inside = base.shape === "square"
        ? Math.abs(x) <= BASE_HALF && Math.abs(z) <= BASE_HALF
        : Math.hypot(x, z) <= BASE_HALF;
      if (!inside) errors.push(`${where}: at [${x}, ${z}] is outside the ${base.shape ?? "round"} base (${BASE_HALF})`);
    }
    if (o.on !== undefined && !ids.has(o.on)) errors.push(`${where}: on ${JSON.stringify(o.on)} matches no id`);
    for (const key of ["rot", "scale"]) {
      if (o[key] !== undefined && !isNum(o[key])) warnings.push(`${where}: ${key} is not a number`);
    }
    if (o.type === "string-lights") {
      if (!Array.isArray(o.points) || o.points.length < 2 || !o.points.every(isTriple)) {
        errors.push(`${where}: points must be an array of at least two [x, y, z] number triples`);
      }
    }
  });

  // `on` chains must end on the ground.
  objects.forEach((o, i) => {
    const seen = new Set([i]);
    for (let j = ids.get(o?.on); j !== undefined; j = ids.get(objects[j]?.on)) {
      if (seen.has(j)) {
        if (j !== i) break; // a cycle further up; reported from its own members
        errors.push(`${label(o, i)}: on chain loops back to itself`);
        break;
      }
      seen.add(j);
    }
  });

  if (stats.objects < DENSITY[0] || stats.objects > DENSITY[1]) {
    warnings.push(`${stats.objects} objects; SCHEMA.md asks for ${DENSITY[0]} to ${DENSITY[1]}`);
  }
  return { errors, warnings, stats };
}

export function formatStats({ objects, types, people }) {
  const histogram = Object.entries(types)
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([type, n]) => `${type} ${n}`)
    .join(", ");
  return `${objects} objects, ${people} people | ${histogram}`;
}

function main(files) {
  if (!files.length) {
    console.error("usage: node spike/procedural/validate.mjs <spec.json> [...more]");
    process.exit(2);
  }
  let failed = 0;
  for (const file of files) {
    let result;
    try {
      result = validate(JSON.parse(readFileSync(file, "utf8")));
    } catch (error) {
      result = { errors: [`cannot read: ${error.message}`], warnings: [], stats: null };
    }
    const { errors, warnings, stats } = result;
    if (errors.length) failed++;
    const verdict = errors.length ? `FAIL (${errors.length} errors, ${warnings.length} warnings)` : `OK (${warnings.length} warnings)`;
    console.log(`${file}: ${verdict}`);
    for (const e of errors) console.log(`  error: ${e}`);
    for (const w of warnings) console.log(`  warning: ${w}`);
    if (stats) console.log(`  ${formatStats(stats)}`);
  }
  if (files.length > 1) console.log(`${files.length - failed}/${files.length} valid`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
