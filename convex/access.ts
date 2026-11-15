import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { listFriendTokenIdentifiers } from "./profiles";

const FEED_SIZE = 50;

/**
 * Every read of a world goes through this module. A world is visible to its
 * owner, and to the owner's friends once it is shared.
 */
export async function listAccessibleWorlds(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return [];
  }
  const viewer = identity.tokenIdentifier;
  const friends = await listFriendTokenIdentifiers(ctx, viewer);
  const sources = await Promise.all([
    ctx.db
      .query("worlds")
      .withIndex("by_ownerTokenIdentifier", (q) =>
        q.eq("ownerTokenIdentifier", viewer),
      )
      .order("desc")
      .take(FEED_SIZE),
    ...friends.map((friend) =>
      ctx.db
        .query("worlds")
        .withIndex("by_ownerTokenIdentifier_and_shared", (q) =>
          q.eq("ownerTokenIdentifier", friend).eq("shared", true),
        )
        .order("desc")
        .take(FEED_SIZE),
    ),
  ]);
  return sources
    .flat()
    .sort((a, b) => b._creationTime - a._creationTime)
    .slice(0, FEED_SIZE);
}

export async function getAccessibleWorld(
  ctx: QueryCtx,
  id: Id<"worlds">,
): Promise<Doc<"worlds"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  const world = await ctx.db.get("worlds", id);
  if (!identity || !world) {
    return null;
  }
  const viewer = identity.tokenIdentifier;
  if (world.ownerTokenIdentifier === viewer) {
    return world;
  }
  if (world.shared !== true) {
    return null;
  }
  const friends = await listFriendTokenIdentifiers(ctx, viewer);
  return friends.includes(world.ownerTokenIdentifier) ? world : null;
}
