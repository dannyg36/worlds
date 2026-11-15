import { useMutation } from "convex/react";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Alert, StyleSheet, Text, View, type TextStyle } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { RecordPearl } from "@/components/RecordPearl";
import { IconButton } from "@/components/ui/IconButton";
import { Pearl } from "@/components/ui/Pearl";
import { color, layout, radius, space, type } from "@/design/tokens";
import { fixtureWorldsEnabled } from "@/world/fixtures";
import { todaysWorld, usePeople } from "@/world/people";
import { WorldStage } from "@/world/WorldStage";
import { worldTitle, type World } from "@/world/worlds";

/** The pearl's touch area plus its label, above the safe area. */
const DOCK = layout.pearl + 36 + 24;

/** You open the app inside today's world; the pearl adds to it as the day goes on. */
export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const people = usePeople();
  const today = people ? todaysWorld(people.me) : undefined;
  const [walking, setWalking] = useState(false);
  const dock = DOCK + insets.bottom + space.lg;

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      {people === undefined ? (
        <View style={styles.center}>
          <Pearl size={56} />
        </View>
      ) : today ? (
        <Today world={today} dock={dock} walking={walking} onWalkingChange={setWalking} />
      ) : (
        <EmptyDay dock={dock} />
      )}
      {walking ? null : (
        <Animated.View
          entering={FadeIn.duration(400)}
          exiting={FadeOut.duration(250)}
          pointerEvents="box-none"
          style={[styles.dock, { paddingBottom: insets.bottom + space.lg }]}
        >
          <RecordPearl
            label={today ? "Add to today" : "Tell me about your day"}
            onPress={() =>
              router.push(today ? { pathname: "/record", params: { worldId: today._id } } : "/record")
            }
          />
        </Animated.View>
      )}
    </View>
  );
}

function Today({
  world,
  dock,
  walking,
  onWalkingChange,
}: {
  world: World;
  dock: number;
  walking: boolean;
  onWalkingChange: (walking: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const [viewerReady, setViewerReady] = useState(false);
  const top = insets.top + 60;

  return (
    <View style={StyleSheet.absoluteFill}>
      <WorldStage
        world={world}
        chrome={{ top: top + 120, bottom: dock }}
        walking={walking}
        onWalkingChange={onWalkingChange}
        onViewerReadyChange={setViewerReady}
      />
      {viewerReady && !walking ? (
        <Animated.View
          entering={FadeIn.delay(500).duration(700)}
          exiting={FadeOut.duration(250)}
          pointerEvents="none"
          style={[styles.header, { top }]}
        >
          <Text style={type.meta}>{longDate(world._creationTime)}</Text>
          <Text style={styles.title} numberOfLines={2}>
            {worldTitle(world)}
          </Text>
          {world.caption ? (
            <Text style={type.caption} numberOfLines={2}>
              {world.caption}
            </Text>
          ) : null}
        </Animated.View>
      ) : null}
      {viewerReady ? (
        <View style={[styles.actions, { top }]}>
          {walking ? null : <ShareButton world={world} />}
          <IconButton
            variant="frost"
            icon={walking ? { ios: "xmark", web: "close" } : { ios: "figure.walk", web: "directions_walk" }}
            accessibilityLabel={walking ? "Stop walking" : "Walk around"}
            onPress={() => onWalkingChange(!walking)}
          />
        </View>
      ) : null}
    </View>
  );
}

function ShareButton({ world }: { world: World }) {
  const share = useMutation(api.sharing.share);
  const unshare = useMutation(api.sharing.unshare);
  const [previewShared, setPreviewShared] = useState(world.shared === true);
  const shared = fixtureWorldsEnabled ? previewShared : world.shared === true;

  return (
    <IconButton
      variant={shared ? "ink" : "frost"}
      icon={shared ? { ios: "person.2.fill", web: "group" } : { ios: "square.and.arrow.up", web: "ios_share" }}
      accessibilityLabel={shared ? "Stop sharing with friends" : "Share with friends"}
      onPress={() => {
        if (fixtureWorldsEnabled) {
          setPreviewShared(!shared);
          return;
        }
        (shared ? unshare : share)({ worldId: world._id as Id<"worlds"> }).catch((error) =>
          Alert.alert(
            shared ? "Couldn't stop sharing" : "Couldn't share your world",
            error instanceof Error ? error.message : String(error),
          ),
        );
      }}
    />
  );
}

/** Before the first recording of the day: the date, and the space today's world will fill. */
function EmptyDay({ dock }: { dock: number }) {
  const insets = useSafeAreaInsets();
  const now = new Date();
  return (
    <Animated.View
      entering={FadeIn.duration(800)}
      style={[styles.empty, { paddingTop: insets.top + 72, paddingBottom: dock + space.lg }]}
    >
      <Text style={type.display} accessibilityRole="header">
        {now.toLocaleDateString(undefined, { weekday: "long" })}
        {"\n"}
        {now.toLocaleDateString(undefined, { month: "long", day: "numeric" })}
      </Text>
      <View style={styles.plateArea}>
        <View style={styles.plate} />
      </View>
      <Text style={[type.body, styles.emptyBody]}>
        Today’s world is still empty. Tell it about your morning, and it will grow with your day.
      </Text>
    </Animated.View>
  );
}

function longDate(time: number) {
  return new Date(time).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    position: "absolute",
    left: layout.gutter,
    right: layout.gutter + 104,
    gap: space.xs,
  },
  title: {
    ...type.headline,
    textWrap: "balance",
  } as TextStyle,
  actions: {
    position: "absolute",
    right: layout.gutter - space.xs,
    flexDirection: "row",
    gap: space.sm,
  },
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
  },
  empty: {
    flex: 1,
    width: "100%",
    maxWidth: layout.maxWidth,
    alignSelf: "center",
    paddingHorizontal: layout.gutter,
    gap: space.xl,
  },
  plateArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    marginBottom: -space.xs,
  },
  plate: {
    height: "100%",
    maxHeight: 360,
    aspectRatio: 1,
    borderRadius: radius.lg + 4,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: color.hairline,
    backgroundColor: color.pearlLight,
    backgroundImage: [
      `radial-gradient(circle at 30% 26%, ${color.blush} 0%, rgba(243, 221, 227, 0) 52%)`,
      `radial-gradient(circle at 76% 70%, ${color.mint} 0%, rgba(214, 236, 231, 0) 50%)`,
      `radial-gradient(circle at 70% 18%, ${color.lilac} 0%, rgba(227, 221, 243, 0) 44%)`,
    ].join(", "),
    boxShadow: "inset 0 1px 3px rgba(0, 0, 0, 0.04)",
  },
  emptyBody: {
    maxWidth: 420,
  },
});
