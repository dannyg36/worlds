import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { getAccessibleWorld, listAccessibleWorlds } from "./access";
import { memorySpace } from "./memory";
import { startGeneration } from "./pipeline";

const MAX_TRANSCRIPT_LENGTH = 4000;

export const list = query({
  args: {},
  handler: async (ctx) => {
    const worlds = await listAccessibleWorlds(ctx);
    return await Promise.all(worlds.map((world) => present(ctx, world)));
  },
});

export const get = query({
  args: { id: v.id("worlds") },
  handler: async (ctx, args) => {
    const world = await getAccessibleWorld(ctx, args.id);
    return world && (await present(ctx, world));
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
    if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
      throw new Error(
        `Keep your day under ${MAX_TRANSCRIPT_LENGTH} characters.`,
      );
    }
    const id = await ctx.db.insert("worlds", {
      ownerTokenIdentifier: identity.tokenIdentifier,
      transcript,
    });
    await startGeneration(ctx, id);
    await ctx.scheduler.runAfter(0, internal.memory.remember, {
      worldId: id,
      transcript,
      space: await memorySpace(identity.tokenIdentifier),
    });
    return id;
  },
});

export const retry = mutation({
  args: { id: v.id("worlds") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const world = await getAccessibleWorld(ctx, args.id);
    if (!world || world.ownerTokenIdentifier !== identity?.tokenIdentifier) {
      throw new Error("World not found.");
    }
    if (world.status === "ready") {
      throw new Error("This world is already ready.");
    }
    if (world.status === "failed" || world.status === undefined) {
      await startGeneration(ctx, world._id);
    }
    return null;
  },
});

/** Adds a later recording to a world and regenerates it from the whole day. */
export const extend = mutation({
  args: { id: v.id("worlds"), transcript: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const world = await getAccessibleWorld(ctx, args.id);
    if (!world || world.ownerTokenIdentifier !== identity?.tokenIdentifier) {
      throw new ConvexError("World not found.");
    }
    const addition = args.transcript.trim();
    if (!addition) {
      throw new ConvexError("A world needs a description of your day.");
    }
    const transcript = `${world.transcript}\n\n${addition}`;
    if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
      throw new ConvexError(
        `Today's world is full. Keep your day under ${MAX_TRANSCRIPT_LENGTH} characters.`,
      );
    }
    await ctx.db.patch("worlds", world._id, { transcript });
    await startGeneration(ctx, world._id);
    await ctx.scheduler.runAfter(0, internal.memory.remember, {
      worldId: world._id,
      transcript: addition,
      space: await memorySpace(world.ownerTokenIdentifier),
    });
    return null;
  },
});

export async function present(ctx: QueryCtx, world: Doc<"worlds">) {
  const [imageUrl, modelUrl] = await Promise.all([
    world.imageStorageId ? ctx.storage.getUrl(world.imageStorageId) : null,
    world.modelStorageId ? ctx.storage.getUrl(world.modelStorageId) : null,
  ]);
  return {
    _id: world._id,
    _creationTime: world._creationTime,
    transcript: world.transcript,
    shared: world.shared === true,
    status: world.status,
    title: world.title,
    caption: world.caption,
    palette: world.palette,
    imageUrl: imageUrl ?? undefined,
    modelUrl: modelUrl ?? undefined,
    error: world.error,
  };
}
