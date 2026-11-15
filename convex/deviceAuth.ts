import { v } from "convex/values";
import { mutation, type QueryCtx } from "./_generated/server";
import { sha256Hex } from "./sha256";

/**
 * Device profiles: each phone keeps a long random secret, and the server keeps
 * only its SHA-256 hash. Trading the secret for a token gets a JWT the
 * deployment signs with its own key, which auth.config.ts trusts, so
 * `ctx.auth.getUserIdentity()` works everywhere and its `tokenIdentifier` is
 * `${CONVEX_CLOUD_URL}|<device id>`.
 */
export const DEVICE_TOKEN_AUDIENCE = "worlds-device";

const TOKEN_LIFETIME_SECONDS = 60 * 60;
const MIN_SECRET_LENGTH = 32;
const MAX_SECRET_LENGTH = 256;

export const register = mutation({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    if (
      args.secret.length < MIN_SECRET_LENGTH ||
      args.secret.length > MAX_SECRET_LENGTH
    ) {
      throw new Error(
        `A device secret must be ${MIN_SECRET_LENGTH} to ${MAX_SECRET_LENGTH} characters.`,
      );
    }
    const secretHash = await sha256Hex(args.secret);
    if (!(await findDevice(ctx, secretHash))) {
      await ctx.db.insert("devices", { secretHash });
    }
    return null;
  },
});

export const token = mutation({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    const device = await findDevice(ctx, await sha256Hex(args.secret));
    if (!device) {
      return null;
    }
    return await ctx.auth.signJwt({
      claims: { sub: device._id, aud: DEVICE_TOKEN_AUDIENCE },
      expiresInSeconds: TOKEN_LIFETIME_SECONDS,
    });
  },
});

async function findDevice(ctx: QueryCtx, secretHash: string) {
  return await ctx.db
    .query("devices")
    .withIndex("by_secretHash", (q) => q.eq("secretHash", secretHash))
    .unique();
}
