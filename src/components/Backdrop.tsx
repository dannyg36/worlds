import { useEffect } from "react";
import { Image, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { withAlpha } from "@/design/palette";
import { color, motion } from "@/design/tokens";

/** Faint nacre light drifting over the page, like the inside of a shell. */
const blooms = [
  { tint: color.blush, x: 0.3, y: -0.28, size: 1.15, dx: -0.12, dy: 0.06, alpha: 0.7 },
  { tint: color.mint, x: -0.55, y: 0.38, size: 1.2, dx: 0.14, dy: -0.06, alpha: 0.55 },
  { tint: color.lilac, x: 0.25, y: 0.82, size: 1.05, dx: -0.1, dy: -0.08, alpha: 0.6 },
];

function Bloom({ bloom, index }: { bloom: (typeof blooms)[number]; index: number }) {
  const { width, height } = useWindowDimensions();
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(
      withRepeat(withTiming(1, { duration: motion.drift + index * 6000, easing: Easing.inOut(Easing.sin) }), -1, true),
    );
  }, [t, index]);
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: t.value * bloom.dx * width },
      { translateY: t.value * bloom.dy * height },
      { scale: 1 + t.value * 0.1 },
    ],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.bloom,
        {
          width: `${bloom.size * 100}%`,
          minWidth: 420 * bloom.size,
          aspectRatio: 1,
          left: `${bloom.x * 100}%`,
          top: `${bloom.y * 100}%`,
          backgroundImage: `radial-gradient(circle at 50% 50%, ${withAlpha(bloom.tint, bloom.alpha)} 0%, ${withAlpha(bloom.tint, 0)} 66%)`,
        },
        style,
      ]}
    />
  );
}

export function Backdrop() {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
      {blooms.map((bloom, i) => (
        <Bloom key={i} bloom={bloom} index={i} />
      ))}
      <Image
        source={require("@/assets/images/grain.png")}
        resizeMode="repeat"
        style={[StyleSheet.absoluteFill, styles.grain]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: "hidden",
    backgroundColor: color.pearl,
    backgroundImage: `linear-gradient(180deg, ${color.pearlLight} 0%, ${color.pearl} 45%, ${color.pearlDeep} 100%)`,
  },
  bloom: {
    position: "absolute",
    borderRadius: 9999,
  },
  grain: {
    opacity: 0.45,
    width: "100%",
    height: "100%",
  },
});
