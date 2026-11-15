import { v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  env,
  internalAction,
  internalMutation,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
import * as fal from "./generation/fal";
import { models } from "./generation/models";
import { generationStep, scene } from "./generation/tables";

type Step = Infer<typeof generationStep>;
type Run = Doc<"generationRuns">;
type Task = Run["tasks"][number];

const STEP_LABELS: Record<Step, string> = {
  dreaming: "Writing the scene",
  painting: "Painting the concept image",
  sculpting: "Sculpting the 3D model",
};
const ACTIVE_STEPS: Step[] = ["dreaming", "painting", "sculpting"];
const RETRY_DELAY_MS = 1_000;
const CLAIM_LEASE_MS = 2 * 60_000;
const STALL_MS = 60_000;
const RUN_DEADLINE_MS = 15 * 60_000;

const taskArgs = {
  runId: v.id("generationRuns"),
  step: generationStep,
  attempt: v.number(),
};
const requestArgs = { ...taskArgs, requestId: v.string() };

const stepOutput = v.union(
  v.object({ step: v.literal("dreaming"), scene }),
  v.object({
    step: v.literal("painting"),
    imageUrl: v.string(),
    storageId: v.id("_storage"),
  }),
  v.object({ step: v.literal("sculpting"), storageId: v.id("_storage") }),
);

export async function startGeneration(
  ctx: MutationCtx,
  worldId: Id<"worlds">,
) {
  const world = await ctx.db.get("worlds", worldId);
  if (!world) {
    throw new Error("World not found.");
  }
  const previousRun = world.runId
    ? await ctx.db.get("generationRuns", world.runId)
    : null;
  for (const storageId of [world.imageStorageId, world.modelStorageId]) {
    if (storageId) {
      await ctx.storage.delete(storageId);
    }
  }
  const now = Date.now();
  const runId = await ctx.db.insert("generationRuns", {
    worldId,
    attempt: (previousRun?.attempt ?? 0) + 1,
    step: "dreaming",
    tasks: [],
    durations: {},
    startedAt: now,
    touchedAt: now,
  });
  await ctx.db.patch("worlds", worldId, {
    status: "queued",
    runId,
    title: undefined,
    caption: undefined,
    palette: undefined,
    imageStorageId: undefined,
    modelStorageId: undefined,
    error: undefined,
  });
  await ctx.scheduler.runAfter(0, internal.pipeline.runStep, {
    runId,
    step: "dreaming",
  });
}

export const runStep = internalAction({
  args: { runId: v.id("generationRuns"), step: generationStep },
  handler: async (ctx, { runId, step }) => {
    const task = await ctx.runMutation(internal.pipeline.beginTask, {
      runId,
      step,
    });
    if (!task) {
      return null;
    }
    try {
      const request = await fal.submit(
        falKey(),
        models[step].endpoint,
        task.input,
        {
          webhookUrl: webhookUrl(runId),
          startTimeoutMs: models[step].timeoutMs,
        },
      );
      const recorded = await ctx.runMutation(
        internal.pipeline.recordSubmission,
        { runId, step, attempt: task.attempt, request },
      );
      if (!recorded) {
        await cancelQuietly(request.cancelUrl);
      }
    } catch (error) {
      await ctx.runMutation(internal.pipeline.failTask, {
        runId,
        step,
        attempt: task.attempt,
        error: errorMessage(error),
        fatal: isFatal(error),
      });
    }
    return null;
  },
});

export const beginTask = internalMutation({
  args: { runId: v.id("generationRuns"), step: generationStep },
  handler: async (ctx, { runId, step }) => {
    const run = await ctx.db.get("generationRuns", runId);
    const world = run && (await ctx.db.get("worlds", run.worldId));
    if (!run || !world || run.step !== step || world.runId !== runId) {
      return null;
    }
    const tries = run.tasks.filter((task) => task.step === step);
    if (
      tries.length >= models[step].maxTries ||
      tries.some((task) => !task.outcome)
    ) {
      return null;
    }
    const input = stepInput(step, world, run);
    const now = Date.now();
    const attempt = tries.length + 1;
    await ctx.db.patch("generationRuns", runId, {
      tasks: [
        ...run.tasks,
        { step, attempt, model: models[step].endpoint, submittedAt: now },
      ],
      touchedAt: now,
    });
    await ctx.db.patch("worlds", world._id, { status: step });
    return { attempt, input };
  },
});

export const recordSubmission = internalMutation({
  args: {
    ...taskArgs,
    request: v.object({
      requestId: v.string(),
      statusUrl: v.string(),
      responseUrl: v.string(),
      cancelUrl: v.string(),
    }),
  },
  handler: async (ctx, { request, ...args }) => {
    const run = await ctx.db.get("generationRuns", args.runId);
    const task = run && findTask(run, args.step, args.attempt);
    if (!run || !task || task.outcome || task.request) {
      return false;
    }
    await updateTask(ctx, run, task, { request });
    await ctx.scheduler.runAfter(
      models[args.step].firstPollMs,
      internal.pipeline.poll,
      { ...args, requestId: request.requestId, statusUrl: request.statusUrl },
    );
    return true;
  },
});

export const poll = internalAction({
  args: { ...requestArgs, statusUrl: v.string() },
  handler: async (ctx, args) => {
    let status: fal.RequestStatus | undefined;
    try {
      status = await fal.status(falKey(), args.statusUrl);
    } catch (error) {
      console.warn(
        `Checking fal request ${args.requestId} failed: ${errorMessage(error)}`,
      );
    }
    const cancelUrl = await ctx.runMutation(internal.pipeline.recordPoll, {
      ...args,
      state: status?.state,
      error: status?.error,
      inferenceMs: status?.inferenceMs,
    });
    if (cancelUrl) {
      await cancelQuietly(cancelUrl);
    }
    return null;
  },
});

export const recordPoll = internalMutation({
  args: {
    ...requestArgs,
    statusUrl: v.string(),
    state: v.optional(
      v.union(
        v.literal("IN_QUEUE"),
        v.literal("IN_PROGRESS"),
        v.literal("COMPLETED"),
      ),
    ),
    error: v.optional(v.string()),
    inferenceMs: v.optional(v.number()),
  },
  handler: async (ctx, { statusUrl, state, error, inferenceMs, ...request }) => {
    const pending = await pendingTask(ctx, request);
    if (!pending || pending.task.completedAt) {
      return null;
    }
    const { run, task } = pending;
    const model = models[request.step];
    const now = Date.now();
    if (state === "COMPLETED") {
      await updateTask(ctx, run, task, { inferenceMs });
      await ctx.scheduler.runAfter(0, internal.pipeline.finish, {
        ...request,
        error,
      });
      return null;
    }
    if (now - task.submittedAt > model.timeoutMs) {
      await failTaskIn(
        ctx,
        run,
        task,
        `fal took longer than ${model.timeoutMs / 1000}s.`,
        { outcome: "timedOut" },
      );
      return task.request?.cancelUrl ?? null;
    }
    await updateTask(
      ctx,
      run,
      task,
      state === "IN_PROGRESS" && !task.startedAt ? { startedAt: now } : {},
    );
    await ctx.scheduler.runAfter(model.pollMs, internal.pipeline.poll, {
      ...request,
      statusUrl,
    });
    return null;
  },
});

export const receiveWebhook = internalMutation({
  args: {
    runId: v.string(),
    requestId: v.string(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { requestId, error, ...args }) => {
    const runId = ctx.db.normalizeId("generationRuns", args.runId);
    const run = runId && (await ctx.db.get("generationRuns", runId));
    const task = run?.tasks.find(
      (candidate) => candidate.request?.requestId === requestId,
    );
    if (!run || !task || task.outcome || task.completedAt) {
      return false;
    }
    await ctx.scheduler.runAfter(0, internal.pipeline.finish, {
      runId: run._id,
      step: task.step,
      attempt: task.attempt,
      requestId,
      error,
    });
    return true;
  },
});

export const finish = internalAction({
  args: { ...requestArgs, error: v.optional(v.string()) },
  handler: async (ctx, { error, ...request }) => {
    const claim = await ctx.runMutation(internal.pipeline.claimTask, request);
    if (!claim) {
      return null;
    }
    try {
      if (error) {
        throw new fal.FalError(error);
      }
      const key = falKey();
      const [result, inferenceMs] = await Promise.all([
        fal.result(key, claim.responseUrl),
        claim.inferenceMs ??
          fal.status(key, claim.statusUrl).then(
            (status) => status.inferenceMs,
            () => undefined,
          ),
      ]);
      await ctx.runMutation(internal.pipeline.completeTask, {
        runId: request.runId,
        attempt: request.attempt,
        requestId: request.requestId,
        inferenceMs,
        output: await storeOutput(ctx, request.step, result),
      });
    } catch (failure) {
      await ctx.runMutation(internal.pipeline.failTask, {
        runId: request.runId,
        step: request.step,
        attempt: request.attempt,
        error: errorMessage(failure),
        fatal: isFatal(failure),
      });
    }
    return null;
  },
});

export const claimTask = internalMutation({
  args: requestArgs,
  handler: async (ctx, request) => {
    const pending = await pendingTask(ctx, request);
    if (!pending?.task.request) {
      return null;
    }
    const { run, task } = pending;
    const now = Date.now();
    if (task.completedAt && now - task.completedAt < CLAIM_LEASE_MS) {
      return null;
    }
    await updateTask(ctx, run, task, { completedAt: now });
    return {
      responseUrl: pending.task.request.responseUrl,
      statusUrl: pending.task.request.statusUrl,
      inferenceMs: task.inferenceMs,
    };
  },
});

export const completeTask = internalMutation({
  args: {
    runId: v.id("generationRuns"),
    attempt: v.number(),
    requestId: v.string(),
    inferenceMs: v.optional(v.number()),
    output: stepOutput,
  },
  handler: async (ctx, { runId, attempt, requestId, inferenceMs, output }) => {
    const pending = await pendingTask(ctx, {
      runId,
      step: output.step,
      attempt,
      requestId,
    });
    const world =
      pending && (await ctx.db.get("worlds", pending.run.worldId));
    if (
      !pending ||
      !world ||
      pending.run.step !== output.step ||
      world.runId !== runId
    ) {
      if ("storageId" in output) {
        await ctx.storage.delete(output.storageId);
      }
      return false;
    }
    const { run, task } = pending;
    const now = Date.now();
    const stepStartedAt = (
      run.tasks.find((candidate) => candidate.step === output.step) ?? task
    ).submittedAt;
    const durations = { ...run.durations, [output.step]: now - stepStartedAt };
    const done = {
      outcome: "ok" as const,
      finishedAt: now,
      inferenceMs: inferenceMs ?? task.inferenceMs,
    };
    switch (output.step) {
      case "dreaming":
        await updateTask(ctx, run, task, done, {
          step: "painting",
          durations,
          scene: output.scene,
        });
        await ctx.db.patch("worlds", world._id, {
          status: "painting",
          title: output.scene.title,
          caption: output.scene.caption,
          palette: output.scene.palette,
        });
        await ctx.scheduler.runAfter(0, internal.pipeline.runStep, {
          runId,
          step: "painting",
        });
        break;
      case "painting":
        await updateTask(ctx, run, task, done, {
          step: "sculpting",
          durations,
          imageSourceUrl: output.imageUrl,
        });
        await ctx.db.patch("worlds", world._id, {
          status: "sculpting",
          imageStorageId: output.storageId,
        });
        await ctx.scheduler.runAfter(0, internal.pipeline.runStep, {
          runId,
          step: "sculpting",
        });
        break;
      case "sculpting":
        await updateTask(ctx, run, task, done, {
          step: "ready",
          durations: { ...durations, total: now - run.startedAt },
          finishedAt: now,
        });
        await ctx.db.patch("worlds", world._id, {
          status: "ready",
          modelStorageId: output.storageId,
        });
        break;
    }
    return true;
  },
});

export const failTask = internalMutation({
  args: { ...taskArgs, error: v.string(), fatal: v.boolean() },
  handler: async (ctx, { runId, step, attempt, error, fatal }) => {
    const run = await ctx.db.get("generationRuns", runId);
    const task = run && findTask(run, step, attempt);
    if (!run || !task || task.outcome) {
      return null;
    }
    await failTaskIn(ctx, run, task, error, { fatal });
    return null;
  },
});

export const watchdog = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    for (const step of ACTIVE_STEPS) {
      const runs = await ctx.db
        .query("generationRuns")
        .withIndex("by_step", (q) => q.eq("step", step))
        .take(100);
      for (const run of runs) {
        if (now - run.startedAt > RUN_DEADLINE_MS) {
          await failRun(ctx, run, "Generation took too long.");
        } else if (now - run.touchedAt > STALL_MS) {
          await revive(ctx, run, step, now);
        }
      }
    }
    return null;
  },
});

