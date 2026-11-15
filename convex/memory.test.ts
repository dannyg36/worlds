/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type Respond = (path: string, signal?: AbortSignal) => unknown;

function stubSupermemory(respond: Respond) {
  const calls: { path: string; body: unknown; authorization: string | null }[] =
    [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      calls.push({
        path,
        body: JSON.parse(String(init?.body ?? "{}")),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      const result = await respond(path, init?.signal ?? undefined);
      return result instanceof Response ? result : Response.json(result);
    }),
  );
  return calls;
}

const down: Respond = () => {
  throw new TypeError("fetch failed");
};

const neverAnswers: Respond = (_path, signal) =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason));
  });

function searchResults(...memories: string[]) {
  return {
    results: memories.map((memory, i) => ({
      id: `mem_${i}`,
      memory,
      similarity: 0.9 - i / 10,
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
      dynamic: [{ id: "dyn_0", memory: "[2026-11-14] User walked on Ocean Beach" }],
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

test("adding a world schedules remember, which saves the day to the shared space", async () => {
  vi.useFakeTimers();
  const calls = stubSupermemory(() => ({ id: "doc", status: "queued" }));
  const t = convexTest(schema, modules);

  const worldId = await t.mutation(api.worlds.add, {
    transcript: "  Took Mochi to Blue Door Café.  ",
  });
  expect(calls).toHaveLength(0);

  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toEqual([
    {
      path: "/ns/worlds-shared/document",
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

test.each([
  ["down", down],
  ["never answers", neverAnswers],
])(
  "adding a world neither fails nor waits when Supermemory is %s",
  async (_name, respond) => {
    vi.useFakeTimers();
    const calls = stubSupermemory(respond);
    const t = convexTest(schema, modules);

    const worldId = await t.mutation(api.worlds.add, {
      transcript: "Took Mochi to the park.",
    });
    expect(calls).toHaveLength(0);
    expect(await t.query(api.worlds.list)).toMatchObject([{ _id: worldId }]);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const runs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(
      runs.map((run) => [run.name, run.args[0].attempt, run.state.kind]),
    ).toEqual([
      ["memory:remember", undefined, "success"],
      ["memory:remember", 1, "success"],
      ["memory:remember", 2, "success"],
      ["memory:remember", 3, "success"],
    ]);
    expect(console.error).toHaveBeenLastCalledWith(
      expect.stringContaining(`world ${worldId} on attempt 4`),
    );
    expect(await t.query(api.worlds.list)).toMatchObject([{ _id: worldId }]);
  },
);

test("recall turns search results and the profile into one cast block", async () => {
  const calls = stubSupermemory((path) =>
    path.endsWith("/search")
      ? searchResults(
          "Mochi is the user's orange corgi with a red collar",
          "Blue Door Café has a bright blue door and ivy on the front",
        )
      : profile(
          "Mochi is the user's orange corgi with a red collar",
          "Priya is the user's best friend, with curly black hair",
        ),
  );
  const t = convexTest(schema, modules);

  const cast = await t.action(internal.memory.recall, {
    transcript: "Met Priya at our usual café and the dog came too.",
  });

  expect(cast).toBe(
    [
      "<recurring_cast>",
      'People, pets, places and things from this person\'s earlier days. Put one in the scene only when today\'s voice note brings it up, by name or by role ("my dog", "our usual café"), and then keep its name, relationship and look exactly as described here.',
      "- Mochi is the user's orange corgi with a red collar",
      "- Blue Door Café has a bright blue door and ivy on the front",
      "- Priya is the user's best friend, with curly black hair",
      "</recurring_cast>",
    ].join("\n"),
  );
  expect(calls).toEqual(
    expect.arrayContaining([
      {
        path: "/ns/worlds-shared/search",
        body: {
          query: "Met Priya at our usual café and the dog came too.",
          searchMode: "memories",
          limit: 8,
          rewriteQuery: true,
        },
        authorization: "Bearer sm_test",
      },
      {
        path: "/ns/worlds-shared/profile",
        body: {},
        authorization: "Bearer sm_test",
      },
    ]),
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

  expect(cast).toContain("- Mochi is the user's orange corgi with a red collar");
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

  await t.mutation(api.worlds.add, { transcript: "Took Mochi to the park." });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.action(internal.memory.recall, { transcript: "Walked Mochi." }),
  ).toBe("");
  expect(calls).toHaveLength(0);
});
