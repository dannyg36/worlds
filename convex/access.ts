import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/**
 * Every read and write of a world goes through this module. There is no
 * sign-in yet, so every world is everyone's; when sign-in returns, scope
 * these two functions to the caller and nothing else needs to change.
 */
export async function listAccessibleWorlds(ctx: QueryCtx) {
  return await ctx.db.query("worlds").order("desc").take(100);
}

export async function getAccessibleWorld(ctx: QueryCtx, id: Id<"worlds">) {
  return await ctx.db.get("worlds", id);
}
