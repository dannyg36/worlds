import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";

import { Icon, type IconName } from "@/components/Icon";
import { haptics } from "@/design/haptics";
import { color, font, radius, shadow, space } from "@/design/tokens";
import { usePressScale } from "./press";

/**
 * primary: black pill, the one action on a screen.
 * secondary: white pill for the alternative.
 * quiet: text only, for low-stakes actions like "Type instead".
 */
export function Button({
  label,
  onPress,
  icon,
  variant = "primary",
  size = "regular",
  disabled = false,
  loading = false,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: "primary" | "secondary" | "quiet";
  size?: "regular" | "small";
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const press = usePressScale(0.97);
  const tint = variant === "primary" ? color.onInk : color.ink;
  const inactive = disabled || loading;

  return (
    <Animated.View style={[press.style, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: inactive, busy: loading }}
        disabled={inactive}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onPress={() => {
          if (variant === "primary") haptics.press();
          else haptics.tap();
          onPress();
        }}
        style={[styles.base, styles[size], styles[variant], disabled && !loading && styles.disabled]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={tint} />
        ) : icon ? (
          <Icon name={icon} size={size === "small" ? 15 : 17} tint={tint} />
        ) : null}
        <Text numberOfLines={1} style={[styles.label, size === "small" && styles.labelSmall, { color: tint }]}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    borderRadius: radius.pill,
    borderCurve: "continuous",
  },
  regular: {
    minHeight: 54,
    paddingHorizontal: space.xxl,
  },
  small: {
    minHeight: 40,
    paddingHorizontal: space.lg + 2,
  },
  primary: {
    backgroundColor: color.ink,
    boxShadow: "0 12px 24px -16px rgba(0, 0, 0, 0.7)",
  },
  secondary: {
    backgroundColor: color.paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairlineStrong,
    boxShadow: shadow.raised,
  },
  quiet: {
    backgroundColor: "transparent",
  },
  disabled: {
    opacity: 0.3,
  },
  label: {
    fontFamily: font.sansSemiBold,
    fontSize: 16,
    lineHeight: 20,
    letterSpacing: 0.1,
  },
  labelSmall: {
    fontSize: 14,
    lineHeight: 18,
  },
});
