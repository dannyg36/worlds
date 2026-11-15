/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type Test = ReturnType<typeof convexTest>;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Signs a new phone in the way the app does: register a secret, trade it for a token, pick a name. */
async function signUp(t: Test, name: string, inviteCode?: string) {
  const secret = crypto.randomUUID() + crypto.randomUUID();
  await t.mutation(api.deviceAuth.register, { secret });
  const token = await t.mutation(api.deviceAuth.token, { secret });
  const payload = token!.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const { sub, iss } = JSON.parse(
    atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")),
  );
  const phone = t.withIdentity({ subject: sub, issuer: iss });
  await phone.mutation(api.profiles.create, { name, inviteCode });
  const profile = await phone.query(api.profiles.me, {});
  return Object.assign(phone, { inviteCode: profile!.inviteCode });
}

async function addWorld(
  phone: Awaited<ReturnType<typeof signUp>>,
  transcript: string,
) {
  return await phone.mutation(api.worlds.add, { transcript });
}

test("a caller who isn't signed in sees no worlds and can't add one", async () => {
  const t = convexTest(schema, modules);
  const ana = await signUp(t, "Ana");
  await addWorld(ana, "Ana's day.");

  expect(await t.query(api.worlds.list, {})).toEqual([]);
  expect(await t.query(api.feed.list, {})).toEqual([]);
  await expect(
    t.mutation(api.worlds.add, { transcript: "A day." }),
  ).rejects.toThrow("Sign in to add a world.");
  expect(await ana.query(api.worlds.list, {})).toHaveLength(1);
});

test("an invite makes two profiles friends with each other", async () => {
  const t = convexTest(schema, modules);
  const ana = await signUp(t, "Ana");
  const ben = await signUp(t, "Ben");

  expect(
    await ben.mutation(api.friends.accept, { code: ana.inviteCode }),
  ).toEqual({
    status: "connected",
    name: "Ana",
  });
  expect(
    (await ana.query(api.friends.list, {})).map((friend) => friend.name),
  ).toEqual(["Ben"]);
  expect(
    (await ben.query(api.friends.list, {})).map((friend) => friend.name),
  ).toEqual(["Ana"]);

  const lowercaseWithDash =
    `${ana.inviteCode.slice(0, 4)}-${ana.inviteCode.slice(4)}`.toLowerCase();
  expect(
    await ben.mutation(api.friends.accept, { code: lowercaseWithDash }),
  ).toEqual({
    status: "alreadyFriends",
    name: "Ana",
  });
  expect(await ben.query(api.friends.list, {})).toHaveLength(1);
});

test("opening your own invite changes nothing", async () => {
  const t = convexTest(schema, modules);
  const ana = await signUp(t, "Ana");

  expect(
    await ana.mutation(api.friends.accept, { code: ana.inviteCode }),
  ).toEqual({
    status: "self",
    name: "Ana",
  });
  expect(await ana.query(api.friends.list, {})).toEqual([]);
});

test("an invite opened before picking a name applies once the name is picked", async () => {
  const t = convexTest(schema, modules);
  const ana = await signUp(t, "Ana");
  expect(await t.query(api.friends.inviter, { code: ana.inviteCode })).toEqual({
    name: "Ana",
  });

  const ben = await signUp(t, "Ben", ana.inviteCode);

  expect(
    (await ben.query(api.friends.list, {})).map((friend) => friend.name),
  ).toEqual(["Ana"]);
  expect(
    (await ana.query(api.friends.list, {})).map((friend) => friend.name),
  ).toEqual(["Ben"]);
});

test("an unknown invite code is refused", async () => {
  const t = convexTest(schema, modules);
  const ana = await signUp(t, "Ana");

  await expect(
    ana.mutation(api.friends.accept, { code: "ZZZZ-ZZZZ" }),
  ).rejects.toThrow("No one has that invite code");
  expect(await t.query(api.friends.inviter, { code: "ZZZZZZZZ" })).toBeNull();
});

