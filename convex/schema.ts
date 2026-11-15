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
});
