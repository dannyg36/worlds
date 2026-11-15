import { useEffect, type ReactElement } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { WorldCard, type WorldStatus } from "@/components/WorldCard";
import { color, font, layout, motion, radius, space, type } from "@/design/tokens";

export type FeedWorld = {
  id: string;
  createdAt: number;
  transcript?: string;
  status?: WorldStatus;
  title?: string;
  caption?: string;
  palette?: string[];
  image?: string | number;
  error?: string;
  author?: string;
  shared?: boolean;
};

type Row =
  | { kind: "hero"; key: string; world: FeedWorld }
  | { kind: "pair"; key: string; worlds: FeedWorld[] }
  | { kind: "month"; key: string; label: string; count: number };

function monthKey(time: number) {
  const d = new Date(time);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function toRows(worlds: FeedWorld[]): Row[] {
  if (worlds.length === 0) return [];
  const [first, ...rest] = worlds;
  const rows: Row[] = [{ kind: "hero", key: first.id, world: first }];
  const groups = new Map<string, FeedWorld[]>();
  for (const world of rest) {
    const key = monthKey(world.createdAt);
    groups.set(key, [...(groups.get(key) ?? []), world]);
  }
  for (const [key, group] of groups) {
    if (key !== monthKey(first.createdAt)) {
      rows.push({
        kind: "month",
        key: `month-${key}`,
        label: new Date(group[0].createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" }),
        count: group.length,
      });
    }
    for (let i = 0; i < group.length; i += 2) {
      rows.push({ kind: "pair", key: group[i].id, worlds: group.slice(i, i + 2) });
    }
  }
  return rows;
}

export function WorldFeed({
  worlds,
  header,
  topInset,
  bottomInset,
  onOpen,
  onRetry,
  onToggleShare,
}: {
  worlds: FeedWorld[] | undefined;
  header: ReactElement;
  topInset: number;
  bottomInset: number;
  onOpen?: (world: FeedWorld) => (() => void) | undefined;
  onRetry?: (world: FeedWorld) => (() => void) | undefined;
  onToggleShare?: (world: FeedWorld) => (() => void) | undefined;
}) {
  const card = (world: FeedWorld, variant: "hero" | "compact", index: number) => (
    <WorldCard
      key={world.id}
      variant={variant}
      index={index}
      date={world.createdAt}
      title={world.title}
      caption={world.caption}
      transcript={world.transcript}
      status={world.status}
      image={world.image}
      palette={world.palette}
      error={world.error}
      author={world.author}
      shared={world.shared}
      onPress={onOpen?.(world)}
      onRetry={onRetry?.(world)}
      onToggleShare={onToggleShare?.(world)}
    />
  );

  return (
    <FlatList
      data={worlds ? toRows(worlds) : []}
      keyExtractor={(row) => row.key}
      style={styles.list}
      contentContainerStyle={[styles.content, { paddingTop: topInset + space.md, paddingBottom: bottomInset }]}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={header}
      ListEmptyComponent={worlds === undefined ? <Loading /> : <Empty />}
      renderItem={({ item, index }) => {
        if (item.kind === "hero") return card(item.world, "hero", index);
        if (item.kind === "month") {
          return (
            <Animated.View entering={FadeIn.delay(Math.min(index, 8) * motion.stagger)} style={styles.month}>
              <Text style={styles.monthLabel} accessibilityRole="header">
                {item.label}
              </Text>
              <Text style={type.meta}>
                {item.count} {item.count === 1 ? "world" : "worlds"}
              </Text>
            </Animated.View>
          );
        }
        return (
          <View style={styles.pair}>
            {item.worlds.map((world) => card(world, "compact", index))}
            {item.worlds.length === 1 ? <View style={styles.spacer} /> : null}
          </View>
        );
      }}
    />
  );
}

function Loading() {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.set(withRepeat(withTiming(0.55, { duration: 1200, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Animated.View style={[styles.stateGap, style]} accessibilityLabel="Loading your worlds">
      <View style={styles.skeletonPlate} />
      <View style={styles.skeletonLines}>
        <View style={[styles.skeletonLine, { width: "24%" }]} />
        <View style={[styles.skeletonLine, styles.skeletonTitle]} />
      </View>
    </Animated.View>
  );
}

function Empty() {
  return (
    <Animated.View entering={FadeIn.delay(200).duration(700)} style={styles.empty}>
      <Text style={[type.headline, styles.center]}>Your first world is one night away.</Text>
      <Text style={[type.body, styles.center]}>
        Tap the pearl and tell it about your day. A minute later it becomes a little place you can explore.
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  content: {
    width: "100%",
    maxWidth: layout.maxWidth,
    alignSelf: "center",
    paddingHorizontal: layout.gutter,
    gap: space.xxl + 4,
  },
  pair: {
    flexDirection: "row",
    gap: space.md + 2,
    alignItems: "flex-start",
  },
  spacer: {
    flex: 1,
  },
  month: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: space.lg,
    paddingTop: space.xl,
    paddingHorizontal: space.xxs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.hairlineStrong,
  },
  monthLabel: {
    fontFamily: font.serifLight,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.3,
    color: color.ink,
  },
  stateGap: {
    gap: space.lg,
  },
  skeletonPlate: {
    aspectRatio: 1,
    borderRadius: radius.lg + 4,
    borderCurve: "continuous",
    backgroundColor: color.pearlDeep,
  },
  skeletonLines: {
    gap: space.md,
    paddingHorizontal: space.xs,
  },
  skeletonLine: {
    height: 10,
    borderRadius: 5,
    backgroundColor: color.pearlDeep,
  },
  skeletonTitle: {
    height: 24,
    width: "68%",
    borderRadius: 8,
  },
  empty: {
    alignItems: "center",
    gap: space.md,
    paddingTop: space.xxxl,
    paddingHorizontal: space.lg,
  },
  center: {
    textAlign: "center",
  },
});