async function revive(ctx: MutationCtx, run: Run, step: Step, now: number) {
  const task = run.tasks.find(
    (candidate) => candidate.step === step && !candidate.outcome,
  );
  if (!task) {
    await ctx.scheduler.runAfter(0, internal.pipeline.runStep, {
      runId: run._id,
      step,
    });
  } else if (!task.request) {
    await failTaskIn(ctx, run, task, "fal never confirmed the request.");
  } else if (!task.completedAt) {
    await ctx.scheduler.runAfter(0, internal.pipeline.poll, {
      runId: run._id,
      step,
      attempt: task.attempt,
      requestId: task.request.requestId,
      statusUrl: task.request.statusUrl,
    });
  } else if (now - task.completedAt > CLAIM_LEASE_MS) {
    await ctx.scheduler.runAfter(0, internal.pipeline.finish, {
      runId: run._id,
      step,
      attempt: task.attempt,
      requestId: task.request.requestId,
    });
  }
}

function stepInput(step: Step, world: Doc<"worlds">, run: Run) {
  switch (step) {
    case "dreaming":
      return models.dreaming.input(world.transcript);
    case "painting":
      if (!run.scene) {
        throw new Error("Painting needs a scene.");
      }
      return models.painting.input(run.scene);
    case "sculpting":
      if (!run.imageSourceUrl) {
        throw new Error("Sculpting needs a concept image.");
      }
      return models.sculpting.input(run.imageSourceUrl);
  }
}

