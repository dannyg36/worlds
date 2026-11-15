import { useSyncExternalStore } from "react";

import type { World } from "./worlds";

export const fixtureWorldsEnabled = process.env.EXPO_PUBLIC_FIXTURES === "1";

const khronos =
  "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models";

type Fixture = Omit<World, "_creationTime"> & { daysAgo: number };

// Island specs synced into ./island/samples by `npm run sync:island`, by fixture id.
// Import each sample that exists, e.g. `"fixture-birthday-dinner": birthdayDinner`.
const islands: Record<string, { title?: string; caption?: string }> = {};

const days: Fixture[] = [
  {
    _id: "fixture-hackathon",
    daysAgo: 0,
    status: "queued",
    transcript:
      "Okay so today was the YC hackathon. Got to the office at like nine, the whole team crammed around one table by the window, way too many Red Bulls. Danny and I argued about the database for twenty minutes. Around sunset we finally got the first world to render and everybody screamed. Ate cold pizza on the floor.",
    title: "Sunset Over the Hackathon",
    caption:
      "The first world rendered at golden hour, and the whole table screamed.",
    palette: ["#2A1E5C", "#F26B5B", "#FFB570", "#FFE3B3"],
    imageUrl: `${khronos}/BoomBox/screenshot/screenshot.jpg`,
    modelUrl: `${khronos}/BoomBox/glTF-Binary/BoomBox.glb`,
  },
  {
    _id: "fixture-santa-cruz",
    daysAgo: 1,
    status: "ready",
    transcript:
      "Took the day off and drove to Santa Cruz with Maya. Foggy in the morning but it cleared up around noon. We rented bikes, rode along the cliffs, saw like a hundred surfers. Got clam chowder in a bread bowl on the wharf and watched the sea lions yelling at each other. Sunburnt now.",
    title: "Cliffs, Bikes, and Sea Lions",
    caption:
      "Fog burned off by noon, then chowder in a bread bowl on the wharf.",
    palette: ["#0F3D5E", "#3FA7C9", "#F4D6A0", "#F28F6B"],
    imageUrl: `${khronos}/ToyCar/screenshot/screenshot.jpg`,
    modelUrl: `${khronos}/ToyCar/glTF-Binary/ToyCar.glb`,
  },
  {
    _id: "fixture-rainy-monday",
    daysAgo: 2,
    status: "failed",
    error: "The sculptor couldn't find a clear subject in the concept image.",
    transcript:
      "Rainy Monday. Missed the bus so I walked to work and my umbrella flipped inside out twice. Stopped at the little coffee place on Valencia and the barista drew a cat in my latte. Whole afternoon was meetings, then I cooked ramen at home and listened to the rain on the skylight.",
    title: "Umbrella Weather",
    caption: "A cat in the latte and rain on the skylight.",
    palette: ["#1E2A3A", "#4E6E8E", "#A9C1D9", "#F2B880"],
    imageUrl: `${khronos}/Lantern/screenshot/screenshot.jpg`,
    modelUrl: `${khronos}/Lantern/glTF-Binary/Lantern.glb`,
  },
  {
    _id: "fixture-dolores-park",
    daysAgo: 3,
    status: "ready",
    transcript:
      "Took Biscuit to Dolores Park this morning. He found a tennis ball and refused to give it back. Sat on the hill with my sister, we split a burrito and watched people play frisbee. Later it got super windy so we went home and napped. Pretty perfect lazy Sunday honestly.",
    title: "Biscuit Keeps the Ball",
    caption: "A lazy Sunday on the hill, a split burrito, frisbees everywhere.",
    palette: ["#1F4D2B", "#6FB36A", "#F7E08A", "#87CEEB"],
    imageUrl: `${khronos}/DamagedHelmet/screenshot/screenshot.png`,
    modelUrl: `${khronos}/DamagedHelmet/glTF-Binary/DamagedHelmet.glb`,
  },
  {
    _id: "fixture-birthday-dinner",
    daysAgo: 5,
    status: "ready",
    transcript:
      "It was Priya's birthday. We did dinner at this tiny Italian place with string lights over the patio. Eight of us at one long table, way too much pasta. The waiters brought out a tiramisu with a sparkler and sang. After, we walked to the bay and someone played guitar on the pier.",
    title: "String Lights for Priya",
    caption:
      "Eight at one long table, a sparkler in the tiramisu, guitar on the pier.",
    palette: ["#2B1530", "#B8475D", "#F7C873", "#FFF1D6"],
    imageUrl: `${khronos}/GlamVelvetSofa/screenshot/screenshot.jpg`,
    modelUrl: `${khronos}/GlamVelvetSofa/glTF-Binary/GlamVelvetSofa.glb`,
  },
  {
    _id: "fixture-finals-library",
    daysAgo: 8,
    transcript:
      "Long one. Spent like eleven hours in the library cramming for the organic chem final. Green desk lamps, huge windows, and it started snowing outside around four. Jake brought me hot chocolate. Pretty sure I memorized every reaction. Walked home through the snow at midnight and it was dead quiet.",
  },
  {
    _id: "fixture-mission-peak",
    daysAgo: 11,
    status: "ready",
    transcript:
      "Hiked Mission Peak at sunrise with my dad. Super steep, we stopped like five times. At the top there's that weird metal pole everybody takes photos with. Saw cows grazing on the way down. Dad kept talking about his garden tomatoes. Got pancakes after at a diner with red booths.",
    title: "Sunrise at the Summit",
    caption:
      "Five stops, one metal pole, cows on the way down, pancakes after.",
    palette: ["#3B2A4D", "#E9845A", "#F9C784", "#8FB996"],
    imageUrl: `${khronos}/Corset/screenshot/screenshot.jpg`,
    modelUrl: `${khronos}/Corset/glTF-Binary/Corset.glb`,
  },
  {
    _id: "fixture-farmers-market",
    daysAgo: 13,
    status: "ready",
    transcript:
      "Went to the Saturday farmers market at the Ferry Building. Bought peaches, sourdough, and these giant purple carrots. Ran into my old roommate Leo. Then spent the afternoon making a peach galette with my mom over FaceTime. It came out ugly but really good. Ate it on the balcony at golden hour.",
    title: "Golden Hour Galette",
    caption: "Peaches, purple carrots, and an ugly but delicious galette.",
    palette: ["#4A2C2A", "#E8875B", "#F6C453", "#8E5BAA"],
    imageUrl: `${khronos}/Avocado/screenshot/screenshot.jpg`,
    modelUrl: `${khronos}/Avocado/glTF-Binary/Avocado.glb`,
  },
];
const fixtures = days.map(withIsland);

