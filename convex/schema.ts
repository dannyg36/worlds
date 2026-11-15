import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  worlds: defineTable({
    ownerTokenIdentifier: v.string(),
    transcript: v.string(),
    shared: v.optional(v.boolean()),
  })
    .index("by_ownerTokenIdentifier", ["ownerTokenIdentifier"])
    .index("by_ownerTokenIdentifier_and_shared", [
      "ownerTokenIdentifier",
      "shared",
    ]),
  devices: defineTable({
    secretHash: v.string(),
  }).index("by_secretHash", ["secretHash"]),
  profiles: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    inviteCode: v.string(),
  })
    .index("by_tokenIdentifier", ["tokenIdentifier"])
    .index("by_inviteCode", ["inviteCode"]),
  friendships: defineTable({
    tokenIdentifier: v.string(),
    friendTokenIdentifier: v.string(),
  }).index("by_tokenIdentifier_and_friendTokenIdentifier", [
    "tokenIdentifier",
    "friendTokenIdentifier",
  ]),
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
