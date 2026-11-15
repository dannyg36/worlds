import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { getAccessibleWorld, listAccessibleWorlds } from "./access";
import { memorySpace } from "./memory";
import { startGeneration } from "./pipeline";

const MAX_TRANSCRIPT_LENGTH = 4000;
const MAX_PHOTOS = 6;
// The image types Claude reads. Claude caps each image at 5 MB of base64,
// which is 3.75 MB of photo.
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_PHOTO_BYTES = (5 * 1024 * 1024 * 3) / 4;

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

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    if (!(await ctx.auth.getUserIdentity())) {
      throw new Error("Sign in to add photos.");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

export const add = mutation({
  args: {
    transcript: v.string(),
    photos: v.optional(v.array(v.id("_storage"))),
  },
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
    const photos = [...new Set(args.photos ?? [])];
    if (photos.length > MAX_PHOTOS) {
      throw new Error(`Add up to ${MAX_PHOTOS} photos.`);
    }
    for (const photo of photos) {
      const file = await ctx.db.system.get("_storage", photo);
      if (
        !file ||
        !PHOTO_TYPES.includes(file.contentType ?? "") ||
        file.size > MAX_PHOTO_BYTES
      ) {
        throw new Error(
          "Photos need to be JPEG, PNG, GIF or WebP images under 3.75 MB.",
        );
      }
    }
    const id = await ctx.db.insert("worlds", {
      ownerTokenIdentifier: identity.tokenIdentifier,
      transcript,
      ...(photos.length > 0 ? { photos } : {}),
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

export async function present(ctx: QueryCtx, world: Doc<"worlds">) {
  const [imageUrl, modelUrl, photos] = await Promise.all([
    world.imageStorageId ? ctx.storage.getUrl(world.imageStorageId) : null,
    world.modelStorageId ? ctx.storage.getUrl(world.modelStorageId) : null,
    Promise.all((world.photos ?? []).map((photo) => ctx.storage.getUrl(photo))),
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
    scene: world.scene,
    // In the order they were added, which is what vignettes' photo indexes
    // point at; null for one whose file is gone.
    photos: photos.length > 0 ? photos : undefined,
    imageUrl: imageUrl ?? undefined,
    modelUrl: modelUrl ?? undefined,
    error: world.error,
  };
}
