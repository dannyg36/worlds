import { v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
import { models } from "./generation/models";
import { download, ProviderError, type Check } from "./generation/provider";
import { generationStep, scene } from "./generation/tables";
import { memorySpace, recallCast } from "./memory";

type Step = Infer<typeof generationStep>;
type Run = Doc<"generationRuns">;
type Task = Run["tasks"][number];
type TaskRef = { runId: Id<"generationRuns">; step: Step; attempt: number };

const STEP_LABELS: Record<Step, string> = {
  dreaming: "Writing the scene",
  painting: "Painting the concept image",
  sculpting: "Sculpting the 3D model",
};
const ACTIVE_STEPS: Step[] = ["dreaming", "painting", "sculpting"];
const RETRY_DELAY_MS = 2_000;
const SLOT_WAIT_MS = 5_000;
const CLAIM_LEASE_MS = 2 * 60_000;
const STALL_MS = 90_000;
const RUN_DEADLINE_MS = 30 * 60_000;

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
  if (
    previousRun &&
    previousRun.step !== "ready" &&
    previousRun.step !== "failed"
  ) {
    // worlds.extend can replace a run that is still forming. Ending it frees
    // its 3D slot and keeps the watchdog from reviving it.
    await ctx.db.patch("generationRuns", previousRun._id, {
      step: "failed",
      error: "Replaced by a newer run.",
      finishedAt: now,
      touchedAt: now,
    });
  }
  const runId = await ctx.db.insert("generationRuns", {
    worldId,
    attempt: (previousRun?.attempt ?? 0) + 1,
    step: "dreaming",
    tasks: [],
    durations: {},
    startedAt: now,
    stepStartedAt: now,
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
    const model = models[step];
    const ref = { runId, step, attempt: task.attempt };
    try {
      const input =
        step === "dreaming"
          ? models.dreaming.input({
              transcript: task.transcript,
              cast: await recallCast(
                task.transcript,
                await memorySpace(task.ownerTokenIdentifier),
              ),
            })
          : task.input;
      const submission = await model.provider.submit(
        model.id,
        input,
        model.timeoutMs,
      );
      if (submission.state === "done") {
        await complete(ctx, ref, submission.output, {
          requestId: submission.requestId,
          completedAt: Date.now(),
        });
      } else if (
        !(await ctx.runMutation(internal.pipeline.recordSubmission, {
          ...ref,
          requestId: submission.requestId,
        }))
      ) {
        await cancelQuietly(step, submission.requestId);
      }
    } catch (error) {
      await ctx.runMutation(internal.pipeline.failTask, {
        ...ref,
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
    const model = models[step];
    const tries = run.tasks.filter((task) => task.step === step);
    if (
      tries.length >= model.maxTries ||
      tries.some((task) => !task.outcome)
    ) {
      return null;
    }
    const now = Date.now();
    if (
      model.maxInFlight !== undefined &&
      (await tasksInFlight(ctx, step)) >= model.maxInFlight
    ) {
      await ctx.db.patch("generationRuns", runId, { touchedAt: now });
      await ctx.scheduler.runAfter(SLOT_WAIT_MS, internal.pipeline.runStep, {
        runId,
        step,
      });
      return null;
    }
    const input = stepInput(step, world, run);
    const attempt = tries.length + 1;
    await ctx.db.patch("generationRuns", runId, {
      tasks: [
        ...run.tasks,
        {
          step,
          attempt,
          provider: model.provider.name,
          model: model.id,
          submittedAt: now,
        },
      ],
      touchedAt: now,
    });
    await ctx.db.patch("worlds", world._id, { status: step });
    return {
      attempt,
      input,
      transcript: world.transcript,
      ownerTokenIdentifier: world.ownerTokenIdentifier,
    };
  },
});

export const recordSubmission = internalMutation({
  args: requestArgs,
  handler: async (ctx, { requestId, ...ref }) => {
    const run = await ctx.db.get("generationRuns", ref.runId);
    const task = run && findTask(run, ref.step, ref.attempt);
    if (!run || !task || task.outcome || task.requestId) {
      return false;
    }
    await updateTask(ctx, run, task, { requestId });
    await ctx.scheduler.runAfter(
      models[ref.step].pollMs,
      internal.pipeline.poll,
      { ...ref, requestId },
    );
    return true;
  },
});

export const poll = internalAction({
  args: requestArgs,
  handler: async (ctx, request) => {
    const { requestId, ...ref } = request;
    const model = models[ref.step];
    let check: Check | undefined;
    try {
      check = await model.provider.check(model.id, requestId);
    } catch (error) {
      console.warn(
        `Checking ${model.id} request ${requestId} failed: ${errorMessage(error)}`,
      );
    }
    if (check?.state === "failed") {
      await ctx.runMutation(internal.pipeline.failTask, {
        ...ref,
        error: check.error,
        fatal: false,
      });
      return null;
    }
    if (check?.state !== "done") {
      const cancel = await ctx.runMutation(internal.pipeline.recordPoll, {
        ...request,
        running: check?.state === "running",
      });
      if (cancel) {
        await cancelQuietly(ref.step, requestId);
      }
      return null;
    }
    if (!(await ctx.runMutation(internal.pipeline.claimTask, request))) {
      return null;
    }
    try {
      await complete(ctx, ref, check.output, {
        requestId,
        inferenceMs: check.inferenceMs,
      });
    } catch (error) {
      await ctx.runMutation(internal.pipeline.failTask, {
        ...ref,
        error: errorMessage(error),
        fatal: isFatal(error),
      });
    }
    return null;
  },
});

export const recordPoll = internalMutation({
  args: { ...requestArgs, running: v.boolean() },
  handler: async (ctx, { running, ...request }) => {
    const pending = await pendingTask(ctx, request);
    if (!pending || pending.task.completedAt) {
      return false;
    }
    const { run, task } = pending;
    const model = models[request.step];
    const now = Date.now();
    if (now - task.submittedAt > model.timeoutMs) {
      const cancellable = model.provider.cancel !== undefined;
      await failTaskIn(
        ctx,
        run,
        task,
        `${model.id} took longer than ${model.timeoutMs / 1000}s.`,
        { outcome: "timedOut", fatal: !cancellable },
      );
      return cancellable;
    }
    await updateTask(
      ctx,
      run,
      task,
      running && !task.startedAt ? { startedAt: now } : {},
    );
    await ctx.scheduler.runAfter(model.pollMs, internal.pipeline.poll, request);
    return false;
  },
});

export const claimTask = internalMutation({
  args: requestArgs,
  handler: async (ctx, request) => {
    const pending = await pendingTask(ctx, request);
    if (!pending) {
      return false;
    }
    const { run, task } = pending;
    const now = Date.now();
    if (task.completedAt && now - task.completedAt < CLAIM_LEASE_MS) {
      return false;
    }
    await updateTask(ctx, run, task, { completedAt: now });
    return true;
  },
});

export const completeTask = internalMutation({
  args: {
    runId: v.id("generationRuns"),
    attempt: v.number(),
    requestId: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    inferenceMs: v.optional(v.number()),
    output: stepOutput,
  },
  handler: async (ctx, { runId, attempt, requestId, completedAt, inferenceMs, output }) => {
    const run = await ctx.db.get("generationRuns", runId);
    const task = run && findTask(run, output.step, attempt);
    const world = run && (await ctx.db.get("worlds", run.worldId));
    if (
      !run ||
      !task ||
      !world ||
      task.outcome ||
      (task.requestId !== undefined && task.requestId !== requestId) ||
      run.step !== output.step ||
      world.runId !== runId
    ) {
      if ("storageId" in output) {
        await ctx.storage.delete(output.storageId);
      }
      return false;
    }
    const now = Date.now();
    const durations = { ...run.durations, [output.step]: now - run.stepStartedAt };
    const done = {
      outcome: "ok" as const,
      requestId: task.requestId ?? requestId,
      completedAt: task.completedAt ?? completedAt,
      finishedAt: now,
      inferenceMs,
    };
    switch (output.step) {
      case "dreaming":
        await updateTask(ctx, run, task, done, {
          step: "painting",
          stepStartedAt: now,
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
          stepStartedAt: now,
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
        await ctx.scheduler.runAfter(
          0,
          internal.notifications.worldStatusChanged,
          { worldId: world._id, status: "ready", title: world.title },
        );
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
  } else if (!task.requestId) {
    await failTaskIn(ctx, run, task, `${task.model} never answered.`);
  } else if (!task.completedAt || now - task.completedAt > CLAIM_LEASE_MS) {
    await ctx.scheduler.runAfter(0, internal.pipeline.poll, {
      runId: run._id,
      step,
      attempt: task.attempt,
      requestId: task.requestId,
    });
  }
}

async function tasksInFlight(ctx: MutationCtx, step: Step) {
  const runs = await ctx.db
    .query("generationRuns")
    .withIndex("by_step", (q) => q.eq("step", step))
    .take(100);
  return runs.filter((run) =>
    run.tasks.some((task) => task.step === step && !task.outcome),
  ).length;
}

function stepInput(step: Step, world: Doc<"worlds">, run: Run) {
  switch (step) {
    case "dreaming":
      return models.dreaming.input({ transcript: world.transcript, cast: "" });
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

async function complete(
  ctx: ActionCtx,
  { runId, step, attempt }: TaskRef,
  result: unknown,
  details: { requestId?: string; completedAt?: number; inferenceMs?: number },
) {
  await ctx.runMutation(internal.pipeline.completeTask, {
    runId,
    attempt,
    ...details,
    output: await storeOutput(ctx, step, result),
  });
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
      const storageId = await ctx.storage.store(await download(imageUrl));
      return { step, imageUrl, storageId };
    }
    case "sculpting": {
      const modelUrl = models.sculpting.output(result);
      const storageId = await ctx.storage.store(await download(modelUrl));
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
    await ctx.scheduler.runAfter(0, internal.notifications.worldStatusChanged, {
      worldId: world._id,
      status: "failed",
    });
  }
}

async function pendingTask(
  ctx: MutationCtx,
  request: TaskRef & { requestId: string },
) {
  const run = await ctx.db.get("generationRuns", request.runId);
  const task = run && findTask(run, request.step, request.attempt);
  if (!run || !task || task.outcome || task.requestId !== request.requestId) {
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

async function cancelQuietly(step: Step, requestId: string) {
  const { provider, id } = models[step];
  try {
    await provider.cancel?.(id, requestId);
  } catch (error) {
    console.warn(`Cancelling ${id} request ${requestId} failed: ${errorMessage(error)}`);
  }
}

function isFatal(error: unknown) {
  return (
    error instanceof ProviderError &&
    (error.status === 401 || error.status === 403)
  );
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
