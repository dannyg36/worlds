import { useMutation } from "convex/react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { Pearl } from "@/components/ui/Pearl";
import { layout, space, type } from "@/design/tokens";
import { api } from "../../../convex/_generated/api";
import { describeInviteResult, errorMessage } from "../../profiles/invites";

/** Opening worlds://invite/<code> makes you and the code's owner friends. */
export default function InviteScreen() {
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { code } = useLocalSearchParams<{ code: string }>();
  const acceptInvite = useMutation(api.friends.accept);
  const [message, setMessage] = useState<string | null>(null);
  const accepting = message === null;

  useEffect(() => {
    let active = true;
    acceptInvite({ code }).then(
      (result) => {
        if (active) setMessage(describeInviteResult(result));
      },
      (error) => {
        if (active) setMessage(errorMessage(error));
      },
    );
    return () => {
      active = false;
    };
  }, [acceptInvite, code]);

  return (
    <View
      style={[
        styles.screen,
        { paddingTop: headerHeight, paddingBottom: insets.bottom + space.xl },
      ]}
    >
      <Stack.Screen options={{ title: "Invite", headerTitle: "" }} />
      <View style={styles.center}>
        <View
          accessible={accepting}
          accessibilityRole={accepting ? "progressbar" : undefined}
          accessibilityLabel={accepting ? "Accepting invite" : undefined}
        >
          <Pearl size={64} breathing={accepting} />
        </View>
        <View style={styles.message}>
          {message !== null && (
            <Animated.Text
              entering={FadeIn.duration(700)}
              accessibilityLiveRegion="polite"
              style={[type.headline, styles.messageText]}
            >
              {message}
            </Animated.Text>
          )}
        </View>
      </View>
      <Button
        label="See your feed"
        onPress={() => router.dismissTo("/")}
        style={styles.button}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: layout.gutter,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space.xxl + space.xs,
  },
  message: {
    width: "100%",
    maxWidth: 420,
    minHeight: type.headline.lineHeight * 3,
  },
  messageText: {
    textAlign: "center",
  },
  button: {
    width: "100%",
    maxWidth: layout.maxWidth,
    alignSelf: "center",
  },
});
