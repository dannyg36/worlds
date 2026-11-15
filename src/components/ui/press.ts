import { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { motion } from "@/design/tokens";

export function usePressScale(to = 0.97) {
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