async function storeOutput(
  ctx: ActionCtx,
  step: Step,
  result: unknown,
): Promise<Infer<typeof stepOutput>> {
  switch (step) {
    case "dreaming":
      return { step, scene: models.dreaming.output(result) };
    case "painting": {
      const imageUrl = models.painting.output(result);
      const storageId = await ctx.storage.store(await fal.download(imageUrl));
      return { step, imageUrl, storageId };
    }
    case "sculpting": {
      const modelUrl = models.sculpting.output(result);
      const storageId = await ctx.storage.store(await fal.download(modelUrl));
      return { step, storageId };
    }
  }
}

async function failTaskIn(
  ctx: MutationCtx,
  run: Run,
  task: Task,
  error: string,
  {
    fatal = false,
    outcome = "failed",
  }: { fatal?: boolean; outcome?: "failed" | "timedOut" } = {},
) {
  const now = Date.now();
  const tasks = run.tasks.map((candidate) =>
    candidate === task
      ? { ...task, outcome, error, finishedAt: now }
      : candidate,
  );
  const tries = tasks.filter((candidate) => candidate.step === task.step);
  if (run.step !== task.step) {
    await ctx.db.patch("generationRuns", run._id, { tasks, touchedAt: now });
  } else if (!fatal && tries.length < models[task.step].maxTries) {
    await ctx.db.patch("generationRuns", run._id, { tasks, touchedAt: now });
    await ctx.scheduler.runAfter(
      RETRY_DELAY_MS * tries.length,
      internal.pipeline.runStep,
      { runId: run._id, step: task.step },
    );
  } else {
    await failRun(
      ctx,
      { ...run, tasks },
      `${STEP_LABELS[task.step]} failed: ${error}`,
    );
  }
}

