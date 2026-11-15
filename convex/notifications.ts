import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import type { PushMessage } from "./expoPush";
import {
  isTimeZone,
  localDate,
  nextLocalTime,
  startOfLocalDay,
} from "./localTime";

export const RECORD_PATH = "/record";

const DEFAULT_REMINDER_MINUTES = 21 * 60;
const REMINDER_BATCH = 100;
const REMINDER_GRACE_MS = 2 * 60 * 60 * 1000;
const REMINDER_TTL_SECONDS = 2 * 60 * 60;
const MAX_DEVICES_PER_OWNER = 20;
const EXPO_PUSH_TOKEN = /^Expo(nent)?PushToken\[.+\]$/;

export const registration = query({
  args: { installId: v.string() },
  handler: async (ctx, { installId }) => {
    const device = await deviceFor(ctx, installId);
    return (
      device && {
        reminderMinutes: device.reminderMinutes,
        timeZone: device.timeZone,
      }
    );
  },
});

export const register = mutation({
  args: {
    installId: v.string(),
    token: v.string(),
    timeZone: v.string(),
    reminderMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!EXPO_PUSH_TOKEN.test(args.token)) {
      throw new Error("That isn't an Expo push token.");
    }
    if (!isTimeZone(args.timeZone)) {
      throw new Error(`Unknown time zone ${args.timeZone}.`);
    }
    if (args.reminderMinutes !== undefined) {
      checkReminderMinutes(args.reminderMinutes);
    }
    const identity = await ctx.auth.getUserIdentity();
    const now = Date.now();
    const holders = await ctx.db
      .query("pushTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(10);
    for (const holder of holders) {
      if (holder.installId !== args.installId) {
        await ctx.db.delete("pushTokens", holder._id);
      }
    }
    const device = await deviceFor(ctx, args.installId);
    const reminderMinutes =
      args.reminderMinutes ??
      device?.reminderMinutes ??
      DEFAULT_REMINDER_MINUTES;
    const keepSchedule =
      device &&
      device.timeZone === args.timeZone &&
      device.reminderMinutes === reminderMinutes;
    const fields = {
      token: args.token,
      timeZone: args.timeZone,
      reminderMinutes,
      nextReminderAt: keepSchedule
        ? device.nextReminderAt
        : nextLocalTime(
            now,
            args.timeZone,
            reminderMinutes,
            device?.lastReminderDate,
          ),
      ownerTokenIdentifier:
        identity?.tokenIdentifier ?? device?.ownerTokenIdentifier,
      registeredAt: now,
    };
    if (device) {
      await ctx.db.patch("pushTokens", device._id, fields);
    } else {
      await ctx.db.insert("pushTokens", {
        installId: args.installId,
        ...fields,
      });
    }
    return null;
  },
});

export const unregister = mutation({
  args: { installId: v.string() },
  handler: async (ctx, { installId }) => {
    const device = await deviceFor(ctx, installId);
    if (device) {
      await ctx.db.delete("pushTokens", device._id);
    }
    return null;
  },
});

export const setReminderTime = mutation({
  args: { installId: v.string(), minutes: v.number() },
  handler: async (ctx, { installId, minutes }) => {
    checkReminderMinutes(minutes);
    const device = await deviceFor(ctx, installId);
    if (!device) {
      throw new Error("Turn on notifications before setting a reminder time.");
    }
    await ctx.db.patch("pushTokens", device._id, {
      reminderMinutes: minutes,
      nextReminderAt: nextLocalTime(
        Date.now(),
        device.timeZone,
        minutes,
        device.lastReminderDate,
      ),
    });
    return null;
  },
});

export const sendDueReminders = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("pushTokens")
      .withIndex("by_nextReminderAt", (q) => q.lte("nextReminderAt", now))
      .take(REMINDER_BATCH);
    const messages: PushMessage[] = [];
    for (const device of due) {
      const date = localDate(device.nextReminderAt, device.timeZone);
      const remind =
        now - device.nextReminderAt < REMINDER_GRACE_MS &&
        !(await madeWorldSince(
          ctx,
          device.ownerTokenIdentifier,
          startOfLocalDay(device.nextReminderAt, device.timeZone),
        ));
      await ctx.db.patch("pushTokens", device._id, {
        lastReminderDate: date,
        nextReminderAt: nextLocalTime(
          now,
          device.timeZone,
          device.reminderMinutes,
          date,
        ),
      });
      if (remind) {
        messages.push({
          to: device.token,
          title: "Tell me about your day",
          body: "Talk for 20 seconds and it becomes tonight's world.",
          url: RECORD_PATH,
          ttl: REMINDER_TTL_SECONDS,
        });
      }
    }
    if (messages.length > 0) {
      await ctx.scheduler.runAfter(0, internal.expoPush.send, { messages });
    }
    if (due.length === REMINDER_BATCH) {
      await ctx.scheduler.runAfter(0, internal.notifications.sendDueReminders);
    }
    return null;
  },
});

export const worldStatusChanged = internalMutation({
  args: {
    worldId: v.id("worlds"),
    status: v.union(v.literal("ready"), v.literal("failed")),
    title: v.optional(v.string()),
  },
  handler: async (ctx, { worldId, status, title }) => {
    const owner = (await ctx.db.get("worlds", worldId))?.ownerTokenIdentifier;
    if (!owner) {
      return null;
    }
    const notice = await ctx.db
      .query("worldNotices")
      .withIndex("by_worldId_and_status", (q) =>
        q.eq("worldId", worldId).eq("status", status),
      )
      .unique();
    if (notice) {
      return null;
    }
    await ctx.db.insert("worldNotices", { worldId, status });
    const devices = await ctx.db
      .query("pushTokens")
      .withIndex("by_ownerTokenIdentifier", (q) =>
        q.eq("ownerTokenIdentifier", owner),
      )
      .take(MAX_DEVICES_PER_OWNER);
    if (devices.length === 0) {
      return null;
    }
    const content =
      status === "ready"
        ? {
            title: "Your world is ready",
            body: title ? `Step into “${title}”.` : "Step inside today.",
          }
        : {
            title: "Today's world didn't come together",
            body: "Something went wrong while building it. Tap to give it another go.",
          };
    await ctx.scheduler.runAfter(0, internal.expoPush.send, {
      messages: devices.map((device) => ({
        to: device.token,
        ...content,
        url: worldPath(worldId),
      })),
    });
    return null;
  },
});

function worldPath(worldId: Id<"worlds">) {
  return `/world/${worldId}`;
}

async function deviceFor(ctx: QueryCtx, installId: string) {
  return await ctx.db
    .query("pushTokens")
    .withIndex("by_installId", (q) => q.eq("installId", installId))
    .unique();
}

async function madeWorldSince(
  ctx: QueryCtx,
  owner: string | undefined,
  since: number,
) {
  if (!owner) {
    return false;
  }
  const world = await ctx.db
    .query("worlds")
    .withIndex("by_ownerTokenIdentifier", (q) =>
      q.eq("ownerTokenIdentifier", owner).gte("_creationTime", since),
    )
    .first();
  return world !== null;
}

function checkReminderMinutes(minutes: number) {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60) {
    throw new Error("Reminder time must be a whole minute of the day.");
  }
}
