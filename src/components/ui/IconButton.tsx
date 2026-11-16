import { Pressable, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { Icon, type IconName } from "@/components/Icon";
import { haptics } from "@/design/haptics";
import { color, shadow } from "@/design/tokens";
import { usePressScale } from "./press";
import { Surface } from "./Surface";

/**
 * paper: on the pearl page. frost: over imagery or a 3D world. ink: the active state.
 * plain: the glyph alone, for native headers that draw their own backing (iOS 26 glass).
 */
export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  size = 44,
  variant = "paper",
  tint,
}: {
  icon: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  size?: number;
  variant?: "paper" | "frost" | "ink" | "plain";
  tint?: string;
}) {
  const press = usePressScale(0.9);
  const shape = { width: size, height: size, borderRadius: size / 2 };
  const glyph = (
    <Icon name={icon} size={Math.round(size * 0.4)} tint={tint ?? (variant === "ink" ? color.onInk : color.ink)} />
  );

  return (
    <Animated.View style={press.style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        hitSlop={8}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onPress={() => {
          haptics.tap();
          onPress();
        }}
      >
        {variant === "frost" ? (
          <Surface variant="frost" radius={size / 2} style={[shape, styles.center]}>
            {glyph}
          </Surface>
        ) : (
          <View
            style={[shape, styles.center, variant === "ink" ? styles.ink : variant === "paper" ? styles.paper : null]}
          >
            {glyph}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  paper: {
    backgroundColor: color.paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairline,
    boxShadow: shadow.raised,
  },
  ink: {
    backgroundColor: color.ink,
    boxShadow: "0 10px 20px -12px rgba(0, 0, 0, 0.6)",
  },
});
