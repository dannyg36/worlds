import { Pressable, StyleSheet, Text } from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";

import { Icon } from "@/components/Icon";
import { Pearl } from "@/components/ui/Pearl";
import { usePressScale } from "@/components/ui/press";
import { haptics } from "@/design/haptics";
import { layout, motion, space, type } from "@/design/tokens";

/** The pearl that starts tonight's world. */
export function RecordPearl({ onPress, label = "Tell me about your day" }: { onPress: () => void; label?: string }) {
  const press = usePressScale(0.92);

  return (
    <Animated.View
      entering={FadeInUp.delay(350).springify().damping(motion.gentle.damping).stiffness(motion.gentle.stiffness)}
      style={styles.wrap}
      pointerEvents="box-none"
    >
      <Animated.View style={press.style}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          onPress={() => {
            haptics.press();
            onPress();
          }}
          style={styles.hit}
        >
          <Pearl size={layout.pearl}>
            <Icon name={{ ios: "waveform", web: "graphic_eq" }} size={24} weight="medium" tint="rgba(0, 0, 0, 0.8)" />
          </Pearl>
        </Pressable>
      </Animated.View>
      <Text style={type.label}>{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    gap: space.xs,
  },
  hit: {
    width: layout.pearl + 36,
    height: layout.pearl + 36,
    alignItems: "center",
    justifyContent: "center",
  },
});
