import { Pressable, StyleSheet } from "react-native";
import Animated from "react-native-reanimated";

import { Icon, type IconName } from "@/components/Icon";
import { haptics } from "@/design/haptics";
import { radius } from "@/design/tokens";
import { usePressScale } from "./GlassButton";
import { GlassSurface } from "./GlassSurface";

export function GlassIconButton({
  icon,
  onPress,
  accessibilityLabel,
  size = 44,
  tint,
}: {
  icon: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  size?: number;
  tint?: string;
}) {
  const press = usePressScale(0.9);
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
        <GlassSurface radius={radius.pill} interactive style={[styles.button, { width: size, height: size }]}>
          <Icon name={icon} size={Math.round(size * 0.42)} tint={tint} />
        </GlassSurface>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    justifyContent: "center",
  },
});
