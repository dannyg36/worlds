import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect";
import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

const glassAvailable = isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

export function GlassCard({
  children,
  style,
  interactive,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  interactive?: boolean;
}) {
  if (glassAvailable) {
    return (
      <GlassView isInteractive={interactive} colorScheme="dark" style={style}>
        {children}
      </GlassView>
    );
  }
  return <View style={[styles.fallback, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: "rgba(20, 18, 32, 0.78)",
    borderColor: "rgba(255, 255, 255, 0.14)",
    borderWidth: StyleSheet.hairlineWidth,
  },
});
