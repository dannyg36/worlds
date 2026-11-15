/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { installFakeClaude } from "./fakeClaude.testing";
import { installFakeGmi } from "./fakeGmi.testing";
import schema from "./schema";

vi.mock("./generation/anthropic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./generation/anthropic")>()),
  claudeText: vi.fn(),
}));

const modules = import.meta.glob("./**/*.ts");

const OWNER = "https://test.convex.dev|test-user";

/** A convex-test instance whose function calls are signed in as OWNER. */
function signedInTest() {
  const t = convexTest(schema, modules);
  const user = t.withIdentity({ tokenIdentifier: OWNER });
  return Object.assign(t, {
    query: user.query,
    mutation: user.mutation,
    action: user.action,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("GMI_API_KEY", "test-key");
  installFakeGmi();
  installFakeClaude();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("add rejects empty and overlong transcripts", async () => {
  const t = signedInTest();
  await expect(t.mutation(api.worlds.add, { transcript: "   " })).rejects.toThrow(
    "A world needs a description of your day.",
  );
  await expect(
    t.mutation(api.worlds.add, { transcript: "a".repeat(4001) }),
  ).rejects.toThrow("Keep your day under 4000 characters.");
});

test("list returns the newest worlds first with only the contract fields", async () => {
  const t = signedInTest();
  const first = await t.mutation(api.worlds.add, { transcript: "First day." });
  vi.advanceTimersByTime(1000);
  const second = await t.mutation(api.worlds.add, { transcript: "Second day." });

  const worlds = await t.query(api.worlds.list, {});
  expect(worlds.map((world) => world._id)).toEqual([second, first]);
  expect(Object.keys(worlds[0]).sort()).toEqual([
    "_creationTime",
    "_id",
    "shared",
    "status",
    "transcript",
  ]);
  expect(worlds[0].status).toBe("queued");
});

test("get returns null for a world that no longer exists", async () => {
  const t = signedInTest();
  const id = await t.mutation(api.worlds.add, { transcript: "A day." });
  await t.run(async (ctx) => ctx.db.delete("worlds", id));
  expect(await t.query(api.worlds.get, { id })).toBeNull();
});

test("retry leaves ready and generating worlds alone and starts worlds made before the pipeline", async () => {
  const t = signedInTest();
  const generating = await t.mutation(api.worlds.add, { transcript: "Busy day." });
  const runBefore = await t.run(async (ctx) => (await ctx.db.get("worlds", generating))?.runId);
  await t.mutation(api.worlds.retry, { id: generating });
  expect(await t.run(async (ctx) => (await ctx.db.get("worlds", generating))?.runId)).toBe(
    runBefore,
  );

  const legacy = await t.run(async (ctx) =>
    ctx.db.insert("worlds", {
      ownerTokenIdentifier: OWNER,
      transcript: "An old day.",
    }),
  );
  await t.mutation(api.worlds.retry, { id: legacy });
  expect((await t.query(api.worlds.get, { id: legacy }))?.status).toBe("queued");

  await t.finishAllScheduledFunctions(vi.runAllTimers, 1000);
  expect((await t.query(api.worlds.get, { id: legacy }))?.status).toBe("ready");
  await expect(t.mutation(api.worlds.retry, { id: legacy })).rejects.toThrow(
    "This world is already ready.",
  );
});

/** Stores a file the way an upload would, with the given bytes and content type. */
async function storeFile(t: ReturnType<typeof signedInTest>, text: string, type: string) {
  return await t.run(async (ctx) => ctx.storage.store(new Blob([text], { type })));
}

test("generateUploadUrl needs a signed-in user", async () => {
  await expect(
    convexTest(schema, modules).mutation(api.worlds.generateUploadUrl, {}),
  ).rejects.toThrow("Sign in to add photos.");
  expect(await signedInTest().mutation(api.worlds.generateUploadUrl, {})).toEqual(
    expect.any(String),
  );
});

test("add keeps the photos in order and get returns their URLs", async () => {
  const t = signedInTest();
  const photos = [
    await storeFile(t, "first photo", "image/jpeg"),
    await storeFile(t, "second photo", "image/png"),
  ];
  const id = await t.mutation(api.worlds.add, { transcript: "A day.", photos });

  expect(await t.run(async (ctx) => (await ctx.db.get("worlds", id))?.photos)).toEqual(photos);
  const urls = await t.run(async (ctx) =>
    Promise.all(photos.map((photo) => ctx.storage.getUrl(photo))),
  );
  expect((await t.query(api.worlds.get, { id }))?.photos).toEqual(urls);
});

test("add rejects photos that aren't images, are too big, or are too many", async () => {
  const t = signedInTest();
  const notAnImage = await storeFile(t, "hello", "text/plain");
  const tooBig = await storeFile(t, "x".repeat(4 * 1024 * 1024), "image/jpeg");
  for (const photo of [notAnImage, tooBig]) {
    await expect(
      t.mutation(api.worlds.add, { transcript: "A day.", photos: [photo] }),
    ).rejects.toThrow("Photos need to be JPEG, PNG, GIF or WebP images under 3.75 MB.");
  }
  const seven = [];
  for (let index = 0; index < 7; index++) {
    seven.push(await storeFile(t, `photo ${index}`, "image/jpeg"));
  }
  await expect(
    t.mutation(api.worlds.add, { transcript: "A day.", photos: seven }),
  ).rejects.toThrow("Add up to 6 photos.");
});
