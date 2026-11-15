import { Image } from "expo-image";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { isForming, worldPalette, type World } from "@/world/worlds";

export function WorldThumbnail({
  world,
  size,
}: {
  world: World;
  size: number;
}) {
  const palette = worldPalette(world);

  return (
    <View
      style={[
        styles.frame,
        {
          width: size,
          height: size,
          borderRadius: size * 0.26,
          backgroundImage: `linear-gradient(140deg, ${palette[palette.length - 1]}, ${palette[1]} 55%, ${palette[0]})`,
        },
      ]}
    >
      {world.imageUrl ? (
        <Image
          source={{ uri: world.imageUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={300}
        />
      ) : isForming(world) ? (
        <Shimmer />
      ) : null}
    </View>
  );
}

function Shimmer() {
  const glow = useSharedValue(0.15);

  useEffect(() => {
    glow.set(
      withRepeat(
        withTiming(0.55, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      ),
    );
  }, [glow]);

  const style = useAnimatedStyle(() => ({ opacity: glow.value }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.shimmer, style]} />
  );
}

const styles = StyleSheet.create({
  frame: {
    borderCurve: "continuous",
    overflow: "hidden",
  },
  shimmer: {
    backgroundColor: "#FFFFFF",
  },
});
