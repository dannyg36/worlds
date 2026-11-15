import { useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import { fixtureWorldsEnabled, useFixtureWorlds } from "./fixtures";
import type { World } from "./worlds";

/** Someone whose worlds you can watch as stories: you first, then your friends. */
export type Person = {
  /** "me" for you; the friend's profile id otherwise. */
  id: string;
  name: string;
  me: boolean;
  /** Newest first. For friends, only the worlds they shared. */
  worlds: World[];
};

export type People = { me: Person; friends: Person[] };

const DAY = 24 * 60 * 60 * 1000;

/** Made or shared a world in the last day; the tray draws these with a nacre ring. */
export function isFresh(person: Person, now = Date.now()) {
  return person.worlds.some((world) => now - world._creationTime < DAY);
}

export function isToday(world: World, now = new Date()) {
  return new Date(world._creationTime).toDateString() === now.toDateString();
}

/** Today's world is your newest world made today, in this device's time zone. */
export function todaysWorld(me: Person): World | undefined {
  return me.worlds.find((world) => isToday(world));
}

/** Friends with something new first (newest first), then everyone else by name. */
function ordered(friends: Person[]) {
  const latest = (person: Person) => person.worlds[0]?._creationTime ?? 0;
  return [...friends].sort((a, b) => {
    const fresh = Number(isFresh(b)) - Number(isFresh(a));
    if (fresh !== 0) return fresh;
    if (isFresh(a)) return latest(b) - latest(a);
    return a.name.localeCompare(b.name);
  });
}

/** You and your friends with their worlds, or undefined while loading. */
export function usePeople(): People | undefined {
  const live = useLivePeople(!fixtureWorldsEnabled);
  const fixtures = useFixturePeople(fixtureWorldsEnabled);
  return fixtureWorldsEnabled ? fixtures : live;
}

function useLivePeople(enabled: boolean): People | undefined {
  const feed = useQuery(api.feed.list, enabled ? {} : "skip");
  const friends = useQuery(api.friends.list, enabled ? {} : "skip");
  const profile = useQuery(api.profiles.me, enabled ? {} : "skip");
  if (!feed || !friends || profile === undefined) {
    return undefined;
  }
  return {
    me: { id: "me", name: profile?.name ?? "You", me: true, worlds: feed.filter((world) => world.mine) },
    friends: ordered(
      friends.map((friend) => ({
        id: friend._id,
        name: friend.name,
        me: false,
        worlds: feed.filter((world) => !world.mine && world.authorId === friend._id),
      })),
    ),
  };
}

const HOUR = 60 * 60 * 1000;
const fixturesLoadedAt = Date.now();

/**
 * Preview data for EXPO_PUBLIC_FIXTURES=1: you own the fixture worlds that form
 * live today, and a few made-up friends share the rest.
 */
function useFixturePeople(enabled: boolean): People | undefined {
  const worlds = useFixtureWorlds();
  if (!enabled) {
    return undefined;
  }
  const pick = (ids: string[]) => worlds.filter((world) => ids.includes(world._id));
  const sharedAgo = (world: World, ago: number): World => ({
    ...world,
    shared: true,
    _creationTime: fixturesLoadedAt - ago,
  });
  const [dolores, birthday, mission, farmers] = [
    "fixture-dolores-park",
    "fixture-birthday-dinner",
    "fixture-mission-peak",
    "fixture-farmers-market",
  ].map((id) => worlds.find((world) => world._id === id));
  const friend = (id: string, name: string, list: (World | undefined)[]): Person => ({
    id,
    name,
    me: false,
    worlds: list.filter((world): world is World => world !== undefined),
  });
  return {
    me: {
      id: "me",
      name: "You",
      me: true,
      worlds: pick(["fixture-hackathon", "fixture-santa-cruz", "fixture-rainy-monday", "fixture-finals-library"]),
    },
    friends: ordered([
      friend("friend-sam", "Sam", [
        dolores && sharedAgo(dolores, 3 * HOUR),
        birthday && sharedAgo(birthday, 5 * DAY),
      ]),
      friend("friend-priya", "Priya", [mission && sharedAgo(mission, 7 * HOUR)]),
      friend("friend-leo", "Leo", [farmers && sharedAgo(farmers, 13 * DAY)]),
      friend("friend-maya", "Maya", []),
    ]),
  };
}
