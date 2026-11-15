/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { memorySpace } from "./memory";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const OWNER = "https://worlds.test|ana";

type Respond = (
  path: string,
  body: { query?: string },
  signal?: AbortSignal,
) => unknown;

function stubSupermemory(respond: Respond) {
  const calls: { path: string; body: unknown; authorization: string | null }[] =
    [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (/gmi|googleapis/.test(url.hostname)) {
        return new Response("{}", { status: 500 });
      }
      const path = url.pathname;
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls.push({
        path,
        body,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      const result = await respond(path, body, init?.signal ?? undefined);
      return result instanceof Response ? result : Response.json(result);
    }),
  );
  return calls;
}

const down: Respond = () => {
  throw new TypeError("fetch failed");
};

const neverAnswers: Respond = (_path, _body, signal) =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason));
  });

function searchResults(...memories: [string, number][]) {
  return {
    results: memories.map(([memory, similarity], i) => ({
      id: `mem_${i}`,
      memory,
      similarity,
      metadata: {},
      isLatest: true,
      isInference: false,
      system: { updatedAt: "2026-11-14T08:00:00.000Z" },
    })),
    searchTime: 42,
  };
}

function profile(...memories: string[]) {
  return {
    profile: {
      static: memories.map((memory, i) => ({ id: `static_${i}`, memory })),
      dynamic: [
        { id: "dyn_0", memory: "[2026-11-14] User walked on Ocean Beach" },
      ],
      buckets: {},
    },
  };
}

