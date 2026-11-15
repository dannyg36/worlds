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
 *           SUPERMEMORY_API_KEY, or Supermemory is down or slower than
 *           4 seconds. Otherwise it is one <recurring_cast> block of at most
 *           12 facts that carries its own instructions for the model. It opens
 *           with what each recurring person, pet and place in today's note is
 *           and looks like, like "User has a pet named Mochi, a corgi, orange
 *           and fluffy, wearing a red collar", then other lasting facts, then
 *           past events. recall answers within 4 seconds and never throws.
 *   Prompt: put a non-empty block at the top of the scene writer's user
 *           prompt, before the voice note, with a blank line between them:
 *             cast ? `${cast}\n\n${prompt}` : prompt
 *
 * How recall finds the cast: a search with today's transcript returns the
 * memories related to today, which are mostly past events. The names that come
 * up most in them, and any name today's note shares a word with, are today's
 * cast. A second round of searches asks Supermemory who or what each of the
 * top five is and what they look like. Facts that describe someone or
 * something ("Priya has curly black hair") rank above dated one-off events
 * ("Priya visited after work"), and each cast member's best description comes
 * first. When the second round misses the deadline, recall ranks what the
 * first round found.
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
const MAX_CAST_MEMBERS = 5;

const NAME = /\p{Lu}[\p{L}\p{N}'’-]*(?:\s+\p{Lu}[\p{L}\p{N}'’-]*)*/gu;
const NOT_NAMES = new Set(
  "user i it its he she they we you his her their our my the a an this that these those today yesterday tonight tomorrow monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december".split(
    " ",
  ),
);
const DESCRIBES =
  /\b(?:is|are|has|have|wears|owns|lives|looks|always|usually|generally|often|whenever)\b/i;
const DATED =
  /\b(?:\d{4}-\d{2}-\d{2}|today|yesterday|tonight|tomorrow|(?:last|next|this) (?:night|morning|afternoon|evening|week|weekend|month|year)|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b/i;

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

type Recalled = { fact: string; similarity: number; stable: boolean };

export async function recallCast(transcript: string, space = SHARED_SPACE) {
  const client = supermemoryClient();
  const query = transcript.trim();
  if (!client || !query) return "";
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), RECALL_TIMEOUT_MS);
  try {
    const { members, recalled } = await gatherCast(
      client,
      space,
      query,
      deadline.signal,
    );
    const cast = rankCast(members, recalled);
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

export async function gatherCast(
  client: Supermemory,
  space: string,
  transcript: string,
  signal: AbortSignal,
) {
  const options = { abortSignal: signal, maxRetries: 0 };
  const [context, profile] = await Promise.allSettled([
    client.search(
      space,
      {
        query: transcript,
        searchMode: "memories",
        limit: 20,
        rewriteQuery: true,
      },
      options,
    ),
    client.profile(space, {}, options),
  ]);
  const hits = settled(context, "search")?.results ?? [];
  const lasting = new Set(
    settled(profile, "profile")?.profile.static.map((entry) =>
      entry.memory.trim(),
    ),
  );
  const members = castMembers(transcript, hits);
  const lookUps = await Promise.allSettled(
    members.map((name) =>
      client.search(
        space,
        {
          query: `Who or what is ${name}, and what does ${name} look like?`,
          searchMode: "memories",
          limit: 5,
        },
        options,
      ),
    ),
  );
  const similarity = new Map([...lasting].map((fact) => [fact, 0]));
  for (const hit of [
    ...hits,
    ...lookUps.flatMap((lookUp) => settled(lookUp, "look-up")?.results ?? []),
  ]) {
    const fact = hit.memory?.trim();
    if (fact) {
      similarity.set(fact, Math.max(similarity.get(fact) ?? 0, hit.similarity));
    }
  }
  const recalled: Recalled[] = [...similarity].map(([fact, score]) => ({
    fact,
    similarity: score,
    stable: lasting.has(fact) || (DESCRIBES.test(fact) && !DATED.test(fact)),
  }));
  return { members, recalled };
}

function rankCast(members: string[], recalled: Recalled[]) {
  const ranked = [...recalled].sort(
    (a, b) =>
      Number(b.stable) - Number(a.stable) || b.similarity - a.similarity,
  );
  const cast = new Set<string>();
  for (const name of members) {
    const look = ranked.find(
      (r) => r.stable && !cast.has(r.fact) && mentions(r.fact, name),
    );
    if (look) cast.add(look.fact);
  }
  for (const r of ranked) cast.add(r.fact);
  return [...cast].slice(0, MAX_CAST_FACTS);
}

function castMembers(
  transcript: string,
  hits: { memory?: string; similarity: number }[],
) {
  const today = new Set(words(transcript));
  const weights = new Map<string, number>();
  for (const hit of hits) {
    for (const name of new Set(names(hit.memory ?? ""))) {
      weights.set(name, (weights.get(name) ?? 0) + hit.similarity);
    }
  }
  return [...weights]
    .map(([name, weight]) => ({
      name,
      weight: weight + (words(name).some((word) => today.has(word)) ? 1 : 0),
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_CAST_MEMBERS)
    .map(({ name }) => name);
}

function names(fact: string) {
  return (fact.match(NAME) ?? [])
    .map((run) =>
      run
        .replace(/['’]s$/u, "")
        .split(/\s+/)
        .filter((word) => !NOT_NAMES.has(word.toLowerCase()))
        .join(" "),
    )
    .filter(Boolean);
}

function mentions(fact: string, name: string) {
  return ` ${words(fact).join(" ")} `.includes(` ${words(name).join(" ")} `);
}

function words(text: string) {
  return (
    text
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

function settled<T>(result: PromiseSettledResult<T>, call: string) {
  if (result.status === "fulfilled") return result.value;
  console.warn(`Supermemory ${call} failed: ${String(result.reason)}`);
  return undefined;
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
