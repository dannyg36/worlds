import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  worlds: defineTable({
    ownerTokenIdentifier: v.optional(v.string()),
    transcript: v.string(),
  }).index("by_ownerTokenIdentifier", ["ownerTokenIdentifier"]),
  pushTokens: defineTable({
    installId: v.string(),
    token: v.string(),
    timeZone: v.string(),
    reminderMinutes: v.number(),
    nextReminderAt: v.number(),
    lastReminderDate: v.optional(v.string()),
    ownerTokenIdentifier: v.optional(v.string()),
    registeredAt: v.number(),
  })
    .index("by_installId", ["installId"])
    .index("by_token", ["token"])
    .index("by_nextReminderAt", ["nextReminderAt"])
    .index("by_ownerTokenIdentifier", ["ownerTokenIdentifier"]),
  worldNotices: defineTable({
    worldId: v.id("worlds"),
    status: v.union(v.literal("ready"), v.literal("failed")),
  }).index("by_worldId_and_status", ["worldId", "status"]),
});
