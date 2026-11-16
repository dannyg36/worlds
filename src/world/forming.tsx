import { Image } from "expo-image";
import { useEffect, useMemo } from "react";
import {
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type TextStyle,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  ZoomIn,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { withAlpha } from "@/design/palette";
import { color, layout, radius, shadow, space, type } from "@/design/tokens";
import { Aurora } from "@/world/aurora";
import { formingStatuses, worldPalette, type World } from "@/world/worlds";

type Stage = "queued" | "dreaming" | "painting" | "sculpting" | "arriving";

const steps = ["Dream", "Paint", "Sculpt", "Arrive"];
const stepIndex: Record<Stage, number> = {
  queued: 0,
  dreaming: 0,
  painting: 1,
  sculpting: 2,
  arriving: 3,
};
const expectedSeconds: Record<Stage, number> = {
  queued: 8,
  dreaming: 8,
  painting: 14,
  sculpting: 50,
  arriving: 6,
};

function stageOf(world: World): Stage {
  return world.status && formingStatuses.includes(world.status)
    ? (world.status as Stage)
    : "arriving";
}

function stageLabel(stage: Stage, progress: number | null) {
  switch (stage) {
    case "queued":
      return "Listening back to your day…";
    case "dreaming":
      return "Dreaming up your world…";
    case "painting":
      return "Painting the scene…";
    case "sculpting":
      return "Sculpting it in 3D…";
    case "arriving":
      return progress === null
        ? "Bringing it to life…"
        : `Bringing it to life… ${Math.round(progress * 100)}%`;
  }
}

export function WorldForming({
  world,
  progress,
  bottomInset,
}: {
  world: World;
  progress: number | null;
  /** Space to leave under the progress, when the host draws its own chrome there. */
  bottomInset?: number;
}) {
  const insets = useSafeAreaInsets();
  const stage = stageOf(world);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Aurora palette={worldPalette(world)} />
      <View
        style={[
          styles.content,
          {
            paddingTop: insets.top + 56,
            paddingBottom: Math.max(bottomInset ?? 0, insets.bottom + 28),
          },
        ]}
      >
        <View style={styles.center}>
          {world.imageUrl ? (
            <ConceptCard
              key={world.imageUrl}
              uri={world.imageUrl}
              lively={stage === "sculpting" || stage === "arriving"}
            />
          ) : world.title ? (
            <PaintingCard />
          ) : (
            <Transcript text={world.transcript} />
          )}
          {world.title ? (
            <Animated.View
              entering={FadeInDown.duration(700)}
              style={styles.titleBlock}
            >
              <Text style={styles.title} lineBreakStrategyIOS="standard">
                {world.title}
              </Text>
              {world.caption ? (
                <Text style={styles.caption}>{world.caption}</Text>
              ) : null}
            </Animated.View>
          ) : null}
        </View>
        <View style={styles.footer}>
          <Animated.Text
            key={stage}
            entering={FadeIn.duration(500)}
            style={styles.stage}
          >
            {stageLabel(stage, progress)}
          </Animated.Text>
          <StageTracker stage={stage} progress={progress} />
        </View>
      </View>
    </View>
  );
}

function Transcript({ text }: { text: string }) {
  const words = useMemo(() => text.trim().split(/\s+/), [text]);
  const wave = useSharedValue(-4);

  useEffect(() => {
    wave.set(
      withRepeat(
        withSequence(
          withTiming(words.length + 8, {
            duration: words.length * 140,
            easing: Easing.linear,
          }),
          withDelay(900, withTiming(-4, { duration: 0 })),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(wave);
  }, [wave, words.length]);

  return (
    <Animated.View entering={FadeIn.duration(900)} style={styles.transcript}>
      {words.map((word, index) => (
        <Word key={index} word={word} index={index} wave={wave} />
      ))}
    </Animated.View>
  );
}

function Word({
  word,
  index,
  wave,
}: {
  word: string;
  index: number;
  wave: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(
      wave.value - index,
      [-1, 0, 3, 9],
      [0.38, 1, 1, 0.62],
      "clamp",
    ),
  }));
  return <Animated.Text style={[styles.word, style]}>{word} </Animated.Text>;
}

function useCardSize() {
  const { width, height } = useWindowDimensions();
  return Math.min(width - 72, height * 0.4, 360);
}

function PaintingCard() {
  const size = useCardSize();
  return (
    <Animated.View
      entering={ZoomIn.duration(600)}
      style={[styles.card, styles.nacre, { width: size, height: size }]}
    >
      <Sweep size={size} duration={1700} />
    </Animated.View>
  );
}

function ConceptCard({ uri, lively }: { uri: string; lively: boolean }) {
  const size = useCardSize();
  const developed = useSharedValue(0);
  const tilt = useSharedValue(0);

  useEffect(() => {
    if (lively) {
      tilt.set(
        withRepeat(
          withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.sin) }),
          -1,
          true,
        ),
      );
    } else {
      tilt.set(withTiming(0.5, { duration: 600 }));
    }
  }, [lively, tilt]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 900 },
      { rotateY: `${interpolate(tilt.value, [0, 1], [-7, 7])}deg` },
      { rotateX: `${interpolate(tilt.value, [0, 0.5, 1], [3, -2, 3])}deg` },
      { translateY: interpolate(tilt.value, [0, 0.5, 1], [0, -6, 0]) },
      { scale: interpolate(developed.value, [0, 1], [1.04, 1]) },
    ],
  }));
  const blurStyle = useAnimatedStyle(() => ({ opacity: 1 - developed.value }));

  return (
    <Animated.View entering={ZoomIn.springify().damping(16)}>
      <Animated.View
        style={[
          styles.card,
          styles.nacre,
          { width: size, height: size },
          cardStyle,
        ]}
      >
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          onLoad={() => {
            developed.set(
              withTiming(1, {
                duration: 1400,
                easing: Easing.out(Easing.cubic),
              }),
            );
          }}
        />
        <Animated.View style={[StyleSheet.absoluteFill, blurStyle]}>
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            blurRadius={28}
          />
        </Animated.View>
        {lively ? <Sweep size={size} duration={2600} /> : null}
      </Animated.View>
    </Animated.View>
  );
}

