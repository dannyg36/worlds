import { describe, expect, test } from "vitest";
import { dropInvalidObjects, objectErrors, parseOutline } from "./island";

const BRIEF = { title: "Pier", moment: "We play guitar on the pier.", size: "medium" };
const OUTLINE = {
  title: "Pier Night",
  caption: "Guitar on the pier.",
  palette: ["#123", "#abcdef", "#ffffff"],
  time: "dusk",
  biome: "beach",
  cast: [{ name: "me" }],
  vignettes: [BRIEF, BRIEF, BRIEF, BRIEF],
};

describe("parseOutline", () => {
  test("crowns exactly one hero and fills in defaults", () => {
    const outline = parseOutline(
      JSON.stringify({
        ...OUTLINE,
        time: "teatime",
        landmark: { type: "spaceship" },
        vignettes: [BRIEF, { ...BRIEF, size: "large" }, BRIEF, { ...BRIEF, surface: "lava" }],
      }),
    );
    expect(outline.vignettes.map((vignette) => vignette.hero)).toEqual([false, true, false, false]);
    expect(outline.vignettes[3].surface).toBeUndefined();
    expect(outline).toMatchObject({ time: "golden-hour", biome: "beach", palette: ["#112233", "#abcdef", "#ffffff"] });
    expect(outline.landmark).toBeUndefined();

    const twoHeroes = parseOutline(
      JSON.stringify({ ...OUTLINE, vignettes: [BRIEF, { ...BRIEF, hero: true }, { ...BRIEF, hero: true }, BRIEF] }),
    );
    expect(twoHeroes.vignettes.map((vignette) => vignette.hero)).toEqual([false, true, false, false]);
  });

  test("needs 4 or 5 vignettes", () => {
    expect(() => parseOutline(JSON.stringify({ ...OUTLINE, vignettes: [BRIEF] }))).toThrow(
      "The island outline has 1 vignettes instead of 4 or 5.",
    );
  });
});

describe("vignette objects", () => {
  const objects = [
    { type: "table", id: "t", at: [0, 0] },
    { type: "plate", on: "t", at: [0.1, 0] },
    { type: "dragon", at: [0, 0] },
    { type: "rock", at: [2.7, 0] },
    { type: "glass", on: "nowhere", at: [0, 0] },
    { type: "custom", id: "big", at: [0, 0], code: "x".repeat(4000) },
    { type: "mug", on: "big", at: [0, 0] },
    { type: "custom", at: [0, 0], code: 42 },
    { type: "string-lights", points: [[0, 2, -1], [1, 2, -1]] },
  ];

  test("objectErrors names every problem", () => {
    expect(objectErrors(objects, "medium")).toEqual([
      'objects[2] (dragon): unknown type; use a kit type or "custom"',
      "objects[3] (rock): at [2.7, 0] is outside the medium plot (keep |x| and |z| within 2.4)",
      'objects[5] "big" (custom): custom code is 4000 characters; keep it under 4000',
      "objects[7] (custom): custom code must be a string",
      'objects[4]: on "nowhere" matches no id in this vignette',
    ]);
    expect(objectErrors(objects, "large")).not.toContainEqual(expect.stringContaining("(rock)"));
  });

  test("dropInvalidObjects keeps the valid ones and what rests on them", () => {
    expect(dropInvalidObjects(objects, "medium")).toEqual([
      objects[0],
      objects[1],
      objects[8],
    ]);
  });
});
