import { useEffect, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { layout, motion } from "@/design/tokens";

/**
 * The pearl: the one iridescent thing in the app, and how you start a world.
 * Its sheen turns slowly and it breathes while it waits.
 */
export function Pearl({
  size = layout.pearl,
  breathing = true,
  children,
}: {
  size?: number;
  breathing?: boolean;
  children?: ReactNode;
}) {
  const breath = useSharedValue(0);
  const turn = useSharedValue(0);

  useEffect(() => {
    if (!breathing) {
      breath.set(withTiming(0, { duration: 400 }));
      return;
    }
    breath.set(withRepeat(withTiming(1, { duration: motion.breathe, easing: Easing.inOut(Easing.sin) }), -1, true));
    turn.set(withRepeat(withTiming(1, { duration: 22000, easing: Easing.linear }), -1, false));
  }, [breathing, breath, turn]);

  const halo = useAnimatedStyle(() => ({
    opacity: 0.5 + breath.value * 0.5,
    transform: [{ scale: 0.92 + breath.value * 0.16 }],
  }));
  const body = useAnimatedStyle(() => ({ transform: [{ scale: 1 + breath.value * 0.025 }] }));
  const sheen = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360}deg` }] }));
  const round = { borderRadius: size / 2 };

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Animated.View
        pointerEvents="none"
        style={[styles.halo, { width: size * 2, height: size * 2, borderRadius: size }, halo]}
      />
      <Animated.View style={[{ width: size, height: size }, round, styles.shadow, body]}>
        <View style={[StyleSheet.absoluteFill, round, styles.body]} />
        <Animated.View style={[StyleSheet.absoluteFill, round, styles.nacre, sheen]} />
        <View style={[StyleSheet.absoluteFill, round, styles.specular]} />
        <View style={[StyleSheet.absoluteFill, round, styles.rim]} />
        <View style={[StyleSheet.absoluteFill, styles.center]}>{children}</View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  halo: {
    position: "absolute",
    backgroundImage:
      "radial-gradient(circle, rgba(226, 216, 246, 0.85) 0%, rgba(214, 236, 231, 0.4) 36%, rgba(243, 221, 227, 0) 68%)",
  },
  shadow: {
    boxShadow: "0 18px 30px -16px rgba(60, 50, 80, 0.5), 0 3px 8px -3px rgba(0, 0, 0, 0.1)",
  },
  body: {
    backgroundImage:
      "radial-gradient(circle at 38% 30%, #FFFFFF 0%, #FCFAF9 20%, #EFEBF0 50%, #DDD9E3 76%, #C9C5D2 100%)",
  },
  nacre: {
    backgroundImage: [
      "radial-gradient(circle at 78% 72%, rgba(240, 190, 206, 0.75) 0%, rgba(240, 190, 206, 0) 46%)",
      "radial-gradient(circle at 20% 76%, rgba(178, 226, 214, 0.75) 0%, rgba(178, 226, 214, 0) 46%)",
      "radial-gradient(circle at 82% 24%, rgba(204, 192, 244, 0.7) 0%, rgba(204, 192, 244, 0) 42%)",
      "radial-gradient(circle at 26% 20%, rgba(244, 226, 188, 0.55) 0%, rgba(244, 226, 188, 0) 40%)",
    ].join(", "),
  },
  specular: {
    backgroundImage:
      "radial-gradient(ellipse at 34% 24%, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0.65) 13%, rgba(255, 255, 255, 0) 36%)",
  },
  rim: {
    boxShadow: "inset 0 -4px 9px rgba(255, 255, 255, 0.8), inset 0 0 0 0.5px rgba(0, 0, 0, 0.07)",
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
});
