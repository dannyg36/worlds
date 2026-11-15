/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  defaultResult,
  installFakeFal,
  MEDIA_URL,
  SCENE,
  webhookSigner,
  type FakeFal,
} from "./fakeFal.testing";
import { models } from "./generation/models";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const TRANSCRIPT = "Got to the office at nine and ate cold pizza on the floor.";

let fal: FakeFal;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("FAL_KEY", "test-key");
  fal = installFakeFal();
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
    vi.runOnlyPendingTimers();
    await t.finishInProgressScheduledFunctions();
  }
  throw new Error("The pipeline never reached the expected state.");
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
    const t = convexTest(schema, modules);
    const id = await t.mutation(api.worlds.add, { transcript: `  ${TRANSCRIPT}  ` });

    const statuses = [(await world(t, id)).status];
    await runUntil(t, async () => {
      const { status } = await world(t, id);
      if (status !== statuses.at(-1)) {
        statuses.push(status);
      }
      return status === "ready";
    });

    expect(statuses).toEqual(["queued", "dreaming", "painting", "sculpting", "ready"]);
    const ready = await world(t, id);
    expect(ready).toMatchObject({
      transcript: TRANSCRIPT,
      title: SCENE.title,
      caption: SCENE.caption,
      palette: ["#ffb347", "#2e4057", "#f6f1e9", "#e94f37"],
      imageUrl: expect.any(String),
      modelUrl: expect.any(String),
    });
    expect(ready.error).toBeUndefined();

    const [dream] = fal.submitted("dreaming");
    const [paint] = fal.submitted("painting");
    const [sculpt] = fal.submitted("sculpting");
    expect(dream.input.prompt).toContain(TRANSCRIPT);
    expect(paint.input.prompt).toContain(SCENE.imagePrompt);
    expect(JSON.stringify(sculpt.input)).toContain(`${MEDIA_URL}/${paint.id}.jpg`);
    expect(fal.requests.every((request) => request.webhookUrl === null)).toBe(true);

    const run = await currentRun(t, id);
    expect(run).toMatchObject({
      step: "ready",
      attempt: 1,
      scene: { ...SCENE, palette: ready.palette },
    });
    expect(
      run.tasks.map((task) => [task.step, task.outcome, task.request?.requestId]),
    ).toEqual([
      ["dreaming", "ok", dream.id],
      ["painting", "ok", paint.id],
      ["sculpting", "ok", sculpt.id],
    ]);
    expect(run.tasks.every((task) => task.inferenceMs === 1250)).toBe(true);
    expect(run.durations).toEqual({
      dreaming: expect.any(Number),
      painting: expect.any(Number),
      sculpting: expect.any(Number),
      total: expect.any(Number),
    });
    expect((await storedFiles(t)).sort()).toEqual([
      `/files/${paint.id}.jpg`,
      `/files/${sculpt.id}.glb`,
    ]);
  });

  test("retries a scene writer reply that isn't JSON", async () => {
    fal.script("dreaming", { result: { output: "Sorry, I can't help with that." } });
    const t = convexTest(schema, modules);
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await settle(t);

    expect((await world(t, id)).status).toBe("ready");
    const dreams = (await currentRun(t, id)).tasks.filter(
      (task) => task.step === "dreaming",
    );
    expect(dreams.map((task) => task.outcome)).toEqual(["failed", "ok"]);
    expect(dreams[0].error).toBe("The scene writer returned no JSON object.");
  });

  test("retries a submission fal rejects", async () => {
    fal.script("painting", { rejectSubmit: 503 });
    const t = convexTest(schema, modules);
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await settle(t);

    expect((await world(t, id)).status).toBe("ready");
    expect(fal.rejectedSubmits).toEqual(["painting"]);
    const paints = (await currentRun(t, id)).tasks.filter(
      (task) => task.step === "painting",
    );
    expect(paints.map((task) => [task.outcome, task.request === undefined])).toEqual([
      ["failed", true],
      ["ok", false],
    ]);
  });

  test("cancels and replaces a request that never finishes", async () => {
    fal.script("sculpting", { stuck: true });
    const t = convexTest(schema, modules);
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await settle(t);

    expect((await world(t, id)).status).toBe("ready");
    const [stuck, replacement] = fal.submitted("sculpting");
    expect(stuck.cancelled).toBe(true);
    expect(replacement.cancelled).toBe(false);
    const sculpts = (await currentRun(t, id)).tasks.filter(
      (task) => task.step === "sculpting",
    );
    expect(sculpts[0]).toMatchObject({
      outcome: "timedOut",
      startedAt: expect.any(Number),
      error: `fal took longer than ${models.sculpting.timeoutMs / 1000}s.`,
    });
    expect(sculpts[1].outcome).toBe("ok");
  });

  test("fails the world once every sculpting attempt fails, and retry regenerates it", async () => {
    fal.script(
      "sculpting",
      ...Array.from({ length: models.sculpting.maxTries }, () => ({
        error: "CUDA out of memory",
      })),
    );
    const t = convexTest(schema, modules);
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await settle(t);

    const failed = await world(t, id);
    expect(failed).toMatchObject({
      status: "failed",
      error: "Sculpting the 3D model failed: CUDA out of memory",
      title: SCENE.title,
      imageUrl: expect.any(String),
    });
    expect(failed.modelUrl).toBeUndefined();
    expect(fal.submitted("sculpting")).toHaveLength(models.sculpting.maxTries);

    await t.mutation(api.worlds.retry, { id });
    const restarted = await world(t, id);
    expect(restarted.status).toBe("queued");
    expect(restarted.title).toBeUndefined();
    expect(restarted.imageUrl).toBeUndefined();
    expect(restarted.error).toBeUndefined();
    await settle(t);

    expect((await world(t, id)).status).toBe("ready");
    expect((await currentRun(t, id)).attempt).toBe(2);
    expect(fal.submitted("dreaming")).toHaveLength(2);
    const [, paint] = fal.submitted("painting");
    const sculpt = fal.submitted("sculpting").at(-1)!;
    expect((await storedFiles(t)).sort()).toEqual([
      `/files/${paint.id}.jpg`,
      `/files/${sculpt.id}.glb`,
    ]);
  });

  test("fails at once without retrying when FAL_KEY is missing", async () => {
    vi.stubEnv("FAL_KEY", "");
    const t = convexTest(schema, modules);
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await settle(t);

    expect(await world(t, id)).toMatchObject({
      status: "failed",
      error: "Writing the scene failed: FAL_KEY is not set on this Convex deployment.",
    });
    expect((await currentRun(t, id)).tasks).toHaveLength(1);
    expect(fal.requests).toHaveLength(0);
  });
});

