#!/usr/bin/env node
// Validates scene specs against SCHEMA.md, and island specs (anything with a `vignettes` array) against ISLAND.md.
// Usage: node spike/procedural/validate.mjs <spec.json> [...more]
// Also importable: import { validate, validateIsland, validateVignette } from "./validate.mjs".

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Keep these in sync with SCHEMA.md and ISLAND.md.
export const TYPES = [
  "table", "chair", "bench", "stool", "counter", "desk", "shelf", "sofa", "bed", "kitchen",
  "person", "dog",
  "room", "wall", "roof", "house", "shop-front", "post", "fence", "awning",
  "string-lights", "lamp-post", "lantern", "desk-lamp", "campfire",
  "tree", "bush", "potted-plant", "planter", "flower-bed", "rock", "hill", "pond", "dock", "boat", "bridge",
  "fountain", "tent", "picnic-blanket", "beach-umbrella", "surfboard", "sandcastle",
  "car", "bus", "bus-stop", "food-truck", "traffic-cone", "street-sign", "hydrant", "bike",
  "plate", "glass", "bottle", "cake", "candle", "bread-basket", "vase",
  "book", "laptop", "mug", "guitar", "monitor", "tv", "whiteboard", "pizza-box", "backpack", "bin", "rug",
  "crate", "umbrella",
  "box", "sphere", "cylinder", "cone",
  "custom",
];
export const TIMES = ["dawn", "morning", "noon", "golden-hour", "dusk", "night", "overcast", "rain", "snow"];
export const SHAPES = ["round", "square"];
export const SURFACES = ["cobblestone", "grass", "wood", "tile", "sand", "snow", "asphalt", "carpet", "water"];
export const BIOMES = ["meadow", "beach", "snow", "autumn", "city", "desert"];
export const PLOT_RADIUS = { small: 2.0, medium: 2.6, large: 3.2 };
const HAIR_STYLES = ["short", "long", "bun", "curly", "bald", "cap"];
const BASE_HALF = 4.5;
const DENSITY = [40, 90];
const PLOT_MARGIN = 0.2;
const VIGNETTE_COUNT = [4, 5];
const VIGNETTE_DENSITY = [12, 30];
const CUSTOM_CODE_MAX = 4000;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isPair = (v) => Array.isArray(v) && v.length === 2 && v.every(isNum);
const isTriple = (v) => Array.isArray(v) && v.length === 3 && v.every(isNum);
const isHex = (v) => typeof v === "string" && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v);
const emptyStats = () => ({ objects: 0, types: {}, people: 0, custom: 0 });

// `code` is the body of a function of `k`; compile it without running it.
function checkCustom(o, where, errors) {
  if (typeof o.code !== "string" || !o.code.trim()) errors.push(`${where}: custom needs a code string`);
  else if (o.code.length > CUSTOM_CODE_MAX) errors.push(`${where}: code is ${o.code.length} chars; keep it under ${CUSTOM_CODE_MAX}`);
  else {
    try {
      new Function("k", o.code);
    } catch (error) {
      errors.push(`${where}: code does not parse as a function body: ${error.message}`);
    }
  }
}