beforeEach(() => {
  vi.stubEnv("SUPERMEMORY_API_KEY", "sm_test");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("adding a world schedules remember, which saves the day to its owner's space", async () => {
  vi.useFakeTimers();
  const calls = stubSupermemory(() => ({ id: "doc", status: "queued" }));
  const t = convexTest(schema, modules);
  const space = await memorySpace(OWNER);
  expect(space).toMatch(/^worlds-u-[0-9a-f]{32}$/);
  expect(await memorySpace("https://worlds.test|ben")).not.toBe(space);

  const worldId = await t
    .withIdentity({ tokenIdentifier: OWNER })
    .mutation(api.worlds.add, {
      transcript: "  Took Mochi to Blue Door Café.  ",
    });
  expect(calls).toHaveLength(0);

  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls.filter((call) => call.path.endsWith("/document"))).toEqual([
    {
      path: `/ns/${space}/document`,
      body: {
        id: worldId,
        content: "Took Mochi to Blue Door Café.",
        supportingContext: expect.stringContaining("recurs"),
        dreaming: "instant",
      },
      authorization: "Bearer sm_test",
    },
  ]);
});

test("adding to a world remembers only the new part, in the same document", async () => {
  vi.useFakeTimers();
  const calls = stubSupermemory(() => ({ id: "doc", status: "queued" }));
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ tokenIdentifier: OWNER });
  const space = await memorySpace(OWNER);

  const worldId = await owner.mutation(api.worlds.add, {
    transcript: "Took Mochi to Blue Door Café.",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await owner.mutation(api.worlds.extend, {
    id: worldId,
    transcript: "  Priya came by after.  ",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(
    calls
      .filter((call) => call.path.endsWith("/document"))
      .map(({ path, body }) => [path, body]),
  ).toEqual([
    [
      `/ns/${space}/document`,
      expect.objectContaining({
        id: worldId,
        content: "Took Mochi to Blue Door Café.",
      }),
    ],
    [
      `/ns/${space}/document`,
      expect.objectContaining({ id: worldId, content: "Priya came by after." }),
    ],
  ]);
});

test.each([
  ["down", down],
  ["never answers", neverAnswers],
])(
  "adding a world neither fails nor waits when Supermemory is %s",
  async (_name, respond) => {
    vi.useFakeTimers();
    const calls = stubSupermemory(respond);
    const t = convexTest(schema, modules);
    const owner = t.withIdentity({ tokenIdentifier: OWNER });

    const worldId = await owner.mutation(api.worlds.add, {
      transcript: "Took Mochi to the park.",
    });
    expect(calls).toHaveLength(0);
    expect(await owner.query(api.worlds.list)).toMatchObject([
      { _id: worldId },
    ]);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const runs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(
      runs
        .filter((run) => run.name.startsWith("memory:"))
        .map((run) => [run.name, run.args[0].attempt, run.state.kind]),
    ).toEqual([
      ["memory:remember", undefined, "success"],
      ["memory:remember", 1, "success"],
      ["memory:remember", 2, "success"],
      ["memory:remember", 3, "success"],
    ]);
    expect(console.error).toHaveBeenLastCalledWith(
      expect.stringContaining(`world ${worldId} on attempt 4`),
    );
    expect(await owner.query(api.worlds.list)).toMatchObject([
      { _id: worldId },
    ]);
  },
);

const TODAY =
  "Slow Sunday. Met Priya at our usual café for pastries and the dog came too, begging for croissant the whole time. Then we walked home through the drizzle.";

const lookUp = (name: string) =>
  `Who or what is ${name}, and what does ${name} look like?`;

const SEARCHES: Record<string, [string, number][]> = {
  [TODAY]: [
    ["User walked on Ocean Beach with Mochi and Priya on Saturday.", 0.62],
    [
      "Priya wore a yellow raincoat during the walk on Ocean Beach on Saturday.",
      0.58,
    ],
    ["Priya visited after work.", 0.55],
    ["Priya generally wears a mustard yellow raincoat.", 0.52],
    ["Sam gave Mochi a biscuit on 2026-11-14 morning.", 0.5],
    [
      "Mochi came home with sand in her orange fur after the walk on Ocean Beach on Saturday.",
      0.48,
    ],
    [
      "Mochi rolled in the sand during the walk on Ocean Beach on Saturday.",
      0.46,
    ],
    [
      "User worked from Blue Door Café on 2026-11-14 morning at the window table under hanging plants.",
      0.44,
    ],
    ["It was rainy on 2026-11-14.", 0.41],
    ["User had a cortado on the bench outside Blue Door Café.", 0.36],
  ],
  [lookUp("Priya")]: [
    ["Priya has curly black hair.", 0.71],
    ["Priya generally wears a mustard yellow raincoat.", 0.66],
    ["Priya is a best friend from college.", 0.6],
    [
      "Priya wore a yellow raincoat during the walk on Ocean Beach on Saturday.",
      0.55,
    ],
  ],
  [lookUp("Ocean Beach")]: [
    ["User walked on Ocean Beach with Mochi and Priya on Saturday.", 0.69],
    [
      "Mochi rolled in the sand during the walk on Ocean Beach on Saturday.",
      0.6,
    ],
  ],
  [lookUp("Mochi")]: [
    [
      "User has a pet named Mochi, a corgi, orange and fluffy, wearing a red collar with a little brass bell.",
      0.74,
    ],
    [
      "Mochi came home with sand in her orange fur after the walk on Ocean Beach on Saturday.",
      0.57,
    ],
    ["Mochi's collar bell jingles whenever she begs for more.", 0.55],
    ["Mochi stole a kid's tennis ball and refused to return it.", 0.41],
  ],
  [lookUp("Blue Door Café")]: [
    [
      "Blue Door Café on Valencia is a tiny place with a bright blue door and ivy all over the front.",
      0.73,
    ],
    ["Sam is the owner of Blue Door Café.", 0.6],
    ["User had a cortado on the bench outside Blue Door Café.", 0.45],
  ],
  [lookUp("Sam")]: [
    ["Sam is the owner of Blue Door Café.", 0.7],
    ["Sam gave Mochi a biscuit on 2026-11-14 morning.", 0.56],
  ],
};

const sampleSpace: Respond = (path, body) =>
  path.endsWith("/profile")
    ? profile()
    : searchResults(...(SEARCHES[body.query ?? ""] ?? []));

function castBlock(...facts: string[]) {
  return [
    "<recurring_cast>",
    'People, pets, places and things from this person\'s earlier days. Put one in the scene only when today\'s voice note brings it up, by name or by role ("my dog", "our usual café"), and then keep its name, relationship and look exactly as described here.',
    ...facts.map((fact) => `- ${fact}`),
    "</recurring_cast>",
  ].join("\n");
}

test("recall leads with what each recurring member looks like, then events", async () => {
  const calls = stubSupermemory(sampleSpace);
  const t = convexTest(schema, modules);

  const cast = await t.action(internal.memory.recall, { transcript: TODAY });

  expect(cast).toBe(
    castBlock(
      "Priya has curly black hair.",
      "User has a pet named Mochi, a corgi, orange and fluffy, wearing a red collar with a little brass bell.",
      "Blue Door Café on Valencia is a tiny place with a bright blue door and ivy all over the front.",
      "Sam is the owner of Blue Door Café.",
      "Priya generally wears a mustard yellow raincoat.",
      "Priya is a best friend from college.",
      "Mochi's collar bell jingles whenever she begs for more.",
      "User walked on Ocean Beach with Mochi and Priya on Saturday.",
      "Mochi rolled in the sand during the walk on Ocean Beach on Saturday.",
      "Priya wore a yellow raincoat during the walk on Ocean Beach on Saturday.",
      "Mochi came home with sand in her orange fur after the walk on Ocean Beach on Saturday.",
      "Sam gave Mochi a biscuit on 2026-11-14 morning.",
    ),
  );
  expect(calls).toHaveLength(7);
  expect(calls).toEqual(
    expect.arrayContaining([
      {
        path: "/ns/worlds-shared/search",
        body: {
          query: TODAY,
          searchMode: "memories",
          limit: 20,
          rewriteQuery: true,
        },
        authorization: "Bearer sm_test",
      },
      {
        path: "/ns/worlds-shared/profile",
        body: {},
        authorization: "Bearer sm_test",
      },
      ...["Priya", "Ocean Beach", "Mochi", "Blue Door Café", "Sam"].map(
        (name) => ({
          path: "/ns/worlds-shared/search",
          body: { query: lookUp(name), searchMode: "memories", limit: 5 },
          authorization: "Bearer sm_test",
        }),
      ),
    ]),
  );
});

test("recall ranks what the first search found when the look-ups miss the deadline", async () => {
  vi.useFakeTimers();
  stubSupermemory((path, body, signal) =>
    path.endsWith("/profile") || body.query === TODAY
      ? sampleSpace(path, body, signal)
      : neverAnswers(path, body, signal),
  );
  const t = convexTest(schema, modules);

  const cast = t.action(internal.memory.recall, { transcript: TODAY });
  await vi.advanceTimersByTimeAsync(4_000);

  expect(await cast).toBe(
    castBlock(
      "Priya generally wears a mustard yellow raincoat.",
      "User walked on Ocean Beach with Mochi and Priya on Saturday.",
      "Priya wore a yellow raincoat during the walk on Ocean Beach on Saturday.",
      "Priya visited after work.",
      "Sam gave Mochi a biscuit on 2026-11-14 morning.",
      "Mochi came home with sand in her orange fur after the walk on Ocean Beach on Saturday.",
      "Mochi rolled in the sand during the walk on Ocean Beach on Saturday.",
      "User worked from Blue Door Café on 2026-11-14 morning at the window table under hanging plants.",
      "It was rainy on 2026-11-14.",
      "User had a cortado on the bench outside Blue Door Café.",
    ),
  );
  expect(console.warn).toHaveBeenCalledWith(
    expect.stringContaining("Supermemory look-up failed"),
  );
});

test("recall reads the space it is given", async () => {
  const calls = stubSupermemory((path) =>
    path.endsWith("/search") ? searchResults() : profile(),
  );
  const t = convexTest(schema, modules);

  expect(
    await t.action(internal.memory.recall, {
      transcript: "Quiet day at home.",
      space: "user_42",
    }),
  ).toBe("");
  expect(calls.map((call) => call.path).sort()).toEqual([
    "/ns/user_42/profile",
    "/ns/user_42/search",
  ]);
});

test("recall keeps what one call found when the other fails", async () => {
  stubSupermemory((path) =>
    path.endsWith("/search")
      ? new Response("upstream timeout", { status: 503 })
      : profile("Mochi is the user's orange corgi with a red collar"),
  );
  const t = convexTest(schema, modules);

  const cast = await t.action(internal.memory.recall, {
    transcript: "Walked the dog.",
  });

  expect(cast).toContain(
    "- Mochi is the user's orange corgi with a red collar",
  );
  expect(console.warn).toHaveBeenCalledWith(
    expect.stringContaining("Supermemory search failed"),
  );
});

test("recall returns an empty string when Supermemory is down", async () => {
  stubSupermemory(down);
  const t = convexTest(schema, modules);

  expect(
    await t.action(internal.memory.recall, { transcript: "Walked Mochi." }),
  ).toBe("");
});

test("recall gives up after 4 seconds when Supermemory never answers", async () => {
  vi.useFakeTimers();
  stubSupermemory(neverAnswers);
  const t = convexTest(schema, modules);

  let settled = false;
  const cast = t
    .action(internal.memory.recall, { transcript: "Walked Mochi." })
    .finally(() => {
      settled = true;
    });
  await vi.advanceTimersByTimeAsync(3_999);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await cast).toBe("");
});

test("without an API key, remember and recall skip Supermemory", async () => {
  vi.useFakeTimers();
  vi.stubEnv("SUPERMEMORY_API_KEY", undefined);
  const calls = stubSupermemory(down);
  const t = convexTest(schema, modules);

  await t
    .withIdentity({ tokenIdentifier: OWNER })
    .mutation(api.worlds.add, { transcript: "Took Mochi to the park." });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.action(internal.memory.recall, { transcript: "Walked Mochi." }),
  ).toBe("");
  expect(calls).toHaveLength(0);
});
