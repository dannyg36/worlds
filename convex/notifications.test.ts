/// <reference types="vite/client" />
import { convexTest, type TestConvexForDataModel } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: { url: string };
  ttl?: number;
};
type Receipt = { status: "ok" | "error"; details?: { error: string } };

const LA = "America/Los_Angeles";
const tokenOf = (installId: string) => `ExponentPushToken[${installId}]`;

let expo: ReturnType<typeof fakeExpo>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-15T18:00:00Z"));
  expo = fakeExpo();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fakeExpo() {
  const delivered: ExpoMessage[] = [];
  const sendRequests: ExpoMessage[][] = [];
  const receipts: Record<string, Receipt> = {};
  const unregistered = new Set<string>();
  const outages: number[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (url === "https://exp.host/--/api/v2/push/getReceipts") {
        const ids: string[] = body.ids;
        return json({
          data: Object.fromEntries(
            ids.filter((id) => receipts[id]).map((id) => [id, receipts[id]]),
          ),
        });
      }
      expect(url).toBe("https://exp.host/--/api/v2/push/send");
      const outage = outages.shift();
      if (outage) {
        return new Response("try later", { status: outage });
      }
      const messages: ExpoMessage[] = body;
      sendRequests.push(messages);
      return json({
        data: messages.map((message) => {
          if (unregistered.has(message.to)) {
            return {
              status: "error",
              message: "not a registered push notification recipient",
              details: { error: "DeviceNotRegistered" },
            };
          }
          delivered.push(message);
          return { status: "ok", id: `ticket-${delivered.length}` };
        }),
      });
    }),
  );
  return { delivered, sendRequests, receipts, unregistered, outages };
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

type Test = TestConvexForDataModel<DataModel>;

async function register(
  t: Test,
  installId: string,
  timeZone = LA,
  reminderMinutes?: number,
) {
  await t.mutation(api.notifications.register, {
    installId,
    token: tokenOf(installId),
    timeZone,
    reminderMinutes,
  });
}

