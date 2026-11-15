import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

export const MAX_FRIENDS = 50;

const MAX_NAME_LENGTH = 30;
const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const INVITE_CODE_LENGTH = 8;

export const me = query({
  args: {},
  handler: async (ctx) => {
    const profile = await getViewerProfile(ctx);
    return profile && { name: profile.name, inviteCode: profile.inviteCode };
  },
});

export const create = mutation({
  args: { name: v.string(), inviteCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("Sign in to pick a name.");
    }
    const name = args.name.trim();
    if (!name) {
      throw new ConvexError("Pick a name your friends will recognize.");
    }
    if (name.length > MAX_NAME_LENGTH) {
      throw new ConvexError(
        `Keep your name to ${MAX_NAME_LENGTH} characters or fewer.`,
      );
    }
    if (await getProfile(ctx, identity.tokenIdentifier)) {
      return null;
    }
    await ctx.db.insert("profiles", {
      tokenIdentifier: identity.tokenIdentifier,
      name,
      inviteCode: await newInviteCode(ctx),
    });
    const inviter =
      args.inviteCode && (await findProfileByInviteCode(ctx, args.inviteCode));
    if (inviter) {
      await befriend(ctx, identity.tokenIdentifier, inviter.tokenIdentifier);
    }
    return null;
  },
});

export async function getProfile(ctx: QueryCtx, tokenIdentifier: string) {
  return await ctx.db
    .query("profiles")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", tokenIdentifier),
    )
    .unique();
}

export async function getViewerProfile(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  return identity && (await getProfile(ctx, identity.tokenIdentifier));
}

export async function findProfileByInviteCode(ctx: QueryCtx, code: string) {
  const inviteCode = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return await ctx.db
    .query("profiles")
    .withIndex("by_inviteCode", (q) => q.eq("inviteCode", inviteCode))
    .unique();
}

export async function listFriendTokenIdentifiers(
  ctx: QueryCtx,
  tokenIdentifier: string,
) {
  const friendships = await ctx.db
    .query("friendships")
    .withIndex("by_tokenIdentifier_and_friendTokenIdentifier", (q) =>
      q.eq("tokenIdentifier", tokenIdentifier),
    )
    .take(MAX_FRIENDS);
  return friendships.map((friendship) => friendship.friendTokenIdentifier);
}

/** Makes two profiles friends with each other. Returns false if they already were. */
export async function befriend(
  ctx: MutationCtx,
  tokenIdentifier: string,
  friendTokenIdentifier: string,
) {
  const existing = await ctx.db
    .query("friendships")
    .withIndex("by_tokenIdentifier_and_friendTokenIdentifier", (q) =>
      q
        .eq("tokenIdentifier", tokenIdentifier)
        .eq("friendTokenIdentifier", friendTokenIdentifier),
    )
    .unique();
  if (existing) {
    return false;
  }
  await ctx.db.insert("friendships", {
    tokenIdentifier,
    friendTokenIdentifier,
  });
  await ctx.db.insert("friendships", {
    tokenIdentifier: friendTokenIdentifier,
    friendTokenIdentifier: tokenIdentifier,
  });
  return true;
}

async function newInviteCode(ctx: QueryCtx) {
  while (true) {
    const code = Array.from(
      crypto.getRandomValues(new Uint8Array(INVITE_CODE_LENGTH)),
      (byte) => INVITE_CODE_ALPHABET[byte % INVITE_CODE_ALPHABET.length],
    ).join("");
    if (!(await findProfileByInviteCode(ctx, code))) {
      return code;
    }
  }
}
