import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { GlassChip } from "@/components/glass/GlassChip";
import { GlassIconButton } from "@/components/glass/GlassIconButton";
import { color, space, type } from "@/design/tokens";

export function HomeHeader({ count, onOpenFriends }: { count?: number; onOpenFriends?: () => void }) {
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  return (
    <Animated.View entering={FadeIn.duration(600)} style={styles.wrap}>
      <View style={styles.bar}>
        {count ? <GlassChip label={`${count} ${count === 1 ? "world" : "worlds"}`} dot={color.aurora} /> : <View />}
        {onOpenFriends ? (
          <GlassIconButton
            icon={{ ios: "person.2", web: "group" }}
            accessibilityLabel="Friends"
            onPress={onOpenFriends}
          />
        ) : null}
      </View>
      <Text style={type.eyebrow}>{today}</Text>
      <Text style={type.hero} accessibilityRole="header">
        Your <Text style={styles.italic}>worlds</Text>
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.sm,
    paddingBottom: space.xl,
  },
  bar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: space.lg,
    minHeight: 44,
  },
  italic: {
    fontFamily: "InstrumentSerif_400Regular_Italic",
    color: color.lilac,
  },
});