function withIsland(fixture: Fixture): Fixture {
  const island = islands[fixture._id];
  if (!island) {
    return fixture;
  }
  return {
    ...fixture,
    title: island.title ?? fixture.title,
    caption: island.caption ?? fixture.caption,
    scene: JSON.stringify(island),
  };
}

const launchedAt = Date.now();
const day = 24 * 60 * 60 * 1000;

let worlds: World[] = fixtureWorldsEnabled
  ? fixtures.map(({ daysAgo, ...fixture }) => ({
      ...fixture,
      _creationTime: launchedAt - daysAgo * day,
    }))
  : [];
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>[]>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function update(id: string, changes: Partial<World>) {
  worlds = worlds.map((world) =>
    world._id === id ? { ...world, ...changes } : world,
  );
  listeners.forEach((listener) => listener());
}

function form(id: string) {
  const fixture = fixtures.find((candidate) => candidate._id === id);
  if (!fixture) {
    return;
  }
  timers.get(id)?.forEach(clearTimeout);
  update(id, {
    status: "queued",
    title: undefined,
    caption: undefined,
    palette: undefined,
    imageUrl: undefined,
    modelUrl: undefined,
    scene: undefined,
    error: undefined,
  });
  const { title, caption, palette, imageUrl, modelUrl, scene } = fixture;
  timers.set(id, [
    setTimeout(() => update(id, { status: "dreaming" }), 2500),
    setTimeout(
      () => update(id, { status: "painting", title, caption, palette, scene }),
      7000,
    ),
    setTimeout(() => update(id, { status: "sculpting", imageUrl }), 12000),
    setTimeout(() => update(id, { status: "ready", modelUrl }), 26000),
  ]);
}

if (fixtureWorldsEnabled) {
  form("fixture-hackathon");
}

export function isFixtureWorldId(id: string) {
  return id.startsWith("fixture-");
}

export function useFixtureWorlds() {
  const snapshot = () => worlds;
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function useFixtureWorld(id: string) {
  const snapshot = () => worlds.find((world) => world._id === id) ?? null;
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export async function retryFixtureWorld(id: string) {
  await new Promise((resolve) => setTimeout(resolve, 600));
  form(id);
}
