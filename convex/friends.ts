import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  befriend,
  findProfileByInviteCode,
  getProfile,
  getViewerProfile,
  listFriendTokenIdentifiers,
} from "./profiles";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }
    const tokenIdentifiers = await listFriendTokenIdentifiers(
      ctx,
      identity.tokenIdentifier,
    );
    const friends = await Promise.all(
      tokenIdentifiers.map((tokenIdentifier) =>
        getProfile(ctx, tokenIdentifier),
      ),
    );
    return friends
      .filter((friend) => friend !== null)
      .map((friend) => ({ _id: friend._id, name: friend.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Who an invite code belongs to, so someone opening an invite before picking a name sees who sent it. */
export const inviter = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const profile = await findProfileByInviteCode(ctx, args.code);
    return profile && { name: profile.name };
  },
});

export const accept = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const viewer = await getViewerProfile(ctx);
    if (!viewer) {
      throw new ConvexError("Pick a name before adding friends.");
    }
    const inviter = await findProfileByInviteCode(ctx, args.code);
    if (!inviter) {
      throw new ConvexError(
        "No one has that invite code. Check it and try again.",
      );
    }
    if (inviter._id === viewer._id) {
      return { status: "self" as const, name: viewer.name };
    }
    const connected = await befriend(
      ctx,
      viewer.tokenIdentifier,
      inviter.tokenIdentifier,
    );
    return {
      status: connected ? ("connected" as const) : ("alreadyFriends" as const),
      name: inviter.name,
    };
  },
});
