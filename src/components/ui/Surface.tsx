import { BlurView } from "expo-blur";
import type { ReactNode } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { color, radius as radii, shadow } from "@/design/tokens";

/**
 * paper: an opaque white sheet resting on the pearl page.
 * frost: translucent pearl for floating over imagery and 3D worlds.
 */
export function Surface({
  children,
  style,
  radius = radii.lg,
  variant = "paper",
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  variant?: "paper" | "frost";
}) {
  const shape = { borderRadius: radius, borderCurve: "continuous" as const };

  if (variant === "paper") {
    return <View style={[shape, styles.paper, style]}>{children}</View>;
  }

  return (
    <View style={[shape, styles.frost, style]}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, shape, styles.clip]}>
        {Platform.OS === "web" ? (
          <View style={[StyleSheet.absoluteFill, shape, styles.webFrost]} />
        ) : (
          <>
            <BlurView style={StyleSheet.absoluteFill} intensity={50} tint="light" />
            <View style={[StyleSheet.absoluteFill, styles.nativeFrost]} />
          </>
        )}
      </View>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, shape, styles.edge]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  paper: {
    backgroundColor: color.paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairline,
    boxShadow: shadow.raised,
  },
  frost: {
    boxShadow: shadow.raised,
  },
  clip: {
    overflow: "hidden",
  },
  webFrost: {
    backgroundColor: color.frost,
    backdropFilter: "blur(22px) saturate(140%)",
  } as ViewStyle,
  nativeFrost: {
    backgroundColor: "rgba(252, 251, 248, 0.55)",
  },
  edge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.7)",
  },
});