function Sweep({ size, duration }: { size: number; duration: number }) {
  const position = useSharedValue(0);

  useEffect(() => {
    position.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 0 }),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(position);
  }, [position, duration]);

  const style = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          position.value,
          [0, 1],
          [-size * 1.2, size * 1.2],
        ),
      },
      { rotate: "18deg" },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.sweep,
        {
          width: size * 0.55,
          height: size * 1.8,
          top: -size * 0.4,
          left: size * 0.22,
        },
        style,
      ]}
    />
  );
}

function StageTracker({
  stage,
  progress,
}: {
  stage: Stage;
  progress: number | null;
}) {
  const active = stepIndex[stage];
  return (
    <View style={styles.tracker}>
      {steps.map((label, index) => (
        <View key={label} style={styles.step}>
          <View style={styles.track}>
            {index < active ? (
              <View style={[styles.fill, { width: "100%" }]} />
            ) : index === active ? (
              <ActiveFill
                key={stage}
                expected={expectedSeconds[stage]}
                progress={stage === "arriving" ? progress : null}
              />
            ) : null}
          </View>
          <Text
            style={[
              styles.stepLabel,
              index <= active && styles.stepLabelActive,
            ]}
          >
            {label}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ActiveFill({
  expected,
  progress,
}: {
  expected: number;
  progress: number | null;
}) {
  const fill = useSharedValue(0);

  useEffect(() => {
    fill.set(
      progress === null
        ? withTiming(0.88, {
            duration: expected * 1500,
            easing: Easing.out(Easing.cubic),
          })
        : withTiming(progress, { duration: 250 }),
    );
  }, [fill, expected, progress]);

  const style = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

  return <Animated.View style={[styles.fill, style]} />;
}

const light = (alpha: number) => withAlpha(color.paper, alpha);

const styles = StyleSheet.create({
  content: {
    alignSelf: "center",
    flex: 1,
    justifyContent: "space-between",
    maxWidth: layout.maxWidth,
    paddingHorizontal: space.xxl,
    width: "100%",
  },
  center: {
    alignItems: "center",
    flex: 1,
    gap: space.xxl,
    justifyContent: "center",
  },
  transcript: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  word: {
    ...type.quote,
  },
  card: {
    borderColor: color.hairline,
    borderCurve: "continuous",
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    // A bright inner rim inside the hairline, the way nacre catches light at its edge.
    boxShadow: `${shadow.float}, inset 0 0 0 1px ${light(0.6)}, inset 0 2px 1px -1px ${light(0.95)}`,
    overflow: "hidden",
  },
  nacre: {
    backgroundColor: color.pearlLight,
    backgroundImage: [
      `radial-gradient(circle at 26% 22%, ${light(0.95)} 0%, ${light(0)} 42%)`,
      `radial-gradient(circle at 82% 26%, ${color.lilac} 0%, ${withAlpha(color.lilac, 0)} 58%)`,
      `radial-gradient(circle at 78% 82%, ${color.blush} 0%, ${withAlpha(color.blush, 0)} 60%)`,
      `radial-gradient(circle at 18% 78%, ${color.mint} 0%, ${withAlpha(color.mint, 0)} 58%)`,
      `linear-gradient(150deg, ${color.pearlLight} 0%, ${color.champagne} 62%, ${color.pearlDeep} 100%)`,
    ].join(", "),
  },
  sweep: {
    backgroundImage: `linear-gradient(90deg, ${light(0)}, ${light(0.55)} 50%, ${light(0)})`,
    position: "absolute",
  },
  titleBlock: {
    alignItems: "center",
    gap: space.sm + space.xxs,
  },
  title: {
    ...type.title,
    textAlign: "center",
    // Web: no single-word last line in two-line names.
    textWrap: "balance",
  } as TextStyle,
  caption: {
    ...type.body,
    textAlign: "center",
  },
  footer: {
    gap: space.lg,
  },
  stage: {
    ...type.label,
    textAlign: "center",
  },
  tracker: {
    flexDirection: "row",
    gap: space.sm,
  },
  step: {
    flex: 1,
    gap: space.sm,
  },
  track: {
    backgroundColor: color.inkFaint,
    borderRadius: 1.5,
    height: 3,
    overflow: "hidden",
  },
  fill: {
    backgroundColor: color.ink,
    borderRadius: 1.5,
    height: 3,
  },
  stepLabel: {
    ...type.meta,
    textAlign: "center",
  },
  stepLabelActive: {
    color: color.ink,
  },
});
