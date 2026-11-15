/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  installFakeClaude,
  OUTLINE,
  vignetteObjects,
  type FakeClaude,
} from "./fakeClaude.testing";
import { installFakeGmi, MEDIA_URL, type FakeGmi } from "./fakeGmi.testing";
import { CLAUDE_MODEL } from "./generation/anthropic";
import { ISLAND_SYSTEM_PROMPT } from "./generation/islandPrompt";
import { models } from "./generation/models";
import { ProviderError } from "./generation/provider";
import { recallCast, memorySpace } from "./memory";
import schema from "./schema";

vi.mock("./memory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./memory")>()),
  recallCast: vi.fn(async () => ""),
}));
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
const TRANSCRIPT = "Got to the office at nine and ate cold pizza on the floor.";
const NO_RESOURCES = "hunyuan api error [ResourceInsufficient]: Resources are insufficient.";

let gmi: FakeGmi;
let claude: FakeClaude;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("GMI_API_KEY", "test-key");
  gmi = installFakeGmi();
  claude = installFakeClaude();
});

afterEach(() => {
  models.sculpt = false;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Test = TestConvex<typeof schema>;
type Step = "dreaming" | "painting" | "sculpting";

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

async function island(t: Test, id: Id<"worlds">) {
  const { scene } = await world(t, id);
  if (!scene) {
    throw new Error("The world has no scene.");
  }
  return JSON.parse(scene);
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

async function tasks(t: Test, id: Id<"worlds">, step: Step) {
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

/** A world whose island writer is mid-call: one dreaming task with no answer yet. */
async function insertDreamingRun(t: Test) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const worldId = await ctx.db.insert("worlds", {
      ownerTokenIdentifier: OWNER,
      transcript: TRANSCRIPT,
      status: "dreaming",
    });
    const runId = await ctx.db.insert("generationRuns", {
      worldId,
      attempt: 1,
      step: "dreaming",
      tasks: [
        { step: "dreaming", attempt: 1, provider: "anthropic", model: CLAUDE_MODEL, submittedAt: now },
      ],
      durations: {},
      startedAt: now,
      stepStartedAt: now,
      touchedAt: now,
    });
    await ctx.db.patch("worlds", worldId, { runId });
    return worldId;
  });
}

describe("generation", () => {
  test("writes the island, shows it, then paints the thumbnail and finishes", async () => {
    const t = signedInTest();
    const id = await t.mutation(api.worlds.add, { transcript: `  ${TRANSCRIPT}  ` });
    const statuses = [(await world(t, id)).status];
    claude.onCall(async (call) => {
      if (call.kind === "outline") statuses.push((await world(t, id)).status);
    });
    let painting: Awaited<ReturnType<typeof world>> | undefined;
    gmi.onSubmit(async () => {
      painting = await world(t, id);
      statuses.push(painting.status);
    });
    await settle(t);
    const ready = await world(t, id);
    statuses.push(ready.status);

    expect(statuses).toEqual(["queued", "dreaming", "painting", "ready"]);
    expect(painting?.scene).toBe(ready.scene);
    expect(ready).toMatchObject({
      transcript: TRANSCRIPT,
      title: OUTLINE.title,
      caption: OUTLINE.caption,
      palette: ["#ffb347", "#2e4057", "#f6f1e9"],
      imageUrl: expect.any(String),
    });
    expect(ready.modelUrl).toBeUndefined();
    expect(ready.error).toBeUndefined();
    expect(await island(t, id)).toEqual({
      ...OUTLINE,
      palette: ready.palette,
      vignettes: OUTLINE.vignettes.map((vignette, index) => ({
        ...vignette,
        objects: vignetteObjects(index + 1),
      })),
    });

    const [outline, ...vignettes] = claude.calls;
    expect(outline).toMatchObject({
      kind: "outline",
      model: CLAUDE_MODEL,
      effort: "medium",
      system: ISLAND_SYSTEM_PROMPT,
    });
    expect(outline.user).toContain(TRANSCRIPT);
    expect(vignettes.map((call) => [call.kind, call.vignette, call.effort])).toEqual(
      [1, 2, 3, 4].map((index) => ["vignette", index, "low"]),
    );
    expect(vignettes.every((call) => call.system === ISLAND_SYSTEM_PROMPT)).toBe(true);

    const [paint] = gmi.submitted("painting");
    expect(paint.input.prompt).toContain(OUTLINE.title);
    expect(paint.input.prompt).toContain(OUTLINE.caption);
    for (const vignette of OUTLINE.vignettes) {
      expect(paint.input.prompt).toContain(vignette.moment);
    }
    expect(paint.input.prompt).toContain("clay");
    expect(gmi.submitted("sculpting")).toHaveLength(0);

    const run = await currentRun(t, id);
    expect(run).toMatchObject({ step: "ready", attempt: 1 });
    expect(
      run.tasks.map((task) => [task.step, task.outcome, task.provider, task.model]),
    ).toEqual([
      ["dreaming", "ok", "anthropic", CLAUDE_MODEL],
      ["painting", "ok", "gmi", models.painting.id],
    ]);
    expect(run.tasks.every((task) => task.finishedAt)).toBe(true);
    expect(run.durations).toEqual({
      dreaming: expect.any(Number),
      painting: expect.any(Number),
      total: expect.any(Number),
    });
    expect(await storedFiles(t)).toEqual([`/gmi-test/${paint.id}.jpg`]);
  });

  test("repairs a vignette that comes back invalid", async () => {
    const broken = [
      { type: "spaceship", at: [0, 0] },
      { type: "bench", at: [9, 0] },
      { type: "mug", on: "missing-table", at: [0, 0] },
    ];
    claude.script("vignette", 2, { objects: broken });
    const t = signedInTest();
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await settle(t);

    expect((await world(t, id)).status).toBe("ready");
    expect((await island(t, id)).vignettes[1].objects).toEqual(vignetteObjects(2));
    const repairs = claude.calls.filter((call) => call.kind === "repair");
    expect(repairs.map((call) => [call.vignette, call.effort])).toEqual([[2, "low"]]);
    expect(repairs[0].user).toContain(JSON.stringify({ objects: broken }));
    expect(repairs[0].user).toContain('(spaceship): unknown type');
    expect(repairs[0].user).toContain("is outside the large plot");
    expect(repairs[0].user).toContain('on "missing-table" matches no id');
  });

  test("drops what is still invalid after the repair instead of failing the world", async () => {
    const good = { type: "rock", at: [0.5, 0.5] };
    claude.script("vignette", 3, new ProviderError("Claude 529: Overloaded", 529));
    claude.script("repair", 3, {
      objects: [
        good,
        { type: "custom", id: "huge", at: [0, 0], code: "x".repeat(5000) },
        { type: "mug", on: "huge", at: [0, 0] },
      ],
    });
    const t = signedInTest();
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await settle(t);

    expect((await world(t, id)).status).toBe("ready");
    const { vignettes } = await island(t, id);
    expect(vignettes[2]).toMatchObject({ title: OUTLINE.vignettes[2].title, objects: [good] });
    expect(vignettes[0].objects).toEqual(vignetteObjects(1));
    const repair = claude.calls.find((call) => call.kind === "repair");
    expect(repair?.user).toContain("Claude 529: Overloaded");
    expect((await tasks(t, id, "dreaming")).map((task) => task.outcome)).toEqual(["ok"]);
  });

  test("retries the island when the outline is unusable, and fails after the last try", async () => {
    const tooShort = { ...OUTLINE, vignettes: OUTLINE.vignettes.slice(0, 3) };
    claude.script("outline", undefined, tooShort, "Sorry, I can't help with that.");
    const t = signedInTest();
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await settle(t);

    expect(await world(t, id)).toMatchObject({
      status: "failed",
      error: "Writing the scene failed: The island writer returned no JSON object.",
    });
    expect((await world(t, id)).scene).toBeUndefined();
    expect(
      (await tasks(t, id, "dreaming")).map((task) => [task.outcome, task.error]),
    ).toEqual([
      ["failed", "The island outline has 3 vignettes instead of 4 or 5."],
      ["failed", "The island writer returned no JSON object."],
    ]);

    await t.mutation(api.worlds.retry, { id });
    const restarted = await world(t, id);
    expect(restarted).toMatchObject({ status: "queued" });
    expect(restarted.error).toBeUndefined();
    await settle(t);

    expect((await world(t, id)).status).toBe("ready");
    expect((await currentRun(t, id)).attempt).toBe(2);
  });

  test("fails at once without retrying when ANTHROPIC_API_KEY is missing", async () => {
    claude.script(
      "outline",
      undefined,
      new ProviderError("ANTHROPIC_API_KEY is not set on this Convex deployment.", 401),
    );
    const t = signedInTest();
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await settle(t);

    expect(await world(t, id)).toMatchObject({
      status: "failed",
      error: "Writing the scene failed: ANTHROPIC_API_KEY is not set on this Convex deployment.",
    });
    expect((await currentRun(t, id)).tasks).toHaveLength(1);
    expect(gmi.requests).toHaveLength(0);
  });

  test("a failed thumbnail still leaves a viewable world", async () => {
    gmi.script(
      "painting",
      { rejectSubmit: 503 },
      { error: "Upstream provider unavailable" },
      { error: "Upstream provider unavailable" },
    );
    const t = signedInTest();
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await settle(t);

    const ready = await world(t, id);
    expect(ready).toMatchObject({ status: "ready", title: OUTLINE.title });
    expect(ready.scene).toEqual(expect.any(String));
    expect(ready.imageUrl).toBeUndefined();
    expect(ready.error).toBeUndefined();
    expect((await tasks(t, id, "painting")).map((task) => task.outcome)).toEqual([
      "failed",
      "failed",
      "failed",
    ]);
    expect(await currentRun(t, id)).toMatchObject({
      step: "ready",
      durations: { dreaming: expect.any(Number), total: expect.any(Number) },
    });
  });

  test("the outline call gets the recalled cast ahead of the voice note", async () => {
    const cast = "<recurring_cast>\n- Mochi is a corgi in a red collar\n</recurring_cast>";
    vi.mocked(recallCast).mockResolvedValueOnce(cast);
    const t = signedInTest();
    await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await settle(t);

    const [outline, ...vignettes] = claude.calls;
    expect(recallCast).toHaveBeenCalledWith(TRANSCRIPT, await memorySpace(OWNER));
    expect(outline.user.startsWith(`${cast}\n\nVoice note:\n"""\n${TRANSCRIPT}\n"""\n\n`)).toBe(
      true,
    );
    expect(vignettes.some((call) => call.user.includes("recurring_cast"))).toBe(false);
  });

  test("without a recalled cast the outline call starts with the voice note", async () => {
    const t = signedInTest();
    await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await settle(t);

    expect(claude.calls[0].user.startsWith(`Voice note:\n"""\n${TRANSCRIPT}\n"""\n\n`)).toBe(
      true,
    );
  });
});

describe("with sculpting on", () => {
  beforeEach(() => {
    models.sculpt = true;
  });

  test("sculpts the thumbnail into a 3D model after painting", async () => {
    gmi.script("sculpting", { error: "Model generation failed" });
    const t = signedInTest();
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await settle(t);

    const ready = await world(t, id);
    expect(ready).toMatchObject({
      status: "ready",
      imageUrl: expect.any(String),
      modelUrl: expect.any(String),
      scene: expect.any(String),
    });
    const [paint] = gmi.submitted("painting");
    expect(gmi.submitted("sculpting").at(-1)!.input).toEqual({
      image_url: `${MEDIA_URL}/${paint.id}.jpg`,
      generate_type: "Normal",
      enable_pbr: false,
      face_count: 40_000,
    });
    expect(
      (await tasks(t, id, "sculpting")).map((task) => [task.outcome, task.error]),
    ).toEqual([
      ["failed", "Model generation failed"],
      ["ok", undefined],
    ]);
  });

  test("a failed 3D model still leaves a viewable island", async () => {
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

    const ready = await world(t, id);
    expect(ready).toMatchObject({ status: "ready", imageUrl: expect.any(String) });
    expect(ready.modelUrl).toBeUndefined();
    expect(ready.error).toBeUndefined();
    expect(gmi.rejectedSubmits).toHaveLength(models.sculpting.maxTries);
  });

  test("gives up on a 3D request that never finishes without paying for another", async () => {
    gmi.script("sculpting", { stuck: true });
    const t = signedInTest();
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await settle(t);

    expect((await world(t, id)).status).toBe("ready");
    expect(gmi.submitted("sculpting")).toHaveLength(1);
    expect(await tasks(t, id, "sculpting")).toEqual([
      expect.objectContaining({
        outcome: "timedOut",
        error: `${models.sculpting.id} took longer than ${models.sculpting.timeoutMs / 1000}s.`,
        startedAt: expect.any(Number),
      }),
    ]);
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
    gmi.script("painting", { stuck: true });
    const t = signedInTest();
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await runUntil(t, () => gmi.submitted("painting").length === 1);
    await cancelScheduledFunctions(t);
    gmi.submitted("painting")[0].outcome = {};

    vi.advanceTimersByTime(30_000);
    await t.mutation(internal.pipeline.watchdog, {});
    await settle(t);
    expect((await world(t, id)).status).toBe("painting");

    vi.advanceTimersByTime(90_000);
    await t.mutation(internal.pipeline.watchdog, {});
    await settle(t);
    expect((await world(t, id)).status).toBe("ready");
    expect(gmi.submitted("painting")).toHaveLength(1);
  });

  test("gives the island writer its whole timeout before calling it stalled", async () => {
    const t = signedInTest();
    const id = await insertDreamingRun(t);

    vi.advanceTimersByTime(3 * 60_000);
    await t.mutation(internal.pipeline.watchdog, {});
    expect((await tasks(t, id, "dreaming"))[0].outcome).toBeUndefined();

    vi.advanceTimersByTime(models.dreaming.timeoutMs);
    await t.mutation(internal.pipeline.watchdog, {});
    expect((await tasks(t, id, "dreaming"))[0]).toMatchObject({
      outcome: "failed",
      error: `${CLAUDE_MODEL} never answered.`,
    });
    await settle(t);
    expect((await world(t, id)).status).toBe("ready");
  });

  test("a run past its deadline keeps its island, or fails without one", async () => {
    gmi.script("painting", { stuck: true });
    const t = signedInTest();
    const painted = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await runUntil(t, () => gmi.submitted("painting").length === 1);
    await cancelScheduledFunctions(t);
    const dreamt = await insertDreamingRun(t);

    vi.advanceTimersByTime(31 * 60_000);
    await t.mutation(internal.pipeline.watchdog, {});

    const ready = await world(t, painted);
    expect(ready).toMatchObject({ status: "ready", scene: expect.any(String) });
    expect(ready.error).toBeUndefined();
    expect(await currentRun(t, painted)).toMatchObject({
      step: "ready",
      error: "Generation took too long.",
    });
    expect(await world(t, dreamt)).toMatchObject({
      status: "failed",
      error: "Generation took too long.",
    });
  });
});
