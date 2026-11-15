import { useMutation, useQuery } from "convex/react";
import { router, type Href } from "expo-router";
import { Alert, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "../../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
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
  openFriends?: () => void;
};

type FeedItem = FunctionReturnType<typeof api.feed.list>[number] & PipelineFields;

function toFeedWorld(doc: FeedItem): FeedWorld {
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
    author: doc.mine ? undefined : doc.authorName,
    shared: doc.shared,
  };
}

function useLiveFeed(): Feed {
  const docs = useQuery(api.feed.list);
  const addWorld = useMutation(api.worlds.add);
  const shareWorld = useMutation(api.sharing.share);
  const unshareWorld = useMutation(api.sharing.unshare);
  return {
    worlds: docs?.map(toFeedWorld),
    add: (transcript) => addWorld({ transcript }),
    canOpen: true,
    toggleShare: (id) => {
      const doc = docs?.find((d) => d._id === id);
      if (!doc) return;
      (doc.shared ? unshareWorld : shareWorld)({ worldId: doc._id }).catch((error) =>
        Alert.alert(
          doc.shared ? "Couldn't stop sharing" : "Couldn't share your world",
          error instanceof Error ? error.message : String(error),
        ),
      );
    },
    openFriends: () => router.push("/friends"),
  };
}

const useFeed: () => Feed =
  process.env.EXPO_PUBLIC_WORLDS_FIXTURES === "1"
    ? () => ({
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        ...(require("@/dev/fixtures") as typeof import("@/dev/fixtures")).useFixtureWorlds(),
        canOpen: false,
        openFriends: () => {},
      })
    : useLiveFeed;

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const feed = useFeed();
  const orbSpace = layout.orb + 110 + insets.bottom;

  return (
    <View style={styles.screen}>
      <WorldFeed
        worlds={feed.worlds}
        topInset={insets.top}
        bottomInset={orbSpace}
        header={<HomeHeader count={feed.worlds?.length} onOpenFriends={feed.openFriends} />}
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
      <View pointerEvents="none" style={[styles.fade, { height: orbSpace + space.xxxl }]} />
      <View pointerEvents="box-none" style={[styles.orbDock, { paddingBottom: insets.bottom + space.md }]}>
        <HeroOrb onPress={() => router.push("/record")} />
      </View>
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
    backgroundImage: "linear-gradient(180deg, rgba(10,8,30,0) 0%, rgba(10,8,30,0.82) 42%, rgba(7,6,22,0.97) 72%, rgba(5,5,18,1) 100%)",
  },
  orbDock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
  },
});
