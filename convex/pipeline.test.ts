/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  chatReply,
  installFakeGmi,
  MEDIA_URL,
  SCENE,
  type FakeGmi,
} from "./fakeGmi.testing";
import { models } from "./generation/models";
import { recallCast, memorySpace } from "./memory";
import schema from "./schema";

vi.mock("./memory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./memory")>()),
  recallCast: vi.fn(async () => ""),
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
const TRANSCRIPT = "Got to the office at nine and ate cold pizza on the floor.";
const NO_RESOURCES = "hunyuan api error [ResourceInsufficient]: Resources are insufficient.";

let gmi: FakeGmi;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("GMI_API_KEY", "test-key");
  gmi = installFakeGmi();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Test = TestConvex<typeof schema>;

async function settle(t: Test) {
  await t.finishAllScheduledFunctions(vi.runAllTimers, 1000);
}

async function runUntil(t: Test, done: () => boolean | Promise<boolean>) {
  for (let round = 0; round < 200; round++) {
    if (await done()) {
      return;
    }
    await step(t);
  }
  throw new Error("The pipeline never reached the expected state.");
}

async function step(t: Test) {
  vi.runOnlyPendingTimers();
  await t.finishInProgressScheduledFunctions();
}

async function world(t: Test, id: Id<"worlds">) {
  const found = await t.query(api.worlds.get, { id });
  if (!found) {
    throw new Error("World not found.");
  }
  return found;
}

async function currentRun(t: Test, id: Id<"worlds">) {
  return await t.run(async (ctx) => {
    const found = await ctx.db.get("worlds", id);
    const run = found?.runId && (await ctx.db.get("generationRuns", found.runId));
    if (!run) {
      throw new Error("Run not found.");
    }
    return run;
  });
}

async function tasks(t: Test, id: Id<"worlds">, step: keyof typeof models) {
  return (await currentRun(t, id)).tasks.filter((task) => task.step === step);
}

async function storedFiles(t: Test) {
  return await t.run(async (ctx) => {
    const files = await ctx.db.system.query("_storage").collect();
    return await Promise.all(
      files.map(async (file) => (await ctx.storage.get(file._id))!.text()),
    );
  });
}

async function cancelScheduledFunctions(t: Test) {
  await t.run(async (ctx) => {
    for (const job of await ctx.db.system.query("_scheduled_functions").collect()) {
      if (job.state.kind === "pending") {
        await ctx.scheduler.cancel(job._id);
      }
    }
  });
}

