import { useMutation } from "convex/react";
import { useRouter, useTheme } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { StatusChip } from "@/world/status-chip";
import { WorldThumbnail } from "@/world/thumbnail";
import { useWorlds, worldDate, worldTitle } from "@/world/worlds";

import { api } from "../../convex/_generated/api";

export default function WorldsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const worlds = useWorlds();
  const addWorld = useMutation(api.worlds.add);
  const [transcript, setTranscript] = useState("");
  const [adding, setAdding] = useState(false);
  const canAdd = transcript.trim().length > 0 && !adding;

  async function handleAdd() {
    setAdding(true);
    try {
      await addWorld({ transcript });
      setTranscript((current) => (current === transcript ? "" : current));
    } catch (error) {
      Alert.alert(
        "Couldn't add your world",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setAdding(false);
    }
  }

  return (
    <FlatList
      data={worlds ?? []}
      keyExtractor={(world) => world._id}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={styles.content}
      ListHeaderComponent={
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <TextInput
            value={transcript}
            onChangeText={setTranscript}
            placeholder="What happened today?"
            placeholderTextColor={secondaryText}
            accessibilityLabel="Describe your day"
            multiline
            style={[styles.input, { color: colors.text }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canAdd }}
            disabled={!canAdd}
            onPress={handleAdd}
            style={[
              styles.button,
              { backgroundColor: colors.primary, opacity: canAdd ? 1 : 0.4 },
            ]}
          >
            <Text style={styles.buttonLabel}>
              {adding ? "Adding…" : "Add world"}
            </Text>
          </Pressable>
        </View>
      }
      ListEmptyComponent={
        worlds === undefined ? (
          <ActivityIndicator style={styles.empty} />
        ) : (
          <Text style={styles.empty}>
            No worlds yet. Describe your day to make the first one.
          </Text>
        )
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.push({ pathname: "/world/[id]", params: { id: item._id } })
          }
          style={({ pressed }) => [
            styles.card,
            styles.row,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <WorldThumbnail world={item} size={68} />
          <View style={styles.rowText}>
            <View style={styles.rowMeta}>
              <Text style={styles.date}>{worldDate(item)}</Text>
              <StatusChip status={item.status} />
            </View>
            <Text
              numberOfLines={1}
              style={[styles.title, { color: colors.text }]}
            >
              {worldTitle(item)}
            </Text>
            <Text numberOfLines={2} style={styles.subtitle}>
              {item.caption ?? item.transcript}
            </Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const secondaryText = "#8E8E93";

const styles = StyleSheet.create({
  content: {
    padding: 16,
    gap: 12,
  },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 12,
  },
  input: {
    minHeight: 72,
    fontSize: 17,
    lineHeight: 22,
    textAlignVertical: "top",
  },
  button: {
    alignItems: "center",
    borderRadius: 12,
    paddingVertical: 12,
  },
  buttonLabel: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
    padding: 12,
  },
  rowText: {
    flex: 1,
    gap: 3,
  },
  rowMeta: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  date: {
    color: secondaryText,
    fontSize: 13,
    fontWeight: "500",
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
  },
  subtitle: {
    color: secondaryText,
    fontSize: 15,
    lineHeight: 20,
  },
  empty: {
    color: secondaryText,
    marginTop: 24,
    textAlign: "center",
  },
});
