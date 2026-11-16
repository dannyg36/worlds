import { claudeText, type ClaudeImage, type ClaudeRequest, type ImageType } from "./anthropic";
import { ISLAND_SYSTEM_PROMPT } from "./islandPrompt";
import { asRecord, ProviderError, type Provider } from "./provider";
import type { Scene } from "./scene";

/**
 * The island writer: turns a day into an island spec (spike/procedural/ISLAND.md)
 * with one outline call, then one call per vignette in parallel. Vignettes
 * that come back invalid get one repair call each; whatever is still invalid
 * after that is dropped object by object, so a sloppy vignette never fails the
 * world.
 */

// Keep these lists in sync with spike/procedural/ISLAND.md.
export const OBJECT_TYPES = new Set([
  "person", "dog",
  "table", "chair", "bench", "stool", "counter", "desk", "shelf", "sofa", "bed", "kitchen",
  "room", "wall", "roof", "house", "shop-front", "post", "fence", "awning",
  "string-lights", "lamp-post", "lantern", "desk-lamp", "campfire",
  "tree", "bush", "potted-plant", "planter", "flower-bed", "rock", "hill", "pond", "dock",
  "boat", "bridge", "fountain", "tent", "picnic-blanket", "beach-umbrella", "surfboard",
  "sandcastle",
  "car", "bus", "bus-stop", "food-truck", "traffic-cone", "street-sign", "hydrant", "bike",
  "plate", "glass", "bottle", "mug", "cake", "candle", "bread-basket", "guitar", "vase",
  "book", "laptop", "monitor", "tv", "whiteboard", "pizza-box", "backpack", "bin", "rug",
  "crate", "umbrella", "box", "sphere", "cylinder", "cone",
  "custom",
]);
export const TIMES = ["dawn", "morning", "noon", "golden-hour", "dusk", "night", "overcast", "rain", "snow"];
export const BIOMES = ["meadow", "beach", "snow", "autumn", "city", "desert"];
export const SURFACES = ["cobblestone", "grass", "wood", "tile", "sand", "snow", "asphalt", "carpet", "water"];
export const PLOT_RADIUS = { small: 2.0, medium: 2.6, large: 3.2 } as const;
export const MAX_CUSTOM_CODE = 4000;

type Size = keyof typeof PLOT_RADIUS;
type IslandObject = Record<string, unknown>;
export type Vignette = {
  title: string;
  moment: string;
  hero: boolean;
  size: Size;
  surface?: string;
  /** Indexes into the world's photos of the ones that show this moment; set when the day has photos. */
  photos?: number[];
  objects: IslandObject[];
};
export type Island = {
  title: string;
  caption: string;
  palette: string[];
  time: string;
  biome: string;
  landmark?: IslandObject;
  cast: Record<string, unknown>[];
  vignettes: Vignette[];
};
type Outline = Omit<Island, "vignettes"> & { vignettes: Omit<Vignette, "objects">[] };
/** A photo of the day as Claude takes it; null where a stored photo couldn't be read, so the numbers still line up. */
export type IslandPhoto = { mediaType: ImageType; data: string } | null;
export type IslandInput = { transcript: string; cast: string; photos?: IslandPhoto[] };
export type Complete = (request: Omit<ClaudeRequest, "model">) => Promise<string>;

const HEX_COLOR = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** The pipeline's dreaming provider. Its output is the island spec as a JSON string. */
export const claudeIsland: Provider = {
  name: "anthropic",
  submit: async (model, input, timeoutMs) => {
    const { transcript, cast, photos } = asRecord(input);
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), timeoutMs);
    try {
      const island = await writeIsland(
        {
          transcript: typeof transcript === "string" ? transcript : "",
          cast: typeof cast === "string" ? cast : "",
          photos: Array.isArray(photos) ? (photos as IslandPhoto[]) : [],
        },
        (request) =>
          claudeText({ ...request, model }, { timeoutMs, signal: deadline.signal }),
      );
      return { state: "done", output: JSON.stringify(island) };
    } finally {
      clearTimeout(timer);
    }
  },
  check: async () => {
    throw new ProviderError("The island writer finishes when it's submitted.");
  },
};

