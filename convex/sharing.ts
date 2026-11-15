import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";

/** Sharing shows a world to every friend, including friends who connect later. */
export const share = mutation({
  args: { worldId: v.id("worlds") },
  handler: async (ctx, args) => {
    await setShared(ctx, args.worldId, true);
    return null;
  },
});

export const unshare = mutation({
  args: { worldId: v.id("worlds") },
  handler: async (ctx, args) => {
    await setShared(ctx, args.worldId, false);
    return null;
  },
});

async function setShared(
  ctx: MutationCtx,
  worldId: Id<"worlds">,
  shared: boolean,
) {
  const identity = await ctx.auth.getUserIdentity();
  const world = await ctx.db.get("worlds", worldId);
  if (
    !identity ||
    !world ||
    world.ownerTokenIdentifier !== identity.tokenIdentifier
  ) {
    throw new ConvexError("World not found.");
  }
  await ctx.db.patch("worlds", worldId, { shared });
}