describe("generation", () => {
  test("turns a transcript into a stored, textured world one status at a time", async () => {
    const t = signedInTest();
    const id = await t.mutation(api.worlds.add, { transcript: `  ${TRANSCRIPT}  ` });
    const statuses = [(await world(t, id)).status];
    gmi.onSubmit(async () => {
      statuses.push((await world(t, id)).status);
    });
    await settle(t);
    const ready = await world(t, id);
    statuses.push(ready.status);

    expect(statuses).toEqual(["queued", "dreaming", "painting", "sculpting", "ready"]);
    expect(ready).toMatchObject({
      transcript: TRANSCRIPT,
      title: SCENE.title,
      caption: SCENE.caption,
      palette: ["#ffb347", "#2e4057", "#f6f1e9", "#e94f37"],
      imageUrl: expect.any(String),
      modelUrl: expect.any(String),
    });
    expect(ready.error).toBeUndefined();

    const [dream] = gmi.submitted("dreaming");
    const [paint] = gmi.submitted("painting");
    const [sculpt] = gmi.submitted("sculpting");
    expect(JSON.stringify(dream.input.messages)).toContain(TRANSCRIPT);
    expect(paint.input.prompt).toContain(SCENE.imagePrompt);
    expect(sculpt.input).toEqual({
      image_url: `${MEDIA_URL}/${paint.id}.jpg`,
      generate_type: "Normal",
      enable_pbr: false,
      face_count: 40_000,
    });

    const run = await currentRun(t, id);
    expect(run).toMatchObject({
      step: "ready",
      attempt: 1,
      scene: { ...SCENE, palette: ready.palette },
    });
    expect(
      run.tasks.map((task) => [task.step, task.outcome, task.provider, task.model, task.requestId]),
    ).toEqual([
      ["dreaming", "ok", "gmi", models.dreaming.id, `chatcmpl-${dream.id}`],
      ["painting", "ok", "gmi", models.painting.id, paint.id],
      ["sculpting", "ok", "gmi", models.sculpting.id, sculpt.id],
    ]);
    expect(run.tasks.every((task) => task.completedAt && task.finishedAt)).toBe(true);
    expect(run.durations).toEqual({
      dreaming: expect.any(Number),
      painting: expect.any(Number),
      sculpting: expect.any(Number),
      total: expect.any(Number),
    });
    expect((await storedFiles(t)).sort()).toEqual([
      `/gmi-test/${paint.id}.jpg`,
      `/gmi-test/${sculpt.id}.glb`,
    ]);
  });

  test("retries a scene writer reply that isn't JSON", async () => {
    gmi.script("dreaming", { result: chatReply("Sorry, I can't help with that.") });
    const t = signedInTest();
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await settle(t);

    expect((await world(t, id)).status).toBe("ready");
    const dreams = await tasks(t, id, "dreaming");
    expect(dreams.map((task) => task.outcome)).toEqual(["failed", "ok"]);
    expect(dreams[0].error).toBe("The scene writer returned no JSON object.");
  });

  test("retries requests GMI rejects or marks failed", async () => {
    gmi.script("painting", { rejectSubmit: 503 }, { error: "Upstream provider unavailable" });
    gmi.script("sculpting", { error: "Model generation failed" });
    const t = signedInTest();
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await settle(t);

    expect((await world(t, id)).status).toBe("ready");
    expect(gmi.rejectedSubmits).toEqual(["painting"]);
    expect(
      (await tasks(t, id, "painting")).map((task) => [task.outcome, task.error]),
    ).toEqual([
      ["failed", "GMI 503: Upstream provider unavailable; please retry"],
      ["failed", "Upstream provider unavailable"],
      ["ok", undefined],
    ]);
    expect(
      (await tasks(t, id, "sculpting")).map((task) => [task.outcome, task.error]),
    ).toEqual([
      ["failed", "Model generation failed"],
      ["ok", undefined],
    ]);
  });

  test("fails the world once every 3D attempt fails, and retry regenerates it", async () => {
    gmi.script(
      "sculpting",
      ...Array.from({ length: models.sculpting.maxTries }, () => ({
        rejectSubmit: 500,
        error: NO_RESOURCES,
      })),
    );
    const t = signedInTest();
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await settle(t);

    const failed = await world(t, id);
    expect(failed).toMatchObject({
      status: "failed",
      error: `Sculpting the 3D model failed: GMI 500: ${NO_RESOURCES}`,
      title: SCENE.title,
      imageUrl: expect.any(String),
    });
    expect(failed.modelUrl).toBeUndefined();
    expect(gmi.rejectedSubmits).toHaveLength(models.sculpting.maxTries);

    await t.mutation(api.worlds.retry, { id });
    const restarted = await world(t, id);
    expect(restarted.status).toBe("queued");
    expect(restarted.title).toBeUndefined();
    expect(restarted.imageUrl).toBeUndefined();
    expect(restarted.error).toBeUndefined();
    await settle(t);

    expect((await world(t, id)).status).toBe("ready");
    expect((await currentRun(t, id)).attempt).toBe(2);
    expect(gmi.submitted("dreaming")).toHaveLength(2);
    const paint = gmi.submitted("painting").at(-1)!;
    const sculpt = gmi.submitted("sculpting").at(-1)!;
    expect((await storedFiles(t)).sort()).toEqual([
      `/gmi-test/${paint.id}.jpg`,
      `/gmi-test/${sculpt.id}.glb`,
    ]);
  });

  test("gives up on a 3D request that never finishes without paying for another", async () => {
    gmi.script("sculpting", { stuck: true });
    const t = signedInTest();
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await settle(t);

    expect(await world(t, id)).toMatchObject({
      status: "failed",
      error: `Sculpting the 3D model failed: ${models.sculpting.id} took longer than ${models.sculpting.timeoutMs / 1000}s.`,
    });
    expect(gmi.submitted("sculpting")).toHaveLength(1);
    expect(await tasks(t, id, "sculpting")).toEqual([
      expect.objectContaining({ outcome: "timedOut", startedAt: expect.any(Number) }),
    ]);
  });

  test("fails at once without retrying when GMI_API_KEY is missing", async () => {
    vi.stubEnv("GMI_API_KEY", "");
    const t = signedInTest();
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await settle(t);

    expect(await world(t, id)).toMatchObject({
      status: "failed",
      error: "Writing the scene failed: GMI_API_KEY is not set on this Convex deployment.",
    });
    expect((await currentRun(t, id)).tasks).toHaveLength(1);
    expect(gmi.requests).toHaveLength(0);
  });

  test("keeps one 3D job in flight and starts the next when it finishes", async () => {
    gmi.script("sculpting", { stuck: true });
    const t = signedInTest();
    const ids = [
      await t.mutation(api.worlds.add, { transcript: TRANSCRIPT }),
      await t.mutation(api.worlds.add, { transcript: "Rainy Monday, ramen with Sam." }),
    ];
    await runUntil(t, async () =>
      (await Promise.all(ids.map((id) => world(t, id)))).every(
        (found) => found.status === "sculpting",
      ),
    );
    for (let round = 0; round < 20; round++) {
      await step(t);
    }
    expect(gmi.submitted("sculpting")).toHaveLength(1);
    const sculpts = await Promise.all(ids.map((id) => tasks(t, id, "sculpting")));
    expect(sculpts.map((found) => found.length).sort()).toEqual([0, 1]);

    gmi.submitted("sculpting")[0].outcome = {};
    await settle(t);

    expect((await Promise.all(ids.map((id) => world(t, id)))).map((found) => found.status)).toEqual([
      "ready",
      "ready",
    ]);
    expect(gmi.submitted("sculpting")).toHaveLength(2);
    const [first, second] = (
      await Promise.all(ids.map(async (id) => (await tasks(t, id, "sculpting"))[0]))
    ).sort((a, b) => a.submittedAt - b.submittedAt);
    expect(second.submittedAt).toBeGreaterThanOrEqual(first.finishedAt!);
  });

  test("completes a step once when two polls find it done", async () => {
    gmi.script("sculpting", { stuck: true });
    const t = signedInTest();
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await runUntil(t, () => gmi.submitted("sculpting").length === 1);
    await cancelScheduledFunctions(t);
    const [request] = gmi.submitted("sculpting");
    request.outcome = {};

    const runId = (await currentRun(t, id))._id;
    const poll = { runId, step: "sculpting" as const, attempt: 1, requestId: request.id };
    await Promise.all([
      t.action(internal.pipeline.poll, poll),
      t.action(internal.pipeline.poll, poll),
    ]);
    await settle(t);

    expect((await world(t, id)).status).toBe("ready");
    expect(gmi.downloads.filter((path) => path.endsWith(".glb"))).toHaveLength(1);
    expect(await tasks(t, id, "sculpting")).toEqual([
      expect.objectContaining({ outcome: "ok", requestId: request.id }),
    ]);

    const late = await t.run(async (ctx) => ctx.storage.store(new Blob(["late"])));
    expect(
      await t.mutation(internal.pipeline.completeTask, {
        runId,
        attempt: 1,
        requestId: request.id,
        output: { step: "sculpting", storageId: late },
      }),
    ).toBe(false);
    expect(await storedFiles(t)).toHaveLength(2);
  });
});

