import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { haptics } from "@/design/haptics";
import { color, motion, radius, space, type } from "@/design/tokens";
import { GlassSurface } from "./GlassSurface";

export function usePressScale(to = 0.96) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return {
    style,
    onPressIn: () => {
      scale.set(withSpring(to, motion.spring));
    },
    onPressOut: () => {
      scale.set(withSpring(1, motion.spring));
    },
  };
}

export function GlassButton({
  label,
  onPress,
  icon,
  variant = "glass",
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: ReactNode;
  variant?: "glass" | "primary";
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const press = usePressScale();
  const content = (
    <View style={styles.row}>
      {icon}
      <Text style={[type.label, variant === "primary" && styles.primaryLabel]}>{label}</Text>
    </View>
  );

  return (
    <Animated.View style={[press.style, { opacity: disabled ? 0.45 : 1 }, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onPress={() => {
          haptics.press();
          onPress();
        }}
      >
        {variant === "primary" ? (
          <View style={[styles.shape, styles.primary]}>
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.primarySheen]} />
            {content}
          </View>
        ) : (
          <GlassSurface radius={radius.pill} interactive style={styles.shape}>
            {content}
          </GlassSurface>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shape: {
    minHeight: 52,
    borderRadius: radius.pill,
    borderCurve: "continuous",
    paddingHorizontal: space.xxl,
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
  },
  primary: {
    overflow: "hidden",
    backgroundImage: `linear-gradient(120deg, ${color.violet} 0%, #6E8BFF 55%, ${color.aurora} 120%)`,
    boxShadow: `0 10px 34px -6px rgba(139, 108, 255, 0.75), inset 0 1px 0 rgba(255,255,255,0.45)`,
  },
  primarySheen: {
    backgroundImage: "linear-gradient(180deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0) 55%)",
  },
  primaryLabel: {
    color: "#FFFFFF",
    fontSize: 16,
  },
});
