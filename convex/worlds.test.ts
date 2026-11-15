/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { installFakeGmi } from "./fakeGmi.testing";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("GMI_API_KEY", "test-key");
  installFakeGmi();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("add rejects empty and overlong transcripts", async () => {
  const t = convexTest(schema, modules);
  await expect(t.mutation(api.worlds.add, { transcript: "   " })).rejects.toThrow(
    "A world needs a description of your day.",
  );
  await expect(
    t.mutation(api.worlds.add, { transcript: "a".repeat(4001) }),
  ).rejects.toThrow("Keep your day under 4000 characters.");
});

test("list returns the newest worlds first with only the contract fields", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(api.worlds.add, { transcript: "First day." });
  vi.advanceTimersByTime(1000);
  const second = await t.mutation(api.worlds.add, { transcript: "Second day." });

  const worlds = await t.query(api.worlds.list, {});
  expect(worlds.map((world) => world._id)).toEqual([second, first]);
  expect(Object.keys(worlds[0]).sort()).toEqual([
    "_creationTime",
    "_id",
    "status",
    "transcript",
  ]);
  expect(worlds[0].status).toBe("queued");
});

test("get returns null for a world that no longer exists", async () => {
  const t = convexTest(schema, modules);
  const id = await t.mutation(api.worlds.add, { transcript: "A day." });
  await t.run(async (ctx) => ctx.db.delete("worlds", id));
  expect(await t.query(api.worlds.get, { id })).toBeNull();
});

test("retry leaves ready and generating worlds alone and starts worlds made before the pipeline", async () => {
  const t = convexTest(schema, modules);
  const generating = await t.mutation(api.worlds.add, { transcript: "Busy day." });
  const runBefore = await t.run(async (ctx) => (await ctx.db.get("worlds", generating))?.runId);
  await t.mutation(api.worlds.retry, { id: generating });
  expect(await t.run(async (ctx) => (await ctx.db.get("worlds", generating))?.runId)).toBe(
    runBefore,
  );

  const legacy = await t.run(async (ctx) =>
    ctx.db.insert("worlds", { transcript: "An old day." }),
  );
  await t.mutation(api.worlds.retry, { id: legacy });
  expect((await t.query(api.worlds.get, { id: legacy }))?.status).toBe("queued");

  await t.finishAllScheduledFunctions(vi.runAllTimers, 1000);
  expect((await t.query(api.worlds.get, { id: legacy }))?.status).toBe("ready");
  await expect(t.mutation(api.worlds.retry, { id: legacy })).rejects.toThrow(
    "This world is already ready.",
  );
});