export async function writeIsland(
  { transcript, cast, photos = [] }: IslandInput,
  complete: Complete,
): Promise<Island> {
  const images = photos.flatMap((photo, index): ClaudeImage[] =>
    photo ? [{ label: `Photo ${index + 1}`, ...photo }] : [],
  );
  const outline = parseOutline(
    await complete({
      system: ISLAND_SYSTEM_PROMPT,
      user: outlinePrompt(transcript, cast, images.length),
      images,
      effort: "medium",
    }),
    images.length ? photos.length : 0,
  );
  const vignettes = await Promise.all(
    outline.vignettes.map(async (brief, index) => {
      const ask = (user: string) =>
        complete({ system: ISLAND_SYSTEM_PROMPT, user, effort: "low" });
      const first = await attempt(() => ask(vignettePrompt(outline, index)), brief.size);
      if (first.errors.length === 0) {
        return { ...brief, objects: first.objects };
      }
      const repair = await attempt(
        () => ask(repairPrompt(outline, index, first.reply, first.errors)),
        brief.size,
      );
      if (repair.errors.length === 0) {
        return { ...brief, objects: repair.objects };
      }
      const salvaged = [first, repair]
        .map((result) => dropInvalidObjects(result.objects, brief.size))
        .sort((a, b) => b.length - a.length)[0];
      console.warn(
        `Vignette ${index + 1} kept ${salvaged.length} objects after repair: ${repair.errors.slice(0, 5).join("; ")}`,
      );
      return { ...brief, objects: salvaged };
    }),
  );
  if (vignettes.every((vignette) => vignette.objects.length === 0)) {
    throw new Error("The island writer returned no usable objects.");
  }
  return { ...outline, vignettes };
}

/** The title, caption, palette and thumbnail prompt the rest of the pipeline uses. */
export function islandScene(island: Island): Scene {
  const moments = island.vignettes
    .map((vignette) => `${vignette.title}: ${vignette.moment}`)
    .join(" ");
  return {
    title: island.title,
    caption: island.caption,
    palette: island.palette,
    imagePrompt: [
      `A tiny floating island diorama of one person's day, "${island.title}". ${island.caption}`,
      `A winding path joins ${island.vignettes.length} little scenes around the island, in order: ${moments}`,
      `${island.biome} island in ${island.time} light.`,
      "Isometric three-quarter view of the whole island, centered and fully in frame with empty space around it, plain soft background. Chunky handmade clay miniatures like a stop-motion film set, matte clay textures, every corner full of small props, tiny stylized figures without detailed faces, no text or letters.",
    ].join("\n"),
  };
}

function outlinePrompt(transcript: string, cast: string, photoCount: number) {
  const note = `Voice note:\n"""\n${transcript}\n"""`;
  const photos = photoCount
    ? `The person also shared ${photoCount === 1 ? "a photo" : `${photoCount} photos`} from the day, shown above, each after its label. Use them with the note for how the places, people and things look. Give each vignette a \`photos\` array with the numbers of the photos that show its moment, like \`"photos": [2]\`, and put every photo in exactly one vignette: the moment it shows, or the closest one.`
    : "";
  const fields = photoCount
    ? "`title`, `moment`, `hero`, `size`, `surface` and `photos`"
    : "`title`, `moment`, `hero`, `size` and `surface`";
  const ask = `This is the outline call of two-call mode. Reply with only the top-level JSON object for this day, with \`vignettes\` holding only ${fields} (no \`objects\`). No prose and no code fences.`;
  return [cast, note, photos, ask].filter(Boolean).join("\n\n");
}

function vignettePrompt(outline: Outline, index: number) {
  const brief = outline.vignettes[index];
  // Vignette calls don't see the photos, so their numbers would only confuse them.
  const shown = JSON.stringify(outline, (key, value) => (key === "photos" ? undefined : value), 2);
  return [
    `This is a vignette call of two-call mode. The island outline:\n${shown}`,
    `Write vignette ${index + 1} of ${outline.vignettes.length}, "${brief.title}" (${brief.size}, plot radius ${PLOT_RADIUS[brief.size]} m): ${brief.moment}`,
    'Reply with only `{ "objects": [...] }` for this vignette. No prose and no code fences.',
  ].join("\n\n");
}

function repairPrompt(outline: Outline, index: number, reply: string, errors: string[]) {
  return [
    vignettePrompt(outline, index),
    `Your previous answer for this vignette was:\n${reply || "(no answer)"}`,
    `It had these problems:\n${errors.map((error) => `- ${error}`).join("\n")}`,
    'Fix every problem and reply with the whole corrected `{ "objects": [...] }`.',
  ].join("\n\n");
}