test("a shared world shows up in a friend's feed, including worlds shared before they connected", async () => {
  const t = convexTest(schema, modules);
  const ana = await signUp(t, "Ana");
  const ben = await signUp(t, "Ben");
  const early = await addWorld(ana, "Shared before Ben joined.");
  await ana.mutation(api.sharing.share, { worldId: early });
  await ben.mutation(api.friends.accept, { code: ana.inviteCode });
  const benWorld = await addWorld(ben, "Ben's own day.");
  const later = await addWorld(ana, "Shared after.");
  await ana.mutation(api.sharing.share, { worldId: later });

  expect(await ben.query(api.feed.list, {})).toMatchObject([
    { _id: later, authorName: "Ana", mine: false, shared: true },
    { _id: benWorld, authorName: "Ben", mine: true, shared: false },
    {
      _id: early,
      authorName: "Ana",
      mine: false,
      shared: true,
      transcript: "Shared before Ben joined.",
    },
  ]);
  expect(await ana.query(api.feed.list, {})).toMatchObject([
    { _id: later, mine: true, shared: true },
    { _id: early, mine: true, shared: true },
  ]);
});

test("an unshared world never shows up in anyone else's feed, and neither does a stranger's world", async () => {
  const t = convexTest(schema, modules);
  const ana = await signUp(t, "Ana");
  const ben = await signUp(t, "Ben", ana.inviteCode);
  const cat = await signUp(t, "Cat");
  const neverShared = await addWorld(ana, "Private day.");
  const unshared = await addWorld(ana, "Shared, then taken back.");
  await ana.mutation(api.sharing.share, { worldId: unshared });
  expect(
    (await ben.query(api.feed.list, {})).map((world) => world._id),
  ).toEqual([unshared]);
  await ana.mutation(api.sharing.unshare, { worldId: unshared });
  const catWorld = await addWorld(cat, "Cat shares with her friends.");
  await cat.mutation(api.sharing.share, { worldId: catWorld });

  expect(await ben.query(api.feed.list, {})).toEqual([]);
  expect(
    (await cat.query(api.feed.list, {})).map((world) => world._id),
  ).toEqual([catWorld]);
  expect(
    (await ana.query(api.feed.list, {})).map((world) => world._id),
  ).toEqual([unshared, neverShared]);
});

test("only the owner can share or unshare a world", async () => {
  const t = convexTest(schema, modules);
  const ana = await signUp(t, "Ana");
  const ben = await signUp(t, "Ben", ana.inviteCode);
  const world = await addWorld(ana, "Ana's day.");

  await expect(
    ben.mutation(api.sharing.share, { worldId: world }),
  ).rejects.toThrow("World not found.");
  await expect(
    t.mutation(api.sharing.share, { worldId: world }),
  ).rejects.toThrow("World not found.");
  expect(await ben.query(api.feed.list, {})).toEqual([]);
});

test("a friend who can see a shared world still can't add to it", async () => {
  const t = convexTest(schema, modules);
  const ana = await signUp(t, "Ana");
  const ben = await signUp(t, "Ben", ana.inviteCode);
  const world = await addWorld(ana, "Ana's day.");
  await ana.mutation(api.sharing.share, { worldId: world });
  expect(await ben.query(api.worlds.get, { id: world })).not.toBeNull();

  await expect(
    ben.mutation(api.worlds.extend, { id: world, transcript: "Ben was there too." }),
  ).rejects.toThrow("World not found.");
  await expect(
    t.mutation(api.worlds.extend, { id: world, transcript: "Anyone at all." }),
  ).rejects.toThrow("World not found.");
  expect((await ana.query(api.worlds.get, { id: world }))?.transcript).toBe(
    "Ana's day.",
  );
});

test("the feed tags each world with its author's profile id, as the friends list does", async () => {
  const t = convexTest(schema, modules);
  const ana = await signUp(t, "Ana");
  const ben = await signUp(t, "Ben", ana.inviteCode);
  const anaWorld = await addWorld(ana, "Ana's day.");
  await ana.mutation(api.sharing.share, { worldId: anaWorld });
  const benWorld = await addWorld(ben, "Ben's day.");
  const [anaProfile] = await ben.query(api.friends.list, {});
  const [benProfile] = await ana.query(api.friends.list, {});

  expect(await ben.query(api.feed.list, {})).toMatchObject([
    { _id: benWorld, mine: true, authorId: benProfile._id, authorName: "Ben" },
    { _id: anaWorld, mine: false, authorId: anaProfile._id, authorName: "Ana" },
  ]);
});
