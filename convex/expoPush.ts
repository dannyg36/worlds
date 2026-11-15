import { v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";

const SEND_URL = "https://exp.host/--/api/v2/push/send";
const RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const ANDROID_CHANNEL_ID = "default";
const SEND_BATCH = 100;
const RECEIPT_BATCH = 1000;
const RECEIPT_DELAY_MS = 15 * 60_000;
const MAX_SEND_ATTEMPTS = 4;
const RETRY_BASE_MS = 5_000;

const pushMessage = v.object({
  to: v.string(),
  title: v.string(),
  body: v.string(),
  url: v.string(),
  ttl: v.optional(v.number()),
});
export type PushMessage = Infer<typeof pushMessage>;

const sentTicket = v.object({ id: v.string(), token: v.string() });

type PushResult = {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};

class PushServiceError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export const send = internalAction({
  args: {
    messages: v.array(pushMessage),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, { messages, attempt = 1 }) => {
    const sentAt = Date.now();
    const tickets: Infer<typeof sentTicket>[] = [];
    const unregistered: string[] = [];
    const retry: PushMessage[] = [];
    for (let start = 0; start < messages.length; start += SEND_BATCH) {
      const batch = messages.slice(start, start + SEND_BATCH);
      let results: PushResult[];
      try {
        results = await post<PushResult[]>(
          SEND_URL,
          batch.map(({ url, ...message }) => ({
            ...message,
            data: { url },
            sound: "default",
            channelId: ANDROID_CHANNEL_ID,
          })),
        );
      } catch (error) {
        console.warn(`Sending ${batch.length} pushes failed: ${describe(error)}`);
        if (error instanceof PushServiceError && error.retryable) {
          retry.push(...batch);
        }
        continue;
      }
      batch.forEach(({ to }, index) => {
        const result = results[index];
        if (result?.status === "ok" && result.id) {
          tickets.push({ id: result.id, token: to });
        } else if (result?.details?.error === "DeviceNotRegistered") {
          unregistered.push(to);
        } else {
          console.warn(`Expo refused a push: ${result?.message ?? "no ticket"}`);
        }
      });
    }
    if (unregistered.length > 0) {
      await ctx.runMutation(internal.expoPush.pruneTokens, {
        tokens: unregistered,
        sentAt,
      });
    }
    if (tickets.length > 0) {
      await ctx.scheduler.runAfter(
        RECEIPT_DELAY_MS,
        internal.expoPush.checkReceipts,
        { tickets, sentAt },
      );
    }
    if (retry.length > 0 && attempt < MAX_SEND_ATTEMPTS) {
      await ctx.scheduler.runAfter(
        RETRY_BASE_MS * 2 ** (attempt - 1),
        internal.expoPush.send,
        { messages: retry, attempt: attempt + 1 },
      );
    } else if (retry.length > 0) {
      console.error(
        `Gave up on ${retry.length} pushes after ${attempt} attempts.`,
      );
    }
    return null;
  },
});

export const checkReceipts = internalAction({
  args: { tickets: v.array(sentTicket), sentAt: v.number() },
  handler: async (ctx, { tickets, sentAt }) => {
    const unregistered: string[] = [];
    for (let start = 0; start < tickets.length; start += RECEIPT_BATCH) {
      const batch = tickets.slice(start, start + RECEIPT_BATCH);
      let receipts: Record<string, PushResult>;
      try {
        receipts = await post<Record<string, PushResult>>(RECEIPTS_URL, {
          ids: batch.map((ticket) => ticket.id),
        });
      } catch (error) {
        console.warn(`Fetching push receipts failed: ${describe(error)}`);
        continue;
      }
      for (const { id, token } of batch) {
        const receipt = receipts[id];
        if (receipt?.status !== "error") {
          continue;
        }
        if (receipt.details?.error === "DeviceNotRegistered") {
          unregistered.push(token);
        } else {
          console.warn(`Push ${id} was not delivered: ${receipt.message}`);
        }
      }
    }
    if (unregistered.length > 0) {
      await ctx.runMutation(internal.expoPush.pruneTokens, {
        tokens: unregistered,
        sentAt,
      });
    }
    return null;
  },
});

export const pruneTokens = internalMutation({
  args: { tokens: v.array(v.string()), sentAt: v.number() },
  handler: async (ctx, { tokens, sentAt }) => {
    for (const token of new Set(tokens)) {
      const devices = await ctx.db
        .query("pushTokens")
        .withIndex("by_token", (q) => q.eq("token", token))
        .take(10);
      for (const device of devices) {
        if (device.registeredAt <= sentAt) {
          await ctx.db.delete("pushTokens", device._id);
        }
      }
    }
    return null;
  },
});

async function post<T>(url: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new PushServiceError(describe(error), true);
  }
  if (!response.ok) {
    throw new PushServiceError(
      `HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`,
      response.status === 429 || response.status >= 500,
    );
  }
  const { data } = (await response.json()) as { data?: T };
  if (data === undefined) {
    throw new PushServiceError("Expo answered without data.", false);
  }
  return data;
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
