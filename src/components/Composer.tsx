import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { haptics } from "@/design/haptics";
import { space, type } from "@/design/tokens";

export function Composer({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (transcript: string) => Promise<unknown>;
}) {
  const [transcript, setTranscript] = useState("");
  const [saving, setSaving] = useState(false);
  const canSubmit = transcript.trim().length > 0 && !saving;

  async function submit() {
    setSaving(true);
    try {
      await onSubmit(transcript);
      haptics.success();
      setTranscript((current) => (current === transcript ? "" : current));
      onClose();
    } catch (error) {
      haptics.error();
      Alert.alert("Couldn't make your world", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.head}>
        <Text style={type.meta}>Tonight</Text>
        <Text style={type.title}>How was your day?</Text>
        <Text style={type.caption}>Tell it like you would to a friend. A few sentences is plenty.</Text>
      </View>
      <Field
        value={transcript}
        onChangeText={setTranscript}
        placeholder="Woke up to rain, finally finished the deck, dumplings with Maya…"
        accessibilityLabel="Describe your day"
        multiline
        autoFocus
      />
      <Button
        variant="primary"
        label={saving ? "Making your world…" : "Make my world"}
        icon={{ ios: "sparkles", web: "auto_awesome" }}
        loading={saving}
        disabled={!canSubmit}
        onPress={submit}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: {
    gap: space.xs,
  },
});
