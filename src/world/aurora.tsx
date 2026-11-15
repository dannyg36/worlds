import { useEffect } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { lightness, mix, saturation, withAlpha } from "@/world/color";

const drifts = [
  { x: -0.35, y: -0.18, dx: 0.12, dy: 0.08, duration: 9000 },
  { x: 0.4, y: 0.22, dx: -0.1, dy: 0.1, duration: 11500 },
  { x: -0.2, y: 0.62, dx: 0.14, dy: -0.07, duration: 13500 },
];

export function auroraBase(palette: string[]) {
  const darkest = [...palette].sort((a, b) => lightness(a) - lightness(b))[0];
  return mix(darkest, "#05040C", 0.6);
}

export function Aurora({ palette }: { palette: string[] }) {
  const glows = [...palette]
    .sort(
      (a, b) => saturation(b) + lightness(b) - (saturation(a) + lightness(a)),
    )
    .slice(0, 3);

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.root]}>
      <Animated.View
        key={palette.join(",")}
        entering={FadeIn.duration(1400)}
        exiting={FadeOut.duration(1400)}
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: auroraBase(palette) },
        ]}
      >
        {glows.map((color, index) => (
          <Glow key={index} color={color} index={index} />
        ))}
      </Animated.View>
    </View>
  );
}

function Glow({ color, index }: { color: string; index: number }) {
  const { width, height } = useWindowDimensions();
  const drift = drifts[index % drifts.length];
  const phase = useSharedValue(0);
  const size = width * 1.45;

  useEffect(() => {
    phase.set(
      withRepeat(
        withTiming(1, {
          duration: drift.duration,
          easing: Easing.inOut(Easing.sin),
        }),
        -1,
        true,
      ),
    );
  }, [phase, drift.duration]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: drift.dx * width * phase.value },
      { translateY: drift.dy * height * phase.value },
      { scale: 1 + 0.12 * phase.value },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.glow,
        {
          width: size,
          height: size,
          left: width / 2 + drift.x * width - size / 2,
          top: height / 2 + drift.y * height - size / 2 - height * 0.15,
          backgroundImage: `radial-gradient(circle at center, ${withAlpha(color, 0.55)} 0%, ${withAlpha(color, 0.18)} 38%, ${withAlpha(color, 0)} 70%)`,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: "#05040C",
    overflow: "hidden",
  },
  glow: {
    position: "absolute",
    borderRadius: 9999,
  },
});
