import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { memorySpace } from "./memory";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }
    return await ctx.db
      .query("worlds")
      .withIndex("by_ownerTokenIdentifier", (q) =>
        q.eq("ownerTokenIdentifier", identity.tokenIdentifier),
      )
      .order("desc")
      .take(100);
  },
});

export const add = mutation({
  args: { transcript: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Sign in to add a world.");
    }
    const transcript = args.transcript.trim();
    if (!transcript) {
      throw new Error("A world needs a description of your day.");
    }
    const id = await ctx.db.insert("worlds", {
      ownerTokenIdentifier: identity.tokenIdentifier,
      transcript,
    });
    await ctx.scheduler.runAfter(0, internal.memory.remember, {
      worldId: id,
      transcript,
      space: await memorySpace(identity.tokenIdentifier),
    });
    return id;
  },
});
