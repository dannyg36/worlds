import { useMutation } from "convex/react";
import { router, Stack, useLocalSearchParams, useTheme } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { api } from "../../../convex/_generated/api";
import { describeInviteResult, errorMessage } from "../../profiles/invites";
import { Button, styles as ui } from "../../profiles/ui";

/** Opening worlds://invite/<code> makes you and the code's owner friends. */
export default function InviteScreen() {
  const { colors } = useTheme();
  const { code } = useLocalSearchParams<{ code: string }>();
  const acceptInvite = useMutation(api.friends.accept);
  const [message, setMessage] = useState<string | null>(null);

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
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "Invite" }} />
      {message === null ? (
        <ActivityIndicator />
      ) : (
        <Text style={[ui.body, styles.message, { color: colors.text }]}>
          {message}
        </Text>
      )}
      <Button
        title="See your feed"
        color={colors.primary}
        onPress={() => router.dismissTo("/")}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "center",
    gap: 24,
    padding: 24,
  },
  message: {
    textAlign: "center",
  },
});
