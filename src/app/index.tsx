import { useMutation, useQuery } from "convex/react";
import { router, type Href } from "expo-router";
import { Alert, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { HomeHeader } from "@/components/HomeHeader";
import { RecordPearl } from "@/components/RecordPearl";
import type { WorldStatus } from "@/components/WorldCard";
import { WorldFeed, type FeedWorld } from "@/components/WorldFeed";
import { color, layout, space } from "@/design/tokens";
import { withAlpha } from "@/design/palette";

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
  const retryWorld = useMutation(api.worlds.retry);
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
    retry: (id) => {
      retryWorld({ id: id as Id<"worlds"> }).catch((error) =>
        Alert.alert(
          "Couldn't retry your world",
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
  const dockSpace = layout.pearl + 120 + insets.bottom;

  return (
    <View style={styles.screen}>
      <WorldFeed
        worlds={feed.worlds}
        topInset={insets.top}
        bottomInset={dockSpace}
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
      <View pointerEvents="none" style={[styles.fade, { height: dockSpace + space.xxl }]} />
      <View pointerEvents="box-none" style={[styles.dock, { paddingBottom: insets.bottom + space.lg }]}>
        <RecordPearl onPress={() => router.push("/record")} />
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
    backgroundImage: `linear-gradient(180deg, ${withAlpha(color.pearl, 0)} 0%, ${withAlpha(color.pearl, 0.86)} 46%, ${withAlpha(color.pearlDeep, 0.97)} 78%, ${color.pearlDeep} 100%)`,
  },
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
  },
});
