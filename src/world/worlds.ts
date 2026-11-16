import { useMutation, useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  fixtureWorldsEnabled,
  isFixtureWorldId,
  retryFixtureWorld,
  useFixtureWorld,
  useFixtureWorlds,
} from "./fixtures";

export type WorldStatus =
  "queued" | "dreaming" | "painting" | "sculpting" | "ready" | "failed";

export type World = {
  _id: string;
  _creationTime: number;
  transcript: string;
  status?: WorldStatus;
  title?: string;
  caption?: string;
  palette?: string[];
  imageUrl?: string;
  modelUrl?: string;
  scene?: string;
  /** Photos shared with the transcript, in the order they were added; null for one that's gone. */
  photos?: (string | null)[];
  error?: string;
  shared?: boolean;
};

export function useWorlds(): World[] | undefined {
  const worlds: World[] | undefined = useQuery(api.worlds.list);
  const fixtures = useFixtureWorlds();
  if (!fixtureWorldsEnabled) {
    return worlds;
  }
  return [...fixtures, ...(worlds ?? [])].sort(
    (a, b) => b._creationTime - a._creationTime,
  );
}

export function useWorld(id: string): World | null | undefined {
  const fixture = useFixtureWorld(id);
  const worlds: World[] | undefined = useQuery(
    api.worlds.list,
    isFixtureWorldId(id) ? "skip" : {},
  );
  if (isFixtureWorldId(id)) {
    return fixture;
  }
  if (worlds === undefined) {
    return undefined;
  }
  return worlds.find((world) => world._id === id) ?? null;
}

export function useRetryWorld(): (id: string) => Promise<void> {
  const retry = useMutation(api.worlds.retry);
  return async (id) => {
    if (isFixtureWorldId(id)) {
      return retryFixtureWorld(id);
    }
    await retry({ id: id as Id<"worlds"> });
  };
}

export const formingStatuses: readonly WorldStatus[] = [
  "queued",
  "dreaming",
  "painting",
  "sculpting",
];

export function isForming(world: World) {
  return world.status !== undefined && formingStatuses.includes(world.status);
}

export function worldTitle(world: World) {
  if (world.title) {
    return world.title;
  }
  const words = world.transcript.trim().split(/\s+/);
  return words.length > 6 ? `${words.slice(0, 6).join(" ")}…` : words.join(" ");
}

export function worldDate(world: World) {
  return new Date(world._creationTime).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export const defaultPalette = ["#17142E", "#4B3F86", "#C9A7E8", "#F6D6E8"];

export function worldPalette(world: World) {
  const palette = (world.palette ?? []).filter((color) =>
    /^#[0-9a-f]{6}$/i.test(color),
  );
  return palette.length >= 2 ? palette : defaultPalette;
}
