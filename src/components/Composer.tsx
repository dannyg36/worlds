import { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";

import { GlassButton } from "@/components/glass/GlassButton";
import { GlassSheet } from "@/components/glass/GlassSheet";
import { Icon } from "@/components/Icon";
import { haptics } from "@/design/haptics";
import { color, fontFamily, radius, space, type } from "@/design/tokens";

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
      <View style={styles.field}>
        <TextInput
          value={transcript}
          onChangeText={setTranscript}
          placeholder="Woke up to rain, finally finished the deck, dumplings with Maya…"
          placeholderTextColor={color.textTertiary}
          accessibilityLabel="Describe your day"
          multiline
          autoFocus
          keyboardAppearance="dark"
          selectionColor={color.lilac}
          style={styles.input}
        />
      </View>
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
  field: {
    borderRadius: radius.md,
    borderCurve: "continuous",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: color.hairline,
    padding: space.lg,
  },
  input: {
    minHeight: 120,
    maxHeight: 220,
    fontFamily: fontFamily.system,
    fontSize: 18,
    lineHeight: 26,
    color: color.text,
    textAlignVertical: "top",
    outlineStyle: "none",
  } as object,
});
