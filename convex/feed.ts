import { query } from "./_generated/server";
import { listAccessibleWorlds } from "./access";
import { getProfile } from "./profiles";
import { present } from "./worlds";

/** Your own worlds and the worlds your friends shared, newest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }
    const viewer = identity.tokenIdentifier;
    const worlds = await listAccessibleWorlds(ctx);
    const authors = new Map(
      await Promise.all(
        [...new Set(worlds.map((world) => world.ownerTokenIdentifier))].map(
          async (owner) => [owner, await getProfile(ctx, owner)] as const,
        ),
      ),
    );
    return await Promise.all(
      worlds.map(async (world) => {
        const author = authors.get(world.ownerTokenIdentifier);
        return {
          ...(await present(ctx, world)),
          mine: world.ownerTokenIdentifier === viewer,
          authorId: author?._id ?? null,
          authorName: author?.name ?? "Someone",
        };
      }),
    );
  },
});