async function runCron(t: Test, iso: string) {
  vi.setSystemTime(new Date(iso));
  await t.mutation(internal.notifications.sendDueReminders, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function device(t: Test, installId: string) {
  return await t.run((ctx) =>
    ctx.db
      .query("pushTokens")
      .withIndex("by_installId", (q) => q.eq("installId", installId))
      .unique(),
  );
}

async function nextReminder(t: Test, installId: string) {
  return new Date((await device(t, installId))!.nextReminderAt).toISOString();
}

async function addWorld(t: Test, iso: string, owner?: string) {
  vi.setSystemTime(new Date(iso));
  return await t.run((ctx) =>
    ctx.db.insert("worlds", {
      transcript: "A long walk by the water.",
      ownerTokenIdentifier: owner,
    }),
  );
}

function recipients() {
  const to = expo.delivered.map((message) => message.to);
  expo.delivered.length = 0;
  return to;
}

describe("nightly reminder", () => {
  test("reaches each device at its own local reminder time", async () => {
    const t = convexTest(schema, modules);
    vi.setSystemTime(new Date("2026-11-15T10:00:00Z"));
    await register(t, "la");
    await register(t, "tokyo", "Asia/Tokyo");
    await register(t, "london", "Europe/London", 20 * 60 + 30);

    await runCron(t, "2026-11-15T11:59:00Z");
    expect(recipients()).toEqual([]);
    await runCron(t, "2026-11-15T12:00:00Z");
    expect(expo.delivered).toEqual([
      {
        to: tokenOf("tokyo"),
        title: "Tell me about your day",
        body: "Talk for 20 seconds and it becomes tonight's world.",
        data: { url: "/" },
        ttl: 7200,
        sound: "default",
        channelId: "default",
      },
    ]);
    expect(recipients()).toEqual([tokenOf("tokyo")]);
    await runCron(t, "2026-11-15T20:30:00Z");
    expect(recipients()).toEqual([tokenOf("london")]);
    await runCron(t, "2026-11-16T05:00:00Z");
    expect(recipients()).toEqual([tokenOf("la")]);
    expect(await nextReminder(t, "la")).toBe("2026-11-17T05:00:00.000Z");
  });

  test("skips an owner who already made a world on their local day", async () => {
    const t = convexTest(schema, modules);
    await register(t.withIdentity({ tokenIdentifier: "owner-a" }), "phone");

    await addWorld(t, "2026-11-15T23:00:00Z", "owner-a");
    await runCron(t, "2026-11-16T05:00:00Z");
    expect(recipients()).toEqual([]);
    expect(await nextReminder(t, "phone")).toBe("2026-11-17T05:00:00.000Z");

    await addWorld(t, "2026-11-16T07:30:00Z", "owner-a");
    await addWorld(t, "2026-11-16T20:00:00Z", "owner-b");
    await addWorld(t, "2026-11-16T21:00:00Z");
    await runCron(t, "2026-11-17T05:00:00Z");
    expect(recipients()).toEqual([tokenOf("phone")]);

    await addWorld(t, "2026-11-17T16:00:00Z", "owner-a");
    await runCron(t, "2026-11-18T05:00:00Z");
    expect(recipients()).toEqual([]);
  });

  test("follows the device's clock across a daylight saving change", async () => {
    const t = convexTest(schema, modules);
    vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
    await register(t, "nyc", "America/New_York");
    expect(await nextReminder(t, "nyc")).toBe("2026-11-01T01:00:00.000Z");
    await runCron(t, "2026-11-01T01:00:00Z");
    expect(recipients()).toEqual([tokenOf("nyc")]);
    expect(await nextReminder(t, "nyc")).toBe("2026-11-02T02:00:00.000Z");
  });

  test("sends once when cron runs overlap or repeat", async () => {
    const t = convexTest(schema, modules);
    await register(t, "phone");
    vi.setSystemTime(new Date("2026-11-16T05:00:30Z"));
    await Promise.all([
      t.mutation(internal.notifications.sendDueReminders, {}),
      t.mutation(internal.notifications.sendDueReminders, {}),
    ]);
    await runCron(t, "2026-11-16T05:01:00Z");
    expect(recipients()).toEqual([tokenOf("phone")]);
  });

  test("moving the reminder later after tonight's send waits for tomorrow", async () => {
    const t = convexTest(schema, modules);
    await register(t, "phone");
    await runCron(t, "2026-11-16T05:00:00Z");
    expect(recipients()).toEqual([tokenOf("phone")]);

    await t.mutation(api.notifications.setReminderTime, {
      installId: "phone",
      minutes: 22 * 60,
    });
    expect(await nextReminder(t, "phone")).toBe("2026-11-17T06:00:00.000Z");
    await runCron(t, "2026-11-16T06:00:00Z");
    expect(recipients()).toEqual([]);
    expect(await t.query(api.notifications.registration, { installId: "phone" }))
      .toEqual({ reminderMinutes: 22 * 60, timeZone: LA });
  });

  test("re-registering just before the cron keeps tonight's reminder", async () => {
    const t = convexTest(schema, modules);
    vi.setSystemTime(new Date("2026-11-16T04:59:30Z"));
    await register(t, "phone");
    vi.setSystemTime(new Date("2026-11-16T05:00:10Z"));
    await register(t, "phone");
    await runCron(t, "2026-11-16T05:00:40Z");
    expect(recipients()).toEqual([tokenOf("phone")]);
  });

  test("drops a reminder the cron reaches hours late", async () => {
    const t = convexTest(schema, modules);
    await register(t, "phone");
    await runCron(t, "2026-11-16T07:30:00Z");
    expect(recipients()).toEqual([]);
    expect(await nextReminder(t, "phone")).toBe("2026-11-17T05:00:00.000Z");
  });
});

describe("world status notifications", () => {
  async function ownerWithTwoPhones(t: Test) {
    const owner = t.withIdentity({ tokenIdentifier: "owner-a" });
    await register(owner, "phone");
    await register(owner, "tablet");
    await register(t.withIdentity({ tokenIdentifier: "owner-b" }), "stranger");
    return await addWorld(t, "2026-11-16T04:00:00Z", "owner-a");
  }

  async function changed(
    t: Test,
    worldId: Id<"worlds">,
    status: "ready" | "failed",
    title?: string,
  ) {
    await t.mutation(internal.notifications.worldStatusChanged, {
      worldId,
      status,
      title,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  }

  test("tells every device of the owner once that their world is ready", async () => {
    const t = convexTest(schema, modules);
    const worldId = await ownerWithTwoPhones(t);
    await changed(t, worldId, "ready", "Lantern Market");
    await changed(t, worldId, "ready", "Lantern Market");
    expect(expo.delivered).toEqual(
      ["phone", "tablet"].map((installId) =>
        expect.objectContaining({
          to: tokenOf(installId),
          title: "Your world is ready",
          body: "Step into “Lantern Market”.",
          data: { url: `/world/${worldId}` },
        }),
      ),
    );
  });

  test("sends a gentle notice when generation fails", async () => {
    const t = convexTest(schema, modules);
    const worldId = await ownerWithTwoPhones(t);
    await changed(t, worldId, "failed");
    await changed(t, worldId, "failed");
    expect(expo.delivered).toHaveLength(2);
    expect(expo.delivered[0]).toMatchObject({
      title: "Today's world didn't come together",
      data: { url: `/world/${worldId}` },
    });
    await changed(t, worldId, "ready");
    expect(expo.delivered.slice(2)).toEqual([
      expect.objectContaining({ body: "Step inside today." }),
      expect.objectContaining({ body: "Step inside today." }),
    ]);
  });

  test("stays quiet for a world with no owner", async () => {
    const t = convexTest(schema, modules);
    await register(t, "anonymous");
    const worldId = await addWorld(t, "2026-11-16T04:00:00Z");
    await changed(t, worldId, "ready", "Nobody's World");
    expect(expo.sendRequests).toEqual([]);
  });
});

describe("sending through Expo", () => {
  test("drops tokens Expo rejects as DeviceNotRegistered on send", async () => {
    const t = convexTest(schema, modules);
    await register(t, "gone");
    await register(t, "here");
    expo.unregistered.add(tokenOf("gone"));
    await runCron(t, "2026-11-16T05:00:00Z");
    expect(recipients()).toEqual([tokenOf("here")]);
    expect(await device(t, "gone")).toBeNull();
    expect(await device(t, "here")).not.toBeNull();
  });

  test("drops tokens whose receipt says DeviceNotRegistered unless they re-registered", async () => {
    const t = convexTest(schema, modules);
    await register(t, "gone");
    await register(t, "back");
    await register(t, "fine");
    vi.setSystemTime(new Date("2026-11-16T05:00:00Z"));
    await t.mutation(internal.notifications.sendDueReminders, {});
    vi.advanceTimersByTime(0);
    await t.finishInProgressScheduledFunctions();
    const ticketFor = (installId: string) =>
      `ticket-${expo.delivered.findIndex((m) => m.to === tokenOf(installId)) + 1}`;
    const deviceNotRegistered: Receipt = {
      status: "error",
      details: { error: "DeviceNotRegistered" },
    };
    expo.receipts[ticketFor("gone")] = deviceNotRegistered;
    expo.receipts[ticketFor("back")] = deviceNotRegistered;
    expo.receipts[ticketFor("fine")] = { status: "ok" };

    vi.advanceTimersByTime(60_000);
    await register(t, "back");
    vi.advanceTimersByTime(15 * 60_000);
    await t.finishInProgressScheduledFunctions();

    expect(await device(t, "gone")).toBeNull();
    expect(await device(t, "back")).not.toBeNull();
    expect(await device(t, "fine")).not.toBeNull();
  });

  test("retries with backoff while Expo is overloaded", async () => {
    const t = convexTest(schema, modules);
    await register(t, "phone");
    expo.outages.push(429, 503);
    await runCron(t, "2026-11-16T05:00:00Z");
    expect(recipients()).toEqual([tokenOf("phone")]);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/send"))).toHaveLength(3);
  });

  test("sends at most 100 messages per request", async () => {
    const t = convexTest(schema, modules);
    await t.action(internal.expoPush.send, {
      messages: Array.from({ length: 150 }, (_, index) => ({
        to: tokenOf(`device-${index}`),
        title: "Tell me about your day",
        body: "Talk for 20 seconds.",
        url: "/",
      })),
    });
    expect(expo.sendRequests.map((batch) => batch.length)).toEqual([100, 50]);
  });
});

describe("registration", () => {
  test("hands a token over to the install that registered it last", async () => {
    const t = convexTest(schema, modules);
    await register(t, "old-install");
    await t.mutation(api.notifications.register, {
      installId: "new-install",
      token: tokenOf("old-install"),
      timeZone: LA,
    });
    expect(await device(t, "old-install")).toBeNull();
    expect((await device(t, "new-install"))?.token).toBe(tokenOf("old-install"));
  });

  test("attaches the signed-in owner and keeps it on anonymous refreshes", async () => {
    const t = convexTest(schema, modules);
    await register(t, "phone");
    expect((await device(t, "phone"))?.ownerTokenIdentifier).toBeUndefined();
    await register(t.withIdentity({ tokenIdentifier: "owner-a" }), "phone");
    await register(t, "phone");
    expect((await device(t, "phone"))?.ownerTokenIdentifier).toBe("owner-a");
  });

  test("unregistering stops every push to the install", async () => {
    const t = convexTest(schema, modules);
    await register(t.withIdentity({ tokenIdentifier: "owner-a" }), "phone");
    await t.mutation(api.notifications.unregister, { installId: "phone" });
    expect(await t.query(api.notifications.registration, { installId: "phone" })).toBeNull();
    await runCron(t, "2026-11-16T05:00:00Z");
    const worldId = await addWorld(t, "2026-11-16T06:00:00Z", "owner-a");
    await t.mutation(internal.notifications.worldStatusChanged, {
      worldId,
      status: "ready",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(expo.sendRequests).toEqual([]);
  });

  test("rejects bad tokens, time zones and reminder times", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.notifications.register, {
        installId: "phone",
        token: "not-a-token",
        timeZone: LA,
      }),
    ).rejects.toThrow("Expo push token");
    await expect(register(t, "phone", "Mars/Olympus_Mons")).rejects.toThrow(
      "Unknown time zone",
    );
    await expect(register(t, "phone", LA, 24 * 60)).rejects.toThrow(
      "minute of the day",
    );
    await expect(
      t.mutation(api.notifications.setReminderTime, {
        installId: "nobody",
        minutes: 20 * 60,
      }),
    ).rejects.toThrow("Turn on notifications");
  });
});
