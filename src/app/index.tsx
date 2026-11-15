import { useMutation, useQuery } from "convex/react";
import { router, type Href } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { Composer } from "@/components/Composer";
import { HeroOrb } from "@/components/HeroOrb";
import { HomeHeader } from "@/components/HomeHeader";
import type { WorldStatus } from "@/components/WorldCard";
import { WorldFeed, type FeedWorld } from "@/components/WorldFeed";
import { layout, space } from "@/design/tokens";

type PipelineFields = Partial<{
  status: WorldStatus;
  title: string;
  caption: string;
  palette: string[];
  imageUrl: string;
  error: string;
}>;

type Feed = {
  worlds: FeedWorld[] | undefined;
  add: (transcript: string) => Promise<unknown>;
  canOpen: boolean;
  toggleShare?: (id: string) => void;
  retry?: (id: string) => void;
};

function toFeedWorld(doc: Doc<"worlds"> & PipelineFields): FeedWorld {
  return {
    id: doc._id,
    createdAt: doc._creationTime,
    transcript: doc.transcript,
    status: doc.status,
    title: doc.title,
    caption: doc.caption,
    palette: doc.palette,
    image: doc.imageUrl,
    error: doc.error,
  };
}

function useLiveFeed(): Feed {
  const docs = useQuery(api.worlds.list);
  const addWorld = useMutation(api.worlds.add);
  return {
    worlds: docs?.map(toFeedWorld),
    add: (transcript) => addWorld({ transcript }),
    canOpen: true,
  };
}

const useFeed: () => Feed =
  process.env.EXPO_PUBLIC_WORLDS_FIXTURES === "1"
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      () => ({ ...(require("@/dev/fixtures") as typeof import("@/dev/fixtures")).useFixtureWorlds(), canOpen: false })
    : useLiveFeed;

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const feed = useFeed();
  const [composing, setComposing] = useState(false);
  const orbSpace = layout.orb + 110 + insets.bottom;

  return (
    <View style={styles.screen}>
      <WorldFeed
        worlds={feed.worlds}
        topInset={insets.top}
        bottomInset={orbSpace}
        header={<HomeHeader count={feed.worlds?.length} />}
        onOpen={(world) =>
          feed.canOpen && world.image !== undefined
            ? () => router.push(`/world/${world.id}` as Href)
            : undefined
        }
        onRetry={(world) => (feed.retry ? () => feed.retry?.(world.id) : undefined)}
        onToggleShare={(world) =>
          feed.toggleShare && !world.author && world.status === "ready"
            ? () => feed.toggleShare?.(world.id)
            : undefined
        }
      />
      <View pointerEvents="none" style={[styles.fade, { height: orbSpace + space.xxl }]} />
      <View pointerEvents="box-none" style={[styles.orbDock, { paddingBottom: insets.bottom + space.md }]}>
        <HeroOrb onPress={() => setComposing(true)} />
      </View>
      <Composer visible={composing} onClose={() => setComposing(false)} onSubmit={feed.add} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  fade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundImage: "linear-gradient(180deg, rgba(10,8,30,0) 0%, rgba(10,8,30,0.72) 55%, rgba(8,6,24,0.95) 100%)",
  },
  orbDock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
  },
});
