import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { usePressScale } from "@/components/glass/GlassButton";
import { GlassSurface } from "@/components/glass/GlassSurface";
import { Icon } from "@/components/Icon";
import { haptics } from "@/design/haptics";
import { color, layout, motion, radius, space, type } from "@/design/tokens";

export function HeroOrb({ onPress, label = "Tell me about your day" }: { onPress: () => void; label?: string }) {
  const breath = useSharedValue(0);
  const press = usePressScale(0.9);
  useEffect(() => {
    breath.set(withRepeat(
      withTiming(1, { duration: motion.breathe, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    ));
  }, [breath]);
  const halo = useAnimatedStyle(() => ({
    opacity: 0.45 + breath.value * 0.5,
    transform: [{ scale: 1 + breath.value * 0.22 }],
  }));
  const core = useAnimatedStyle(() => ({
    transform: [{ scale: 0.92 + breath.value * 0.08 }],
  }));

  return (
    <Animated.View
      entering={FadeInUp.delay(250).springify().damping(motion.spring.damping)}
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
          <Animated.View pointerEvents="none" style={[styles.halo, halo]} />
          <View style={styles.orbShadow}>
            <GlassSurface radius={radius.pill} interactive style={styles.orb}>
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.core, core]} />
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.specular]} />
              <Icon name={{ ios: "waveform", web: "graphic_eq" }} size={28} weight="bold" />
            </GlassSurface>
          </View>
        </Pressable>
      </Animated.View>
      <Text style={styles.label}>{label}</Text>
    </Animated.View>
  );
}

const size = layout.orb;

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    gap: space.md,
  },
  hit: {
    width: size + 40,
    height: size + 40,
    alignItems: "center",
    justifyContent: "center",
  },
  halo: {
    position: "absolute",
    width: size + 70,
    height: size + 70,
    borderRadius: 999,
    backgroundImage: `radial-gradient(circle, rgba(160, 130, 255, 0.55) 0%, rgba(91, 227, 212, 0.18) 45%, rgba(139, 108, 255, 0) 70%)`,
  },
  orbShadow: {
    borderRadius: 999,
    boxShadow: "0 12px 40px -6px rgba(139, 108, 255, 0.85), 0 0 0 1px rgba(255,255,255,0.06)",
  },
  orb: {
    width: size,
    height: size,
    alignItems: "center",
    justifyContent: "center",
  },
  core: {
    borderRadius: 999,
    backgroundImage: `radial-gradient(circle at 50% 60%, rgba(201, 184, 255, 0.7) 0%, rgba(139, 108, 255, 0.55) 38%, rgba(91, 227, 212, 0.15) 70%, rgba(0,0,0,0) 100%)`,
  },
  specular: {
    borderRadius: 999,
    backgroundImage: "radial-gradient(ellipse at 35% 18%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 40%)",
  },
  label: {
    ...type.caption,
    color: color.textSecondary,
    letterSpacing: 0.3,
  },
});
