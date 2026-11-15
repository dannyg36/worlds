import { internalAction } from "./_generated/server";
import { recallCast, rememberDay, supermemoryClient } from "./memory";

/**
 * Live check of convex/memory.ts against the real Supermemory API, run on a
 * deployment that has SUPERMEMORY_API_KEY:
 *
 *   npx convex run memoryCheck:run
 *
 * It remembers four sample days that share a dog, a friend and a café in a
 * fresh space, one day at a time and each fully processed before the next, the
 * way nightly days arrive. Then it recalls the cast for a new day that only
 * says "the dog" and "our usual café". It returns what Supermemory learned from
 * each day, the recall block, how long recall took, and which expected details
 * the block is missing. It never touches the worlds table or the shared space,
 * and it leaves its space in Supermemory for inspection.
 */

const SAMPLE_DAYS = [
  {
    date: "2026-11-12T05:30:00.000Z",
    transcript:
      "Okay, Wednesday. Took Mochi out first thing. She's my corgi, super orange and fluffy, with her red collar that has a little brass bell. We walked down to Blue Door Café on Valencia, the tiny place with the bright blue door and ivy all over the front, and I had a cortado on the bench outside while she judged every pigeon.",
  },
  {
    date: "2026-11-13T05:30:00.000Z",
    transcript:
      "Priya came over after work. She's my best friend from college, curly black hair, and she basically lives in her mustard yellow raincoat. We took Mochi to Dolores Park and Mochi stole some kid's tennis ball and would not give it back. Got burritos after.",
  },
  {
    date: "2026-11-14T05:30:00.000Z",
    transcript:
      "Rainy Friday. Worked from Blue Door Café all morning at the window table under all the hanging plants. Sam, the owner, slipped Mochi a biscuit again, and her collar bell jingled every time she begged for more.",
  },
  {
    date: "2026-11-15T05:30:00.000Z",
    transcript:
      "Saturday, Priya and I did a long foggy walk on Ocean Beach with Mochi. Priya's yellow raincoat was the only bright thing out there. Mochi rolled in the sand and came home with sand all through her orange fur.",
  },
];

const NEW_DAY =
  "Slow Sunday. Met Priya at our usual café for pastries and the dog came too, begging for croissant the whole time. Then we walked home through the drizzle.";

const EXPECTED_DETAILS = [
  "Mochi",
  "corgi",
  "orange",
  "red collar",
  "Priya",
  "curly",
  "yellow raincoat",
  "Blue Door",
];

const PROCESSING_TIMEOUT_MS = 90_000;

export const run = internalAction({
  args: {},
  handler: async () => {
    const client = supermemoryClient();
    if (!client) {
      throw new Error("SUPERMEMORY_API_KEY isn't set on this deployment.");
    }
    const space = `worlds-livecheck-${Date.now()}`;
    const days = [];
    for (const [i, day] of SAMPLE_DAYS.entries()) {
      const id = `day-${i + 1}`;
      await rememberDay(client, space, { id, ...day });
      const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
      let doc;
      do {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        doc = await client.documents.get(space, id, { include: "memories" });
      } while (
        doc.system.status !== "failed" &&
        !(doc.system.status === "done" && doc.system.dreamingStatus === "done") &&
        Date.now() < deadline
      );
      days.push({
        id,
        status: doc.system.status,
        dreamingStatus: doc.system.dreamingStatus,
        learned: (doc.memories ?? []).map((memory) => memory.memory),
      });
    }
    const started = Date.now();
    const cast = await recallCast(NEW_DAY, space);
    return {
      space,
      days,
      newDay: NEW_DAY,
      recallMs: Date.now() - started,
      cast,
      missing: EXPECTED_DETAILS.filter(
        (detail) => !cast.toLowerCase().includes(detail.toLowerCase()),
      ),
    };
  },
});