async function failRun(ctx: MutationCtx, run: Run, error: string) {
  const now = Date.now();
  await ctx.db.patch("generationRuns", run._id, {
    tasks: run.tasks,
    step: "failed",
    error,
    finishedAt: now,
    touchedAt: now,
  });
  const world = await ctx.db.get("worlds", run.worldId);
  if (world?.runId === run._id) {
    await ctx.db.patch("worlds", world._id, { status: "failed", error });
  }
}

async function pendingTask(
  ctx: MutationCtx,
  request: { runId: Id<"generationRuns">; step: Step; attempt: number; requestId: string },
) {
  const run = await ctx.db.get("generationRuns", request.runId);
  const task = run && findTask(run, request.step, request.attempt);
  if (!run || !task || task.outcome || task.request?.requestId !== request.requestId) {
    return null;
  }
  return { run, task };
}

function findTask(run: Run, step: Step, attempt: number) {
  return run.tasks.find(
    (task) => task.step === step && task.attempt === attempt,
  );
}

async function updateTask(
  ctx: MutationCtx,
  run: Run,
  task: Task,
  changes: Partial<Task>,
  runChanges: Partial<Omit<Run, "_id" | "_creationTime" | "tasks">> = {},
) {
  await ctx.db.patch("generationRuns", run._id, {
    ...runChanges,
    tasks: run.tasks.map((candidate) =>
      candidate === task ? { ...task, ...changes } : candidate,
    ),
    touchedAt: Date.now(),
  });
}

function webhookUrl(runId: Id<"generationRuns">) {
  const base = env.FAL_WEBHOOK_BASE_URL ?? env.CONVEX_SITE_URL;
  return base?.startsWith("https://")
    ? `${base.replace(/\/$/, "")}/fal/webhook?runId=${runId}`
    : undefined;
}

function falKey() {
  if (!env.FAL_KEY) {
    throw new fal.FalError("FAL_KEY is not set on this Convex deployment.", 401);
  }
  return env.FAL_KEY;
}

async function cancelQuietly(cancelUrl: string) {
  try {
    await fal.cancel(falKey(), cancelUrl);
  } catch (error) {
    console.warn(`Cancelling ${cancelUrl} failed: ${errorMessage(error)}`);
  }
}

function isFatal(error: unknown) {
  return (
    error instanceof fal.FalError &&
    (error.status === 401 || error.status === 403)
  );
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
