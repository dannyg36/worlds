import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { color, font, radius, shadow, space } from "@/design/tokens";
import { Surface } from "./Surface";

/**
 * A small status pill. `dot="nacre"` draws a tiny pearl, used for worlds that are still forming.
 */
export function Chip({
  label,
  dot,
  pulsing = false,
  variant = "paper",
}: {
  label: string;
  dot?: string;
  pulsing?: boolean;
  variant?: "paper" | "frost";
}) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.set(
      pulsing ? withRepeat(withTiming(0.45, { duration: 1100, easing: Easing.inOut(Easing.sin) }), -1, true) : 1,
    );
  }, [pulsing, pulse]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const content = (
    <View style={styles.row}>
      {dot ? (
        <Animated.View style={[styles.dot, dot === "nacre" ? styles.nacreDot : { backgroundColor: dot }, dotStyle]} />
      ) : null}
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );

  return variant === "frost" ? (
    <Surface variant="frost" radius={radius.pill} style={styles.chip}>
      {content}
    </Surface>
  ) : (
    <View style={[styles.chip, styles.paper]}>{content}</View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    borderCurve: "continuous",
    paddingHorizontal: space.md - 1,
    paddingVertical: 6,
  },
  paper: {
    backgroundColor: color.paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairline,
    boxShadow: shadow.raised,
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
  },
  nacreDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundImage:
      "radial-gradient(circle at 35% 30%, #FFFFFF 0%, #F3DDE3 35%, #D9D1F0 65%, #BFE0D8 100%)",
    boxShadow: "0 0 0 0.5px rgba(0, 0, 0, 0.12)",
  },
  label: {
    fontFamily: font.sansMedium,
    fontSize: 12.5,
    lineHeight: 16,
    letterSpacing: 0.1,
    color: color.ink,
  },
});
