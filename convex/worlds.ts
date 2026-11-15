import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("worlds").order("desc").take(100);
  },
});

export const add = mutation({
  args: { transcript: v.string() },
  handler: async (ctx, args) => {
    const transcript = args.transcript.trim();
    if (!transcript) {
      throw new Error("A world needs a description of your day.");
    }
    return await ctx.db.insert("worlds", { transcript });
  },
});
