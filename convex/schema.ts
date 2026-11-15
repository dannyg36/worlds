import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  worlds: defineTable({
    ownerTokenIdentifier: v.string(),
    transcript: v.string(),
  }).index("by_ownerTokenIdentifier", ["ownerTokenIdentifier"]),
});
