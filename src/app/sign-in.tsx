import { useSSO } from "@clerk/expo";
import type { OAuthStrategy } from "@clerk/expo/types";
import * as AuthSession from "expo-auth-session";
import { useTheme } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

WebBrowser.maybeCompleteAuthSession();

const providers: { strategy: OAuthStrategy; label: string }[] = [
  { strategy: "oauth_apple", label: "Continue with Apple" },
  { strategy: "oauth_google", label: "Continue with Google" },
];

export default function SignInScreen() {
  const { colors, dark } = useTheme();
  const { startSSOFlow } = useSSO();
  const [pending, setPending] = useState<OAuthStrategy | null>(null);
  const apple = dark
    ? { background: "#FFFFFF", foreground: "#000000" }
    : { background: "#000000", foreground: "#FFFFFF" };

  async function signIn(strategy: OAuthStrategy) {
    setPending(strategy);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy,
        redirectUrl: AuthSession.makeRedirectUri({
          scheme: "worlds",
          path: "sso-callback",
        }),
      });
      if (createdSessionId) {
        await setActive?.({ session: createdSessionId });
      }
    } catch (error) {
      Alert.alert(
        "Couldn't sign you in",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <Text style={[styles.title, { color: colors.text }]}>Worlds</Text>
        <Text style={styles.tagline}>
          Talk about your day. Walk around in it.
        </Text>
      </View>
      <View style={styles.buttons}>
        {providers.map(({ strategy, label }) => {
          const isApple = strategy === "oauth_apple";
          return (
            <Pressable
              key={strategy}
              accessibilityRole="button"
              disabled={pending !== null}
              onPress={() => signIn(strategy)}
              style={[
                styles.button,
                isApple
                  ? { backgroundColor: apple.background }
                  : { backgroundColor: colors.card, borderColor: colors.border },
                { opacity: pending && pending !== strategy ? 0.5 : 1 },
              ]}
            >
              <Text
                style={[
                  styles.buttonLabel,
                  { color: isApple ? apple.foreground : colors.text },
                ]}
              >
                {pending === strategy ? "Opening…" : label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "space-between",
    padding: 24,
  },
  hero: {
    flex: 1,
    justifyContent: "center",
    gap: 8,
  },
  title: {
    fontSize: 44,
    fontWeight: "700",
  },
  tagline: {
    color: "#8E8E93",
    fontSize: 20,
    lineHeight: 26,
  },
  buttons: {
    gap: 12,
  },
  button: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
    paddingVertical: 16,
  },
  buttonLabel: {
    fontSize: 17,
    fontWeight: "600",
  },
});
