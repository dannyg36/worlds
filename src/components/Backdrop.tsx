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

const blooms = [
  { tint: color.violet, x: -0.35, y: -0.12, size: 1.25, dx: 0.18, dy: 0.08, alpha: 0.55 },
  { tint: color.aurora, x: 0.45, y: 0.22, size: 1.0, dx: -0.16, dy: 0.12, alpha: 0.32 },
  { tint: color.rose, x: -0.2, y: 0.62, size: 1.15, dx: 0.14, dy: -0.1, alpha: 0.34 },
];

const stars = Array.from({ length: 28 }, (_, i) => {
  const a = Math.sin(i * 12.9898) * 43758.5453;
  const b = Math.sin(i * 78.233) * 12543.123;
  return { x: a - Math.floor(a), y: (b - Math.floor(b)) * 0.7, s: i % 5 === 0 ? 2 : 1, o: 0.25 + ((i * 7) % 10) / 20 };
});

function Bloom({ bloom, index }: { bloom: (typeof blooms)[number]; index: number }) {
  const { width, height } = useWindowDimensions();
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withRepeat(
      withTiming(1, { duration: motion.drift + index * 5000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    ));
  }, [t, index]);
  const size = Math.max(width, 420) * bloom.size;
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: t.value * bloom.dx * width },
      { translateY: t.value * bloom.dy * height },
      { scale: 1 + t.value * 0.12 },
    ],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.bloom,
        {
          width: size,
          height: size,
          left: bloom.x * width,
          top: bloom.y * height,
          backgroundImage: `radial-gradient(circle at 50% 50%, ${withAlpha(bloom.tint, bloom.alpha)} 0%, ${withAlpha(bloom.tint, 0)} 68%)`,
        },
        style,
      ]}
    />
  );
}

export function Backdrop() {
  const { width, height } = useWindowDimensions();
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.base]}>
      {blooms.map((bloom, i) => (
        <Bloom key={i} bloom={bloom} index={i} />
      ))}
      {stars.map((star, i) => (
        <View
          key={i}
          style={[
            styles.star,
            { left: star.x * width, top: star.y * height, width: star.s, height: star.s, opacity: star.o },
          ]}
        />
      ))}
      <Image source={require("@/assets/images/grain.png")} resizeMode="repeat" style={[StyleSheet.absoluteFill, styles.grain]} />
      <View style={[StyleSheet.absoluteFill, styles.vignette]} />
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: "hidden",
    backgroundColor: color.night,
    backgroundImage: `linear-gradient(172deg, ${color.ink} 0%, ${color.night} 38%, ${color.dusk} 100%)`,
  },
  bloom: {
    position: "absolute",
    borderRadius: 9999,
  },
  star: {
    position: "absolute",
    borderRadius: 2,
    backgroundColor: "#FFFFFF",
  },
  grain: {
    opacity: 0.07,
    width: "100%",
    height: "100%",
  },
  vignette: {
    backgroundImage: "radial-gradient(ellipse at 50% 35%, rgba(0,0,0,0) 55%, rgba(2,2,10,0.55) 100%)",
  },
});
