import { query } from "./_generated/server";
import { getProfile, listFriendTokenIdentifiers } from "./profiles";

const FEED_SIZE = 50;

/** Your own worlds and the worlds your friends shared, newest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
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
    const worlds = sources
      .flat()
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(0, FEED_SIZE);
    const authors = new Map(
      await Promise.all(
        [...new Set(worlds.map((world) => world.ownerTokenIdentifier))].map(
          async (owner) =>
            [owner, (await getProfile(ctx, owner))?.name] as const,
        ),
      ),
    );
    return worlds.map((world) => ({
      _id: world._id,
      _creationTime: world._creationTime,
      transcript: world.transcript,
      shared: world.shared === true,
      mine: world.ownerTokenIdentifier === viewer,
      authorName: authors.get(world.ownerTokenIdentifier) ?? "Someone",
    }));
  },
});
