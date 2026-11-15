import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { generationRuns, worldGenerationFields } from "./generation/tables";

export default defineSchema({
  worlds: defineTable({
    transcript: v.string(),
    ...worldGenerationFields,
  }),
  generationRuns,
});
