import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { withAlpha } from "@/world/color";
import type { WorldStatus } from "@/world/worlds";

const chips: Partial<Record<WorldStatus, { label: string; color: string }>> = {
  queued: { label: "Queued", color: "#8E8E93" },
  dreaming: { label: "Dreaming", color: "#AF52DE" },
  painting: { label: "Painting", color: "#FF9500" },
  sculpting: { label: "Sculpting", color: "#32ADE6" },
  failed: { label: "Failed", color: "#FF3B30" },
};

export function StatusChip({ status }: { status?: WorldStatus }) {
  const chip = status ? chips[status] : undefined;
  if (!chip) {
    return null;
  }
  return (
    <View
      accessibilityLabel={`Status: ${chip.label}`}
      style={[styles.chip, { backgroundColor: withAlpha(chip.color, 0.15) }]}
    >
      <Dot color={chip.color} pulsing={status !== "failed"} />
      <Text style={[styles.label, { color: chip.color }]}>{chip.label}</Text>
    </View>
  );
}

function Dot({ color, pulsing }: { color: string; pulsing: boolean }) {
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (pulsing) {
      pulse.set(
        withRepeat(
          withTiming(0.25, {
            duration: 900,
            easing: Easing.inOut(Easing.quad),
          }),
          -1,
          true,
        ),
      );
    }
  }, [pulse, pulsing]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: "center",
    borderRadius: 999,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  dot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
  },
});
