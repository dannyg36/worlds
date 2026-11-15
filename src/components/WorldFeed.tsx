import type { ReactElement } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";

import { GlassSurface } from "@/components/glass/GlassSurface";
import { WorldCard, type WorldStatus } from "@/components/WorldCard";
import { color, layout, motion, radius, space, type } from "@/design/tokens";

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
              <Text style={type.section}>{item.label}</Text>
              <Text style={type.eyebrow}>{item.count} {item.count === 1 ? "world" : "worlds"}</Text>
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
  return (
    <View style={styles.stateGap}>
      {[0, 1].map((i) => (
        <Animated.View key={i} entering={FadeInDown.delay(i * motion.stagger)}>
          <GlassSurface radius={radius.xl} style={i === 0 ? styles.skeletonHero : styles.skeleton}>
            <View style={styles.skeletonLines}>
              <View style={[styles.skeletonLine, { width: "30%" }]} />
              <View style={[styles.skeletonLine, styles.skeletonTitle]} />
            </View>
          </GlassSurface>
        </Animated.View>
      ))}
    </View>
  );
}

function Empty() {
  return (
    <Animated.View entering={FadeInDown.delay(120).springify().damping(motion.spring.damping)}>
      <GlassSurface radius={radius.xl} style={styles.empty}>
        <View style={styles.emptyMoon} />
        <Text style={[type.title, styles.center]}>Your first world is one night away.</Text>
        <Text style={[type.body, styles.center]}>
          Tap the orb and tell me about your day. A minute later it becomes a little place you can explore.
        </Text>
      </GlassSurface>
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
    gap: space.lg,
  },
  pair: {
    flexDirection: "row",
    gap: space.md,
    alignItems: "flex-start",
  },
  spacer: {
    flex: 1,
  },
  month: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingTop: space.xl,
    paddingHorizontal: space.xs,
  },
  stateGap: {
    gap: space.lg,
  },
  skeletonHero: {
    height: 420,
    justifyContent: "flex-end",
  },
  skeleton: {
    height: 220,
    justifyContent: "flex-end",
  },
  skeletonLines: {
    padding: space.xl,
    gap: space.md,
  },
  skeletonLine: {
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  skeletonTitle: {
    height: 22,
    width: "70%",
    borderRadius: 8,
  },
  empty: {
    alignItems: "center",
    gap: space.md,
    padding: space.xxl,
    paddingVertical: space.xxxl,
  },
  emptyMoon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginBottom: space.sm,
    backgroundImage: `radial-gradient(circle at 35% 35%, #FFFFFF 0%, ${color.lilac} 40%, ${color.violet} 100%)`,
    boxShadow: `0 0 50px 8px rgba(139, 108, 255, 0.55)`,
  },
  center: {
    textAlign: "center",
  },
});
