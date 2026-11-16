import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Pearl } from "@/components/ui/Pearl";
import { color, font, space, type } from "@/design/tokens";
import { api } from "../../convex/_generated/api";
import { errorMessage } from "./invites";

/** First launch: a name is all a device profile needs. */
export function Onboarding({ inviteCode }: { inviteCode: string | null }) {
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollViewInstance>(null);
  const inviter = useQuery(
    api.friends.inviter,
    inviteCode ? { code: inviteCode } : "skip",
  );
  const createProfile = useMutation(api.profiles.create);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSave = name.trim().length > 0 && !saving;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await createProfile({ name, inviteCode: inviteCode ?? undefined });
    } catch (caught) {
      setError(errorMessage(caught));
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.screen}
    >
      <ScrollView
        ref={scroll}
        // When the keyboard shrinks the view, keep the name field and button in sight.
        onLayout={() => scroll.current?.scrollToEnd()}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + space.xxl,
            paddingBottom: insets.bottom + space.xl,
          },
        ]}
      >
        <View style={styles.column}>
          <Animated.View entering={FadeIn.duration(900)} style={styles.hero}>
            <Pearl size={104} />
            <View style={styles.intro}>
              <Text accessibilityRole="header" style={[type.display, styles.centered]}>
                Welcome to worlds
              </Text>
              <Text style={[type.body, styles.centered]}>
                Each night, tell it about your day. A minute later it&apos;s a
                little world you can walk around in.
              </Text>
            </View>
          </Animated.View>

          <View style={styles.form}>
            <Text style={[type.label, styles.centered]}>
              {inviter
                ? `${inviter.name} invited you.\nPick a name and you'll be friends.`
                : "What should your friends call you?"}
            </Text>
            <Field
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              accessibilityLabel="Your name"
              autoFocus
              autoCorrect={false}
              maxLength={30}
              returnKeyType="done"
              onSubmitEditing={canSave ? handleSave : undefined}
              style={styles.nameInput}
            />
            {error && (
              <Text style={[type.caption, styles.centered, styles.error]}>
                {error}
              </Text>
            )}
            <Button
              label="Continue"
              disabled={!canSave}
              loading={saving}
              onPress={handleSave}
              style={styles.continue}
            />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: space.xxl,
  },
  column: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    gap: space.xxxl + space.sm,
  },
  hero: {
    alignItems: "center",
    gap: space.xxl + space.sm,
  },
  intro: {
    gap: space.md,
  },
  centered: {
    textAlign: "center",
  },
  form: {
    gap: space.md,
  },
  nameInput: {
    fontFamily: font.serif,
    fontSize: 21,
    lineHeight: 26,
    minHeight: 26,
    textAlign: "center",
  },
  error: {
    color: color.danger,
  },
  continue: {
    marginTop: space.xs,
  },
});