describe("watchdog", () => {
  test("revives a run whose poll chain was lost", async () => {
    gmi.script("sculpting", { stuck: true });
    const t = signedInTest();
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await runUntil(t, () => gmi.submitted("sculpting").length === 1);
    await cancelScheduledFunctions(t);
    gmi.submitted("sculpting")[0].outcome = {};

    vi.advanceTimersByTime(30_000);
    await t.mutation(internal.pipeline.watchdog, {});
    await settle(t);
    expect((await world(t, id)).status).toBe("sculpting");

    vi.advanceTimersByTime(90_000);
    await t.mutation(internal.pipeline.watchdog, {});
    await settle(t);
    expect((await world(t, id)).status).toBe("ready");
    expect(gmi.submitted("sculpting")).toHaveLength(1);
  });

  test("fails a run that passes its deadline", async () => {
    gmi.script("sculpting", { stuck: true });
    const t = signedInTest();
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await runUntil(t, () => gmi.submitted("sculpting").length === 1);
    await cancelScheduledFunctions(t);

    vi.advanceTimersByTime(31 * 60_000);
    await t.mutation(internal.pipeline.watchdog, {});

    expect(await world(t, id)).toMatchObject({
      status: "failed",
      error: "Generation took too long.",
    });
  });
});

describe("extend", () => {
  const LATER = "After dinner Sam came over with a kite.";
  const DAY = `${TRANSCRIPT}\n\n${LATER}`;

  test("regenerates a ready world from the whole day and deletes its old files", async () => {
    const t = signedInTest();
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await settle(t);
    const first = await currentRun(t, id);

    await t.mutation(api.worlds.extend, { id, transcript: `  ${LATER}  ` });
    const extended = await world(t, id);
    expect(extended).toMatchObject({ transcript: DAY, status: "queued" });
    expect(extended.title).toBeUndefined();
    expect(extended.imageUrl).toBeUndefined();
    expect(extended.modelUrl).toBeUndefined();
    expect(await storedFiles(t)).toEqual([]);
    const run = await currentRun(t, id);
    expect(run._id).not.toBe(first._id);
    expect(run.attempt).toBe(2);

    await settle(t);
    expect((await world(t, id)).status).toBe("ready");
    const dream = gmi.submitted("dreaming").at(-1)!;
    const messages = dream.input.messages as { role: string; content: string }[];
    expect(messages.find((message) => message.role === "user")?.content).toBe(
      `Voice note:\n"""\n${DAY}\n"""`,
    );
    const paint = gmi.submitted("painting").at(-1)!;
    const sculpt = gmi.submitted("sculpting").at(-1)!;
    expect((await storedFiles(t)).sort()).toEqual([
      `/gmi-test/${paint.id}.jpg`,
      `/gmi-test/${sculpt.id}.glb`,
    ]);
  });

  test("replaces a run that's still forming and throws away its late result", async () => {
    gmi.script("sculpting", { stuck: true });
    const t = signedInTest();
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await runUntil(t, () => gmi.submitted("sculpting").length === 1);
    const replaced = await currentRun(t, id);

    await t.mutation(api.worlds.extend, { id, transcript: LATER });
    const [late] = gmi.submitted("sculpting");
    late.outcome = {};
    await settle(t);

    expect(await world(t, id)).toMatchObject({ status: "ready", transcript: DAY });
    expect((await currentRun(t, id)).attempt).toBe(2);
    expect(
      await t.run(async (ctx) => ctx.db.get("generationRuns", replaced._id)),
    ).toMatchObject({ step: "failed" });
    expect(gmi.downloads).toContain(`/gmi-test/${late.id}.glb`);
    const paint = gmi.submitted("painting").at(-1)!;
    const sculpt = gmi.submitted("sculpting").at(-1)!;
    expect(sculpt.id).not.toBe(late.id);
    expect((await storedFiles(t)).sort()).toEqual([
      `/gmi-test/${paint.id}.jpg`,
      `/gmi-test/${sculpt.id}.glb`,
    ]);
  });
});

test("the scene writer gets the recalled cast ahead of the voice note", async () => {
  const cast = "<recurring_cast>\n- Mochi is a corgi in a red collar\n</recurring_cast>";
  vi.mocked(recallCast).mockResolvedValueOnce(cast);
  const t = signedInTest();
  await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
  await settle(t);

  const [dream] = gmi.submitted("dreaming");
  const messages = dream.input.messages as { role: string; content: string }[];
  expect(recallCast).toHaveBeenCalledWith(TRANSCRIPT, await memorySpace(OWNER));
  expect(messages.find((message) => message.role === "user")?.content).toBe(
    `${cast}\n\nVoice note:\n"""\n${TRANSCRIPT}\n"""`,
  );
});

test("without a recalled cast the scene writer prompt is only the voice note", async () => {
  const t = signedInTest();
  await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
  await settle(t);

  const [dream] = gmi.submitted("dreaming");
  const messages = dream.input.messages as { role: string; content: string }[];
  expect(messages.find((message) => message.role === "user")?.content).toBe(
    `Voice note:\n"""\n${TRANSCRIPT}\n"""`,
  );
});