// Shared per-object checks. `inside(x, z)` says whether a ground position is in bounds; `bounds` names them.
function checkObjects(objects, { prefix = "", inside, bounds }, { errors, warnings, stats }) {
  const label = (o, i) =>
    `${prefix}objects[${i}]${o?.id !== undefined ? ` "${o.id}"` : ""} (${o?.type ?? "no type"}${o?.type === "custom" && o.name ? ` "${o.name}"` : ""})`;

  const ids = new Map();
  objects.forEach((o, i) => {
    if (o?.id === undefined) return;
    if (ids.has(o.id)) errors.push(`${label(o, i)}: id duplicates objects[${ids.get(o.id)}]`);
    else ids.set(o.id, i);
  });

  objects.forEach((o, i) => {
    const where = label(o, i);
    if (!o || typeof o !== "object" || Array.isArray(o)) {
      errors.push(`${prefix}objects[${i}]: not an object`);
      return;
    }
    stats.objects++;
    stats.types[o.type] = (stats.types[o.type] ?? 0) + 1;
    if (o.type === "person") stats.people++;
    if (o.type === "custom") {
      stats.custom++;
      checkCustom(o, where, errors);
    }

    if (!TYPES.includes(o.type)) errors.push(`${where}: unknown type`);
    // string-lights `points` are absolute (anchored on post tops), so their `at` is optional.
    if (o.type === "string-lights" && o.at === undefined) {
      // nothing to place
    } else if (!isPair(o.at)) {
      errors.push(`${where}: at must be [x, z] numbers, got ${JSON.stringify(o.at)}`);
    } else if (o.on === undefined) {
      const [x, z] = o.at;
      if (!inside(x, z)) errors.push(`${where}: at [${x}, ${z}] is outside ${bounds}`);
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
  return label;
}

export function validate(spec) {
  if (Array.isArray(spec?.vignettes)) return validateIsland(spec);
  const errors = [];
  const warnings = [];
  const stats = emptyStats();

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

  checkObjects(
    spec.objects,
    {
      inside: (x, z) =>
        base.shape === "square" ? Math.abs(x) <= BASE_HALF && Math.abs(z) <= BASE_HALF : Math.hypot(x, z) <= BASE_HALF,
      bounds: `the ${base.shape ?? "round"} base (${BASE_HALF})`,
    },
    { errors, warnings, stats },
  );

  if (stats.objects < DENSITY[0] || stats.objects > DENSITY[1]) {
    warnings.push(`${stats.objects} objects; SCHEMA.md asks for ${DENSITY[0]} to ${DENSITY[1]}`);
  }
  return { errors, warnings, stats };
}

// One vignette in its plot's local frame. `castNames` is the island's cast, for `who`.
export function validateVignette(v, i, castNames = new Set()) {
  const errors = [];
  const warnings = [];
  const stats = { ...emptyStats(), who: [] };
  const name = `vignettes[${i}]${typeof v?.title === "string" ? ` "${v.title}"` : ""}`;
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    errors.push(`${name}: not an object`);
    return { errors, warnings, stats };
  }
  if (typeof v.title !== "string" || !v.title.trim()) warnings.push(`${name}: missing title`);
  if (typeof v.moment !== "string" || !v.moment.trim()) warnings.push(`${name}: missing moment`);
  if (typeof v.hero !== "boolean") warnings.push(`${name}: hero is not true or false`);
  const radius = PLOT_RADIUS[v.size];
  if (radius === undefined) errors.push(`${name}: size ${JSON.stringify(v.size)} is not one of ${Object.keys(PLOT_RADIUS).join(", ")}`);
  if (v.surface !== undefined && !SURFACES.includes(v.surface)) {
    errors.push(`${name}: surface ${JSON.stringify(v.surface)} is not one of ${SURFACES.join(", ")}`);
  }
  if (!Array.isArray(v.objects)) {
    errors.push(`${name}: objects is not an array`);
    return { errors, warnings, stats };
  }

  // ISLAND.md: |x| and |z| no more than radius - 0.2. That square's corners poke out of the round plot, so warn there.
  const r = radius ?? PLOT_RADIUS.small;
  const limit = Math.round((r - PLOT_MARGIN) * 100) / 100;
  const label = checkObjects(
    v.objects,
    {
      prefix: `${name} `,
      inside: (x, z) => Math.abs(x) <= limit && Math.abs(z) <= limit,
      bounds: `the ${v.size ?? "small"} plot (|x| and |z| at most ${limit})`,
    },
    { errors, warnings, stats },
  );

  const seen = new Set();
  v.objects.forEach((o, j) => {
    if (!o || typeof o !== "object") return;
    const d = isPair(o.at) ? Math.hypot(...o.at) : 0;
    if (o.on === undefined && d > r && Math.abs(o.at[0]) <= limit && Math.abs(o.at[1]) <= limit) {
      warnings.push(`${label(o, j)}: at [${o.at.join(", ")}] is ${d.toFixed(2)} m from the centre, outside the round ${r} m plot`);
    }
    if (o.who === undefined) return;
    if (o.type !== "person") warnings.push(`${label(o, j)}: who is only for people`);
    else if (!castNames.has(o.who)) errors.push(`${label(o, j)}: who ${JSON.stringify(o.who)} is not in the cast`);
    else if (seen.has(o.who)) warnings.push(`${label(o, j)}: ${o.who} appears twice in this vignette`);
    seen.add(o.who);
  });
  stats.who = [...seen];

  if (stats.objects < VIGNETTE_DENSITY[0] || stats.objects > VIGNETTE_DENSITY[1]) {
    warnings.push(`${name}: ${stats.objects} objects; ISLAND.md asks for ${VIGNETTE_DENSITY[0]} to ${VIGNETTE_DENSITY[1]}`);
  }
  return { errors, warnings, stats };
}

export function validateIsland(spec) {
  const errors = [];
  const warnings = [];
  const stats = { ...emptyStats(), vignettes: 0 };

  if (typeof spec.title !== "string" || !spec.title.trim()) warnings.push("missing title");
  if (typeof spec.caption !== "string" || !spec.caption.trim()) warnings.push("missing caption");
  if (spec.palette !== undefined && !(Array.isArray(spec.palette) && spec.palette.every(isHex))) {
    warnings.push("palette is not a list of #hex colours");
  }
  if (!TIMES.includes(spec.time)) errors.push(`time ${JSON.stringify(spec.time)} is not one of ${TIMES.join(", ")}`);
  if (!BIOMES.includes(spec.biome)) errors.push(`biome ${JSON.stringify(spec.biome)} is not one of ${BIOMES.join(", ")}`);
  if (spec.landmark !== undefined) {
    const type = spec.landmark?.type;
    if (!TYPES.includes(type)) errors.push(`landmark type ${JSON.stringify(type)} is not a kit type`);
    else if (type === "custom") checkCustom(spec.landmark, "landmark (custom)", errors);
  }

  const castNames = new Set();
  if (!Array.isArray(spec.cast) || !spec.cast.length) {
    errors.push("cast is not a non-empty array");
  } else {
    spec.cast.forEach((c, i) => {
      if (typeof c?.name !== "string" || !c.name.trim()) errors.push(`cast[${i}]: missing name`);
      else if (castNames.has(c.name)) errors.push(`cast[${i}]: name "${c.name}" is used twice`);
      else castNames.add(c.name);
      if (c?.hairStyle !== undefined && !HAIR_STYLES.includes(c.hairStyle)) {
        warnings.push(`cast[${i}]: hairStyle ${JSON.stringify(c.hairStyle)} is not one of ${HAIR_STYLES.join(", ")}`);
      }
    });
    if (castNames.size && !castNames.has("me")) warnings.push('cast has no "me" (the narrator)');
  }

  const vignettes = spec.vignettes;
  stats.vignettes = vignettes.length;
  if (vignettes.length < VIGNETTE_COUNT[0] || vignettes.length > VIGNETTE_COUNT[1]) {
    errors.push(`${vignettes.length} vignettes; ISLAND.md asks for ${VIGNETTE_COUNT[0]} or ${VIGNETTE_COUNT[1]}`);
  }
  const heroes = vignettes.filter((v) => v?.hero === true);
  if (heroes.length !== 1) errors.push(`${heroes.length} hero vignettes; exactly one is required`);

  const perVignette = vignettes.map((v, i) => validateVignette(v, i, castNames));
  const appeared = new Set();
  for (const r of perVignette) {
    errors.push(...r.errors);
    warnings.push(...r.warnings);
    stats.objects += r.stats.objects;
    stats.people += r.stats.people;
    stats.custom += r.stats.custom;
    for (const [type, n] of Object.entries(r.stats.types)) stats.types[type] = (stats.types[type] ?? 0) + n;
    for (const who of r.stats.who) appeared.add(who);
  }
  for (const name of castNames) if (!appeared.has(name)) warnings.push(`cast member "${name}" appears in no vignette`);

  if (heroes.length === 1) {
    const hero = heroes[0];
    const count = (v) => (Array.isArray(v?.objects) ? v.objects.length : 0);
    if (hero.size !== "large") warnings.push(`the hero "${hero.title}" is ${hero.size}, not large`);
    if (vignettes.some((v) => count(v) > count(hero))) warnings.push(`the hero "${hero.title}" is not the densest vignette`);
  }
  return { errors, warnings, stats, vignettes: perVignette };
}

export function formatStats({ objects, types, people, custom, vignettes }) {
  const histogram = Object.entries(types)
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([type, n]) => `${type} ${n}`)
    .join(", ");
  return `${vignettes !== undefined ? `${vignettes} vignettes, ` : ""}${objects} objects, ${people} people${custom ? `, ${custom} custom` : ""} | ${histogram}`;
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