async function attempt(ask: () => Promise<string>, size: Size) {
  let reply = "";
  try {
    reply = await ask();
    const objects = asRecord(parseJsonObject(reply)).objects;
    if (!Array.isArray(objects)) {
      return { reply, objects: [], errors: ["objects is not an array"] };
    }
    return { reply, objects: objects as IslandObject[], errors: objectErrors(objects, size) };
  } catch (error) {
    return {
      reply,
      objects: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

/** photoCount is how many photos the day has; when it's 0, vignettes get no `photos`. */
export function parseOutline(text: string, photoCount = 0): Outline {
  const fields = asRecord(parseJsonObject(text));
  const palette = (Array.isArray(fields.palette) ? fields.palette : [])
    .map((color) => (typeof color === "string" ? color.trim() : ""))
    .filter((color) => HEX_COLOR.test(color))
    .map(normalizeHex)
    .slice(0, 5);
  if (palette.length < 3) {
    throw new Error("The island outline has fewer than 3 palette colors.");
  }
  const briefs = Array.isArray(fields.vignettes) ? fields.vignettes.map(asRecord) : [];
  if (briefs.length < 4 || briefs.length > 5) {
    throw new Error(`The island outline has ${briefs.length} vignettes instead of 4 or 5.`);
  }
  const vignettes = briefs.map((brief, index) => {
    const size: Size =
      typeof brief.size === "string" && brief.size in PLOT_RADIUS
        ? (brief.size as Size)
        : "medium";
    return {
      title: cleanText(brief.title, `vignette ${index + 1} title`, 60),
      moment: cleanText(brief.moment, `vignette ${index + 1} moment`, 240),
      hero: brief.hero === true,
      size,
      ...(typeof brief.surface === "string" && SURFACES.includes(brief.surface)
        ? { surface: brief.surface }
        : {}),
    };
  });
  // Exactly one hero: keep the first one, or crown the biggest plot.
  const firstHero = vignettes.findIndex((vignette) => vignette.hero);
  const crowned =
    firstHero >= 0
      ? firstHero
      : vignettes.reduce(
          (best, vignette, index) =>
            PLOT_RADIUS[vignette.size] > PLOT_RADIUS[vignettes[best].size] ? index : best,
          0,
        );
  vignettes.forEach((vignette, index) => (vignette.hero = index === crowned));
  const photos = placePhotos(briefs, crowned, photoCount);
  const landmark = asRecord(fields.landmark);
  return {
    title: cleanText(fields.title, "title", 60),
    caption: cleanText(fields.caption, "caption", 160),
    palette,
    time: typeof fields.time === "string" && TIMES.includes(fields.time) ? fields.time : "golden-hour",
    biome: typeof fields.biome === "string" && BIOMES.includes(fields.biome) ? fields.biome : "meadow",
    ...(objectErrors([{ at: [0, 0], ...landmark, on: undefined }], "large").length === 0
      ? { landmark }
      : {}),
    cast: (Array.isArray(fields.cast) ? fields.cast.map(asRecord) : []).filter(
      (member) => typeof member.name === "string" && member.name.trim(),
    ),
    vignettes: photos
      ? vignettes.map((vignette, index) => ({ ...vignette, photos: photos[index] }))
      : vignettes,
  };
}

/**
 * Each vignette's photos as 0-based indexes. A photo number the outline gives
 * goes to the first vignette that names it, and the hero takes any photo
 * nobody named, so every photo the person shared shows up somewhere.
 */
function placePhotos(briefs: Record<string, unknown>[], hero: number, count: number) {
  if (count === 0) {
    return null;
  }
  const placed = new Set<number>();
  const photos = briefs.map((brief) =>
    (Array.isArray(brief.photos) ? brief.photos : []).flatMap((value) => {
      const number =
        typeof value === "number" ? value : typeof value === "string" ? Number(/\d+/.exec(value)?.[0]) : NaN;
      const photo = number - 1;
      if (!Number.isInteger(photo) || photo < 0 || photo >= count || placed.has(photo)) {
        return [];
      }
      placed.add(photo);
      return [photo];
    }),
  );
  for (let photo = 0; photo < count; photo++) {
    if (!placed.has(photo)) {
      photos[hero].push(photo);
    }
  }
  return photos.map((list) => list.sort((a, b) => a - b));
}

/** A stored photo as Claude takes it, or null when it isn't a JPEG, PNG, GIF or WebP image. */
export function islandPhoto(bytes: Uint8Array): IslandPhoto {
  const text = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  const mediaType: ImageType | null =
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      ? "image/jpeg"
      : bytes[0] === 0x89 && text(1, 4) === "PNG"
        ? "image/png"
        : text(0, 4) === "GIF8"
          ? "image/gif"
          : text(0, 4) === "RIFF" && text(8, 12) === "WEBP"
            ? "image/webp"
            : null;
  if (!mediaType) {
    return null;
  }
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return { mediaType, data: btoa(binary) };
}

/** Problems with a vignette's objects, one line each, for the repair call. */
export function objectErrors(objects: unknown[], size: Size): string[] {
  const errors: string[] = [];
  const limit = PLOT_RADIUS[size];
  const ids = new Set<string>();
  objects.forEach((value, index) => {
    const object = asRecord(value);
    const label = `objects[${index}]${typeof object.id === "string" ? ` "${object.id}"` : ""} (${String(object.type ?? "no type")})`;
    if (value !== object || Array.isArray(value)) {
      errors.push(`objects[${index}] is not an object`);
      return;
    }
    if (typeof object.id === "string") {
      if (ids.has(object.id)) {
        errors.push(`${label}: id is used twice`);
      }
      ids.add(object.id);
    }
    if (typeof object.type !== "string" || !OBJECT_TYPES.has(object.type)) {
      errors.push(`${label}: unknown type; use a kit type or "custom"`);
    }
    const at = object.at;
    if (object.type === "string-lights" && at === undefined) {
      // string lights are placed by their points
    } else if (!Array.isArray(at) || at.length !== 2 || !at.every(isNumber)) {
      errors.push(`${label}: at must be [x, z] numbers`);
    } else if (object.on === undefined && (Math.abs(at[0]) > limit || Math.abs(at[1]) > limit)) {
      errors.push(`${label}: at [${at[0]}, ${at[1]}] is outside the ${size} plot (keep |x| and |z| within ${(limit - 0.2).toFixed(1)})`);
    }
    if (object.type === "string-lights") {
      const points = object.points;
      if (!Array.isArray(points) || points.length < 2 || !points.every((point) => Array.isArray(point) && point.length === 3 && point.every(isNumber))) {
        errors.push(`${label}: points must be at least two [x, y, z] number triples`);
      }
    }
    if (object.type === "custom") {
      if (typeof object.code !== "string" || !object.code.trim()) {
        errors.push(`${label}: custom code must be a string`);
      } else if (object.code.length >= MAX_CUSTOM_CODE) {
        errors.push(`${label}: custom code is ${object.code.length} characters; keep it under ${MAX_CUSTOM_CODE}`);
      }
    }
  });
  objects.forEach((value, index) => {
    const on = asRecord(value).on;
    if (on !== undefined && (typeof on !== "string" || !ids.has(on))) {
      errors.push(`objects[${index}]: on ${JSON.stringify(on)} matches no id in this vignette`);
    }
  });
  return errors;
}

/** The objects that pass on their own, minus anything resting on a dropped one. */
export function dropInvalidObjects(objects: IslandObject[], size: Size): IslandObject[] {
  const seen = new Set<string>();
  let kept = objects.filter((object) => {
    const id = asRecord(object).id;
    const duplicate = typeof id === "string" && seen.has(id);
    if (typeof id === "string") seen.add(id);
    const { on: _on, ...alone } = asRecord(object);
    return !duplicate && objectErrors([alone], size).length === 0;
  });
  for (;;) {
    const ids = new Set(kept.map((object) => object.id).filter((id) => typeof id === "string"));
    const next = kept.filter((object) => object.on === undefined || ids.has(object.on as string));
    if (next.length === kept.length) {
      return kept;
    }
    kept = next;
  }
}

function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) {
    throw new Error("The island writer returned no JSON object.");
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("The island writer returned invalid JSON.");
  }
}

function isNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function cleanText(value: unknown, field: string, maxLength: number): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text) {
    throw new Error(`The island outline has no ${field}.`);
  }
  return text.slice(0, maxLength);
}

function normalizeHex(color: string): string {
  const digits = color.replace("#", "").toLowerCase();
  return digits.length === 3
    ? `#${[...digits].map((digit) => digit + digit).join("")}`
    : `#${digits}`;
}
