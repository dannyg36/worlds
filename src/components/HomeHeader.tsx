import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { IconButton } from "@/components/ui/IconButton";
import { space, type } from "@/design/tokens";

/** Today, set like the top of a journal page. */
export function HomeHeader({ count, onOpenFriends }: { count?: number; onOpenFriends?: () => void }) {
  const now = new Date();
  const weekday = now.toLocaleDateString(undefined, { weekday: "long" });
  const day = now.toLocaleDateString(undefined, { month: "long", day: "numeric" });
  return (
    <Animated.View entering={FadeIn.duration(800)} style={styles.wrap}>
      <View style={styles.row}>
        <Text style={[type.display, styles.date]} accessibilityRole="header">
          {weekday}
          {"\n"}
          {day}
        </Text>
        {onOpenFriends ? (
          <View style={styles.action}>
            <IconButton icon={{ ios: "person.2", web: "group" }} accessibilityLabel="Friends" onPress={onOpenFriends} />
          </View>
        ) : null}
      </View>
      {count ? (
        <Text style={type.caption}>
          {count} {count === 1 ? "world" : "worlds"} so far
        </Text>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.sm + 2,
    paddingTop: space.lg,
    paddingBottom: space.xs,
    paddingHorizontal: space.xxs,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space.md,
  },
  date: {
    flex: 1,
  },
  action: {
    paddingTop: space.xs,
  },
});
