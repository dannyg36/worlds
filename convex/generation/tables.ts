import { defineTable } from "convex/server";
import { v } from "convex/values";

export const generationStep = v.union(
  v.literal("dreaming"),
  v.literal("painting"),
  v.literal("sculpting"),
);

export const scene = v.object({
  title: v.string(),
  caption: v.string(),
  palette: v.array(v.string()),
  imagePrompt: v.string(),
});

export const worldGenerationFields = {
  status: v.optional(
    v.union(
      v.literal("queued"),
      generationStep,
      v.literal("ready"),
      v.literal("failed"),
    ),
  ),
  title: v.optional(v.string()),
  caption: v.optional(v.string()),
  palette: v.optional(v.array(v.string())),
  /** The island spec (spike/procedural/ISLAND.md) as a JSON string. */
  scene: v.optional(v.string()),
  imageStorageId: v.optional(v.id("_storage")),
  modelStorageId: v.optional(v.id("_storage")),
  error: v.optional(v.string()),
  runId: v.optional(v.id("generationRuns")),
};

export const generationRuns = defineTable({
  worldId: v.id("worlds"),
  attempt: v.number(),
  step: v.union(generationStep, v.literal("ready"), v.literal("failed")),
  tasks: v.array(
    v.object({
      step: generationStep,
      attempt: v.number(),
      provider: v.string(),
      model: v.string(),
      requestId: v.optional(v.string()),
      submittedAt: v.number(),
      startedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
      finishedAt: v.optional(v.number()),
      inferenceMs: v.optional(v.number()),
      outcome: v.optional(
        v.union(v.literal("ok"), v.literal("failed"), v.literal("timedOut")),
      ),
      error: v.optional(v.string()),
    }),
  ),
  scene: v.optional(scene),
  imageSourceUrl: v.optional(v.string()),
  durations: v.object({
    dreaming: v.optional(v.number()),
    painting: v.optional(v.number()),
    sculpting: v.optional(v.number()),
    total: v.optional(v.number()),
  }),
  startedAt: v.number(),
  stepStartedAt: v.number(),
  touchedAt: v.number(),
  finishedAt: v.optional(v.number()),
  error: v.optional(v.string()),
}).index("by_step", ["step"]);
