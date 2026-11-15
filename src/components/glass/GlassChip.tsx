import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { color, radius, space, type } from "@/design/tokens";
import { GlassSurface } from "./GlassSurface";

export function GlassChip({
  label,
  dot,
  pulsing = false,
}: {
  label: string;
  dot?: string;
  pulsing?: boolean;
}) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.set(pulsing
      ? withRepeat(withTiming(0.5, { duration: 900, easing: Easing.inOut(Easing.sin) }), -1, true)
      : 1);
  }, [pulsing, pulse]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <GlassSurface radius={radius.pill} strong style={styles.chip}>
      <View style={styles.row}>
        {dot ? (
          <Animated.View
            style={[styles.dot, { backgroundColor: dot, boxShadow: `0 0 10px 1px ${dot}` }, dotStyle]}
          />
        ) : null}
        <Text style={type.chip}>{label}</Text>
      </View>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: "flex-start",
    paddingHorizontal: space.md,
    paddingVertical: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: color.aurora,
  },
});
