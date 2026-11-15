import { BlurView } from "expo-blur";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, SlideInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { color, layout, motion, radius, space } from "@/design/tokens";
import { GlassSurface } from "./GlassSurface";

export function GlassSheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={onClose}>
          {Platform.OS === "web" ? (
            <View style={[StyleSheet.absoluteFill, styles.webScrim]} />
          ) : (
            <BlurView style={StyleSheet.absoluteFill} intensity={30} tint="dark">
              <View style={[StyleSheet.absoluteFill, { backgroundColor: color.scrim }]} />
            </BlurView>
          )}
        </Pressable>
        <View style={styles.dock} pointerEvents="box-none">
          <Animated.View
            entering={SlideInDown.springify().damping(motion.spring.damping).stiffness(motion.spring.stiffness)}
            style={[styles.sheetWrap, { paddingBottom: Math.max(insets.bottom, space.lg) }]}
          >
            <Animated.View entering={FadeIn.duration(240)}>
              <GlassSurface radius={radius.xl} strong style={styles.sheet}>
                <View style={styles.grabber} />
                {children}
              </GlassSurface>
            </Animated.View>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  webScrim: {
    backgroundColor: color.scrim,
    backdropFilter: "blur(10px)",
  } as object,
  dock: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  sheetWrap: {
    width: "100%",
    maxWidth: layout.maxWidth,
    paddingHorizontal: space.md,
  },
  sheet: {
    padding: space.xl,
    paddingTop: space.md,
    gap: space.lg,
    boxShadow: "0 -10px 60px -10px rgba(139, 108, 255, 0.35)",
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
});
