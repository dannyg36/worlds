import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { GlassButton } from "@/components/glass/GlassButton";
import { GlassField } from "@/components/glass/GlassField";
import { GlassSheet } from "@/components/glass/GlassSheet";
import { Icon } from "@/components/Icon";
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
    <GlassSheet visible={visible} onClose={onClose}>
      <View style={styles.head}>
        <Text style={type.eyebrow}>Tonight</Text>
        <Text style={type.title}>How was your day?</Text>
        <Text style={type.caption}>Tell it like you would to a friend. A few sentences is plenty.</Text>
      </View>
      <GlassField
        value={transcript}
        onChangeText={setTranscript}
        placeholder="Woke up to rain, finally finished the deck, dumplings with Maya…"
        accessibilityLabel="Describe your day"
        multiline
        autoFocus
      />
      <GlassButton
        variant="primary"
        label={saving ? "Sending to the dream…" : "Make my world"}
        icon={<Icon name={{ ios: "sparkles", web: "auto_awesome" }} size={18} tint="#FFFFFF" />}
        disabled={!canSubmit}
        onPress={submit}
      />
    </GlassSheet>
  );
}

const styles = StyleSheet.create({
  head: {
    gap: space.xs,
  },
});
