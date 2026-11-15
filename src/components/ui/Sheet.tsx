import { BlurView } from "expo-blur";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import Animated, { FadeIn, SlideInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { color, layout, motion, radius, shadow, space } from "@/design/tokens";

/** A paper sheet that rises over a frosted pearl scrim. */
export function Sheet({
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
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={onClose}>
          {Platform.OS === "web" ? (
            <View style={[StyleSheet.absoluteFill, styles.webScrim]} />
          ) : (
            <BlurView style={StyleSheet.absoluteFill} intensity={24} tint="light">
              <View style={[StyleSheet.absoluteFill, styles.scrim]} />
            </BlurView>
          )}
        </Pressable>
        <View style={styles.dock} pointerEvents="box-none">
          <Animated.View
            entering={SlideInDown.springify().damping(motion.spring.damping).stiffness(motion.spring.stiffness)}
            style={[styles.sheetWrap, { paddingBottom: Math.max(insets.bottom, space.lg) }]}
          >
            <Animated.View entering={FadeIn.duration(240)} style={styles.sheet}>
              <View style={styles.grabber} />
              {children}
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
  scrim: {
    backgroundColor: color.scrim,
  },
  webScrim: {
    backgroundColor: color.scrim,
    backdropFilter: "blur(8px)",
  } as ViewStyle,
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
    backgroundColor: color.paper,
    borderRadius: radius.xl,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairline,
    boxShadow: shadow.float,
    padding: space.xl,
    paddingTop: space.md,
    gap: space.lg,
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: color.inkFaint,
  },
});
