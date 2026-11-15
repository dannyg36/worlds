import { Image } from "expo-image";
import { useEffect, useMemo } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
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
        : `Bringing it to life · ${Math.round(progress * 100)}%`;
  }
}

export function WorldForming({
  world,
  progress,
}: {
  world: World;
  progress: number | null;
}) {
  const insets = useSafeAreaInsets();
  const stage = stageOf(world);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Aurora palette={worldPalette(world)} />
      <View
        style={[
          styles.content,
          { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 28 },
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
              <Text style={styles.title}>{world.title}</Text>
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
      style={[styles.card, styles.paintingCard, { width: size, height: size }]}
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
        style={[styles.card, { width: size, height: size }, cardStyle]}
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

const styles = StyleSheet.create({
  content: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: 28,
  },
  center: {
    alignItems: "center",
    flex: 1,
    gap: 28,
    justifyContent: "center",
  },
  transcript: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  word: {
    color: "#FFFFFF",
    fontFamily: "Georgia",
    fontSize: 22,
    fontStyle: "italic",
    lineHeight: 32,
  },
  card: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderColor: "rgba(255, 255, 255, 0.22)",
    borderCurve: "continuous",
    borderRadius: 32,
    borderWidth: StyleSheet.hairlineWidth,
    boxShadow: "0 24px 60px rgba(0, 0, 0, 0.45)",
    overflow: "hidden",
  },
  paintingCard: {
    backgroundImage:
      "linear-gradient(150deg, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0.04) 60%, rgba(255, 255, 255, 0.12))",
  },
  sweep: {
    backgroundImage:
      "linear-gradient(90deg, rgba(255, 255, 255, 0), rgba(255, 255, 255, 0.32) 50%, rgba(255, 255, 255, 0))",
    position: "absolute",
  },
  titleBlock: {
    alignItems: "center",
    gap: 8,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "700",
    letterSpacing: -0.4,
    textAlign: "center",
  },
  caption: {
    color: "rgba(255, 255, 255, 0.72)",
    fontSize: 16,
    lineHeight: 22,
    textAlign: "center",
  },
  footer: {
    gap: 16,
  },
  stage: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  tracker: {
    flexDirection: "row",
    gap: 8,
  },
  step: {
    flex: 1,
    gap: 8,
  },
  track: {
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    borderRadius: 2,
    height: 4,
    overflow: "hidden",
  },
  fill: {
    backgroundColor: "#FFFFFF",
    borderRadius: 2,
    height: 4,
  },
  stepLabel: {
    color: "rgba(255, 255, 255, 0.4)",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
  stepLabelActive: {
    color: "rgba(255, 255, 255, 0.9)",
  },
});
