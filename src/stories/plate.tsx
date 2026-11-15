import { Image } from "expo-image";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { Pearl } from "@/components/ui/Pearl";
import { withAlpha, worldPalette } from "@/design/palette";
import { color, radius, shadow, space, type } from "@/design/tokens";
import { isForming, type World } from "@/world/worlds";

const plateRadius = radius.xl;

/**
 * A world as a square plate on the page: its art when it has some, a nacre wash
 * with a small pearl while it's still forming, or the words that made it on paper.
 */
export function WorldPlate({ world, size }: { world: World; size: number }) {
  const forming = isForming(world);
  return (
    <View style={[styles.shadow, { width: size, height: size }]}>
      <View style={styles.plate}>
        {world.imageUrl ? (
          <Image source={{ uri: world.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={400} />
        ) : forming ? (
          <Forming colors={worldPalette(world.palette)} pearl={Math.round(size * 0.19)} />
        ) : (
          <Note words={world.transcript} size={size} muted={world.status === "failed"} />
        )}
        {forming && world.imageUrl ? <Shimmer /> : null}
        <View style={[StyleSheet.absoluteFill, styles.edge]} />
      </View>
    </View>
  );
}

function Forming({ colors, pearl }: { colors: string[]; pearl: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withRepeat(withTiming(1, { duration: 6400, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [t]);
  const drift = useAnimatedStyle(() => ({
    transform: [{ scale: 1.15 + t.value * 0.2 }, { rotate: `${t.value * 24}deg` }],
  }));
  const [a, b, c = a] = colors;
  return (
    <View style={[StyleSheet.absoluteFill, styles.forming]}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundImage: [
              `radial-gradient(circle at 28% 30%, ${withAlpha(a, 0.4)} 0%, ${withAlpha(a, 0)} 58%)`,
              `radial-gradient(circle at 74% 64%, ${withAlpha(b, 0.34)} 0%, ${withAlpha(b, 0)} 55%)`,
              `radial-gradient(circle at 40% 90%, ${withAlpha(c, 0.3)} 0%, ${withAlpha(c, 0)} 50%)`,
            ].join(", "),
          },
          drift,
        ]}
      />
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Pearl size={pearl} />
      </View>
    </View>
  );
}

const note = { line: 34, top: space.huge, side: space.xxl + 4 };

function Note({ words, size, muted }: { words: string; size: number; muted: boolean }) {
  const lines = Math.max(3, Math.floor((size - note.top - note.side) / note.line));
  return (
    <View style={[StyleSheet.absoluteFill, styles.note, muted && styles.noteMuted]}>
      <Text style={[styles.noteWords, muted && styles.noteWordsMuted]} numberOfLines={lines}>
        “{words}”
      </Text>
    </View>
  );
}

function Shimmer() {
  const t = useSharedValue(-1);
  useEffect(() => {
    t.set(withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }), -1, false));
  }, [t]);
  const sweep = useAnimatedStyle(() => ({ transform: [{ translateX: `${t.value * 120}%` }] }));
  return (
    <View style={[StyleSheet.absoluteFill, styles.clip]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.shimmer, sweep]} />
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    borderRadius: plateRadius,
    borderCurve: "continuous",
    boxShadow: shadow.plate,
  },
  plate: {
    flex: 1,
    overflow: "hidden",
    borderRadius: plateRadius,
    borderCurve: "continuous",
    backgroundColor: color.pearlDeep,
  },
  edge: {
    pointerEvents: "none",
    borderRadius: plateRadius,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0, 0, 0, 0.07)",
  },
  forming: {
    backgroundColor: color.pearlLight,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  note: {
    justifyContent: "flex-end",
    backgroundColor: color.paper,
    paddingHorizontal: note.side,
    paddingTop: note.top,
    paddingBottom: note.side,
  },
  noteMuted: {
    backgroundColor: color.pearlLight,
    backgroundImage: `linear-gradient(160deg, ${color.pearlLight} 0%, ${color.pearl} 100%)`,
  },
  noteWords: {
    ...type.quote,
    fontSize: 24,
    lineHeight: note.line,
  },
  noteWordsMuted: {
    color: color.inkSecondary,
  },
  clip: {
    pointerEvents: "none",
    overflow: "hidden",
  },
  shimmer: {
    backgroundImage:
      "linear-gradient(100deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.32) 50%, rgba(255,255,255,0) 70%)",
  },
});
