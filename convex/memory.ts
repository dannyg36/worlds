import { v } from "convex/values";
import { Supermemory } from "supermemory";
import { internal } from "./_generated/api";
import { env, internalAction } from "./_generated/server";

/**
 * Memory of the people, pets, places and things that keep coming back in
 * someone's days, kept in Supermemory so their dog looks like their dog in
 * every world.
 *
 * remember: worlds.add schedules it for every new world. It saves the day's
 * transcript to a memory space and retries after 1, 10 and 60 minutes when
 * Supermemory fails. worlds.add never waits on Supermemory. It asks for
 * instant dreaming, so a day can be recalled seconds later instead of minutes,
 * at one extra Supermemory operation per day.
 *
 * recall: the scene writer's contract.
 *   Call:   from an action in the default runtime,
 *             const cast = await recallCast(transcript);
 *           or from a "use node" action,
 *             const cast = await ctx.runAction(internal.memory.recall, { transcript });
 *   Input:  transcript, today's transcript, the same text the scene writer gets.
 *           space, optional, the memory space to read; defaults to SHARED_SPACE.
 *   Output: a string. It is "" when there is nothing to recall, no
 *           SUPERMEMORY_API_KEY, or Supermemory fails or takes longer than
 *           4 seconds. Otherwise it is one <recurring_cast> block of at most
 *           12 facts, like "Mochi is the user's orange corgi with a red
 *           collar", that carries its own instructions for the model.
 *           recall never throws.
 *   Prompt: put a non-empty block at the top of the scene writer's user
 *           prompt, before the voice note, with a blank line between them:
 *             cast ? `${cast}\n\n${prompt}` : prompt
 *
 * Spaces: everyone shares SHARED_SPACE until device profiles land. Then pass
 * each person's own space to remember (from worlds.add) and to recall.
 * Supermemory namespaces allow letters, digits, "-", "_" and ":", up to 100
 * characters, so derive the space from identity.tokenIdentifier, for example
 * as a hash of it, instead of using the raw value.
 */

export const SHARED_SPACE = "worlds-shared";

const RETRY_DELAYS_MS = [60_000, 10 * 60_000, 60 * 60_000];
const RECALL_TIMEOUT_MS = 4_000;
const MAX_CAST_FACTS = 12;

const SUPPORTING_CONTEXT =
  "Nightly voice notes, about 20 seconds each, in which a person describes their day. Each note becomes a small 3D world, and the same people, pets, places and things must look the same every time they come back. Remember who and what recurs: names and nicknames, how each one relates to the speaker (my sister, my roommate, my dog, our usual café), and every visual detail mentioned, such as species, breed, colors, hair, clothes, accessories, vehicles and what places look like. Keep each detail attached to the right name.";

const CAST_INSTRUCTIONS =
  'People, pets, places and things from this person\'s earlier days. Put one in the scene only when today\'s voice note brings it up, by name or by role ("my dog", "our usual café"), and then keep its name, relationship and look exactly as described here.';

export function supermemoryClient() {
  const apiKey = env.SUPERMEMORY_API_KEY;
  return apiKey ? new Supermemory({ apiKey, timeoutInSeconds: 30 }) : null;
}

export async function rememberDay(
  client: Supermemory,
  space: string,
  day: { id: string; transcript: string; date?: string },
) {
  return await client.add(space, {
    id: day.id,
    content: day.transcript,
    date: day.date,
    supportingContext: SUPPORTING_CONTEXT,
    dreaming: "instant",
  });
}

export async function recallCast(transcript: string, space = SHARED_SPACE) {
  const client = supermemoryClient();
  const query = transcript.trim();
  if (!client || !query) return "";
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), RECALL_TIMEOUT_MS);
  const options = { abortSignal: deadline.signal, maxRetries: 0 };
  try {
    const [search, profile] = await Promise.allSettled([
      client.search(
        space,
        { query, searchMode: "memories", limit: 8, rewriteQuery: true },
        options,
      ),
      client.profile(space, {}, options),
    ]);
    const facts: (string | undefined)[] = [];
    if (search.status === "fulfilled") {
      facts.push(...search.value.results.map((result) => result.memory));
    } else {
      console.warn(`Supermemory search failed: ${String(search.reason)}`);
    }
    if (profile.status === "fulfilled") {
      facts.push(...profile.value.profile.static.map((entry) => entry.memory));
    } else {
      console.warn(`Supermemory profile failed: ${String(profile.reason)}`);
    }
    const cast = [
      ...new Set(facts.map((fact) => fact?.trim()).filter((fact) => !!fact)),
    ].slice(0, MAX_CAST_FACTS);
    if (cast.length === 0) return "";
    return [
      "<recurring_cast>",
      CAST_INSTRUCTIONS,
      ...cast.map((fact) => `- ${fact}`),
      "</recurring_cast>",
    ].join("\n");
  } catch (error) {
    console.warn(`Supermemory recall failed: ${String(error)}`);
    return "";
  } finally {
    clearTimeout(timer);
  }
}

export const remember = internalAction({
  args: {
    worldId: v.id("worlds"),
    transcript: v.string(),
    space: v.optional(v.string()),
    attempt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const client = supermemoryClient();
    if (!client) {
      console.warn(
        `SUPERMEMORY_API_KEY isn't set, so world ${args.worldId} won't be remembered.`,
      );
      return null;
    }
    try {
      await rememberDay(client, args.space ?? SHARED_SPACE, {
        id: args.worldId,
        transcript: args.transcript,
      });
    } catch (error) {
      const attempt = args.attempt ?? 0;
      const retryIn = RETRY_DELAYS_MS[attempt];
      console.error(
        `Supermemory couldn't remember world ${args.worldId} on attempt ${attempt + 1}: ${String(error)}`,
      );
      if (retryIn !== undefined) {
        await ctx.scheduler.runAfter(retryIn, internal.memory.remember, {
          ...args,
          attempt: attempt + 1,
        });
      }
    }
    return null;
  },
});

export const recall = internalAction({
  args: { transcript: v.string(), space: v.optional(v.string()) },
  returns: v.string(),
  handler: async (_ctx, args) => await recallCast(args.transcript, args.space),
});