describe("fal webhooks", () => {
  const BASE_URL = "https://worlds.example";
  let signer: Awaited<ReturnType<typeof webhookSigner>>;

  beforeAll(async () => {
    signer = await webhookSigner();
  });

  async function stuckAt(step: "dreaming" | "painting" | "sculpting") {
    fal.setJwks([signer.jwk]);
    vi.stubEnv("FAL_WEBHOOK_BASE_URL", BASE_URL);
    fal.script(step, { stuck: true });
    const t = convexTest(schema, modules);
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await runUntil(t, () => fal.submitted(step).length === 1);
    const request = fal.submitted(step)[0];
    const webhook = new URL(request.webhookUrl!);
    return { t, id, request, path: webhook.pathname + webhook.search };
  }

  test("finishes a step once from duplicate signed deliveries and a poll", async () => {
    const { t, id, request, path } = await stuckAt("painting");
    const run = await currentRun(t, id);
    expect(request.webhookUrl).toBe(`${BASE_URL}/fal/webhook?runId=${run._id}`);

    request.outcome = {};
    const delivery = await signer.sign({
      request_id: request.id,
      gateway_request_id: request.id,
      status: "OK",
      payload: defaultResult(request),
    });
    const responses = await Promise.all([
      t.fetch(path, delivery),
      t.fetch(path, delivery),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    await settle(t);

    expect((await world(t, id)).status).toBe("ready");
    expect(fal.submitted("painting")).toHaveLength(1);
    expect(request.resultFetches).toBe(1);
    expect(fal.submitted("sculpting")).toHaveLength(1);
    const paints = (await currentRun(t, id)).tasks.filter(
      (task) => task.step === "painting",
    );
    expect(paints).toEqual([expect.objectContaining({ outcome: "ok" })]);
    expect(await storedFiles(t)).toHaveLength(2);

    const late = await t.fetch(path, delivery);
    expect(late.status).toBe(200);
    await settle(t);
    expect(await storedFiles(t)).toHaveLength(2);
  });

  test("an ERROR delivery fails the attempt and the step is retried", async () => {
    const { t, id, request, path } = await stuckAt("dreaming");
    const response = await t.fetch(
      path,
      await signer.sign({
        request_id: request.id,
        status: "ERROR",
        error: "Invalid status code: 422",
        payload: { detail: [{ msg: "prompt is too long" }] },
      }),
    );
    expect(response.status).toBe(200);
    await settle(t);

    expect((await world(t, id)).status).toBe("ready");
    const dreams = (await currentRun(t, id)).tasks.filter(
      (task) => task.step === "dreaming",
    );
    expect(dreams.map((task) => [task.outcome, task.error])).toEqual([
      ["failed", "Invalid status code: 422: prompt is too long"],
      ["ok", undefined],
    ]);
  });

  test("rejects deliveries that fail verification and ignores unknown requests", async () => {
    const { t, id, request, path } = await stuckAt("painting");
    const delivery = {
      request_id: request.id,
      status: "OK",
      payload: defaultResult(request),
    };
    const signed = await signer.sign(delivery);
    const stranger = await webhookSigner();

    const rejected = await Promise.all([
      t.fetch(path, { method: "POST", body: JSON.stringify(delivery) }),
      t.fetch(path, { ...signed, body: JSON.stringify({ ...delivery, status: "ERROR" }) }),
      t.fetch(
        path,
        await signer.sign(delivery, { timestamp: Math.floor(Date.now() / 1000) - 600 }),
      ),
      t.fetch(path, await stranger.sign(delivery)),
    ]);
    expect(rejected.map((response) => response.status)).toEqual([401, 401, 401, 401]);

    const ignored = await Promise.all([
      t.fetch(path, await signer.sign({ ...delivery, request_id: "someone-else" })),
      t.fetch("/fal/webhook?runId=not-a-run", signed),
    ]);
    expect(ignored.map((response) => response.status)).toEqual([200, 200]);

    await t.finishInProgressScheduledFunctions();
    const paint = (await currentRun(t, id)).tasks.find(
      (task) => task.step === "painting",
    );
    expect(paint?.outcome).toBeUndefined();
    expect(paint?.completedAt).toBeUndefined();
  });
});

describe("watchdog", () => {
  test("revives a run whose poll chain was lost", async () => {
    fal.script("sculpting", { stuck: true });
    const t = convexTest(schema, modules);
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await runUntil(t, () => fal.submitted("sculpting").length === 1);
    await cancelScheduledFunctions(t);
    fal.submitted("sculpting")[0].outcome = {};

    vi.advanceTimersByTime(30_000);
    await t.mutation(internal.pipeline.watchdog, {});
    await settle(t);
    expect((await world(t, id)).status).toBe("sculpting");

    vi.advanceTimersByTime(60_000);
    await t.mutation(internal.pipeline.watchdog, {});
    await settle(t);
    expect((await world(t, id)).status).toBe("ready");
    expect(fal.submitted("sculpting")).toHaveLength(1);
  });

  test("fails a run that passes its deadline", async () => {
    fal.script("sculpting", { stuck: true });
    const t = convexTest(schema, modules);
    const id = await t.mutation(api.worlds.add, { transcript: TRANSCRIPT });
    await runUntil(t, () => fal.submitted("sculpting").length === 1);
    await cancelScheduledFunctions(t);

    vi.advanceTimersByTime(16 * 60_000);
    await t.mutation(internal.pipeline.watchdog, {});

    expect(await world(t, id)).toMatchObject({
      status: "failed",
      error: "Generation took too long.",
    });
  });
});
