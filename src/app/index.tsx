import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { router, type Href } from "expo-router";
import { Alert, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "../../convex/_generated/api";
import { HeroOrb } from "@/components/HeroOrb";
import { HomeHeader } from "@/components/HomeHeader";
import type { WorldStatus } from "@/components/WorldCard";
import { WorldFeed, type FeedWorld } from "@/components/WorldFeed";
import { haptics } from "@/design/haptics";
import { layout, space } from "@/design/tokens";

type PipelineFields = Partial<{
  status: WorldStatus;
  title: string;
  caption: string;
  palette: string[];
  imageUrl: string;
  error: string;
}>;

type FeedItem = FunctionReturnType<typeof api.feed.list>[number] & PipelineFields;

type Feed = {
  worlds: FeedWorld[] | undefined;
  canOpen: boolean;
  toggleShare?: (world: FeedWorld) => void;
  retry?: (id: string) => void;
};

function toFeedWorld(item: FeedItem): FeedWorld {
  return {
    id: item._id,
    createdAt: item._creationTime,
    transcript: item.transcript,
    status: item.status,
    title: item.title,
    caption: item.caption,
    palette: item.palette,
    image: item.imageUrl,
    error: item.error,
    author: item.mine ? undefined : item.authorName,
    shared: item.shared,
  };
}

function useLiveFeed(): Feed {
  const items = useQuery(api.feed.list);
  const share = useMutation(api.sharing.share);
  const unshare = useMutation(api.sharing.unshare);
  return {
    worlds: items?.map(toFeedWorld),
    canOpen: true,
    toggleShare: async (world) => {
      try {
        await (world.shared ? unshare : share)({ worldId: world.id as FeedItem["_id"] });
      } catch (error) {
        haptics.error();
        Alert.alert(
          world.shared ? "Couldn't stop sharing" : "Couldn't share your world",
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  };
}

const useFeed: () => Feed =
  process.env.EXPO_PUBLIC_WORLDS_FIXTURES === "1"
    ? () => ({
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        ...(require("@/dev/fixtures") as typeof import("@/dev/fixtures")).useFixtureWorlds(),
        canOpen: false,
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
        header={<HomeHeader count={feed.worlds?.length} onOpenFriends={() => router.push("/friends")} />}
        onOpen={(world) =>
          feed.canOpen && world.image !== undefined
            ? () => router.push(`/world/${world.id}` as Href)
            : undefined
        }
        onRetry={(world) => (feed.retry ? () => feed.retry?.(world.id) : undefined)}
        onToggleShare={(world) =>
          feed.toggleShare && !world.author && (world.status === undefined || world.status === "ready")
            ? () => feed.toggleShare?.(world)
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
