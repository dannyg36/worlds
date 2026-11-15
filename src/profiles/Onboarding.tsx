import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { StyleSheet, Text, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "../../convex/_generated/api";
import { errorMessage } from "./invites";
import { Button, secondaryText, styles as ui, useSchemeColors } from "./ui";

/** First launch: a name is all a device profile needs. */
export function Onboarding({ inviteCode }: { inviteCode: string | null }) {
  const colors = useSchemeColors();
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
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <Text style={[styles.title, { color: colors.text }]}>
        Welcome to worlds
      </Text>
      <Text style={[ui.body, { color: colors.text }]}>
        {inviter
          ? `${inviter.name} invited you. Pick a name and you'll be friends.`
          : "What should your friends call you?"}
      </Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Your name"
        placeholderTextColor={secondaryText}
        accessibilityLabel="Your name"
        autoFocus
        autoCorrect={false}
        maxLength={30}
        returnKeyType="done"
        onSubmitEditing={canSave ? handleSave : undefined}
        style={[
          ui.input,
          {
            color: colors.text,
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Button
        title={saving ? "Saving…" : "Continue"}
        color={colors.primary}
        disabled={!canSave}
        onPress={handleSave}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    gap: 16,
    paddingHorizontal: 24,
    paddingTop: 48,
  },
  title: {
    fontSize: 34,
    fontWeight: "700",
  },
  error: {
    color: "#FF3B30",
    fontSize: 15,
  },
});
