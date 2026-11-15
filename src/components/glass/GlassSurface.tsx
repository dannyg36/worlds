import { BlurView } from "expo-blur";
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import type { ReactNode } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { blur, color, radius as radii } from "@/design/tokens";

const liquidGlass = Platform.OS === "ios" && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

export type GlassSurfaceProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  tint?: string;
  strong?: boolean;
  interactive?: boolean;
  hairline?: boolean;
};

export function GlassSurface({
  children,
  style,
  radius = radii.lg,
  tint,
  strong = false,
  interactive = false,
  hairline = true,
}: GlassSurfaceProps) {
  const shape = { borderRadius: radius, borderCurve: "continuous" as const };
  const fill = strong ? color.glassFillStrong : color.glassFill;

  return (
    <View style={[shape, styles.clip, style]}>
      {liquidGlass ? (
        <GlassView
          style={[StyleSheet.absoluteFill, shape]}
          glassEffectStyle="regular"
          colorScheme="dark"
          tintColor={tint ?? (strong ? "rgba(16, 12, 40, 0.5)" : color.glassTint)}
          isInteractive={interactive}
        />
      ) : Platform.OS === "web" ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            shape,
            {
              backgroundColor: fill,
              backdropFilter: `blur(${strong ? blur.strong : blur.regular}px) saturate(170%)`,
            } as ViewStyle,
          ]}
        />
      ) : (
        <>
          <BlurView
            style={StyleSheet.absoluteFill}
            intensity={strong ? 70 : 45}
            tint="systemUltraThinMaterialDark"
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: fill }]} />
        </>
      )}
      {tint && !liquidGlass ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, shape, { backgroundColor: tint }]} />
      ) : null}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, shape, styles.highlight]} />
      {hairline ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, shape, styles.hairline]} /> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: "hidden",
  },
  highlight: {
    backgroundImage: `linear-gradient(180deg, ${color.highlight} 0%, rgba(255,255,255,0) 38%)`,
  },
  hairline: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: color.hairline,
    borderTopColor: color.hairlineTop,
  },
});
