import { useMutation, useQuery } from "convex/react";
import { Link, router, Stack, useTheme } from "expo-router";
import { SymbolView } from "expo-symbols";
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

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export default function WorldsScreen() {
  const { colors } = useTheme();
  const worlds = useQuery(api.feed.list);
  const addWorld = useMutation(api.worlds.add);
  const shareWorld = useMutation(api.sharing.share);
  const unshareWorld = useMutation(api.sharing.unshare);
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

  async function toggleShared(worldId: Id<"worlds">, shared: boolean) {
    try {
      await (shared ? unshareWorld : shareWorld)({ worldId });
    } catch (error) {
      Alert.alert(
        shared ? "Couldn't stop sharing" : "Couldn't share your world",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Link
              href="/friends"
              style={[styles.headerLink, { color: colors.primary }]}
            >
              Friends
            </Link>
          ),
        }}
      />
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
          <View
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={styles.date}>
              {item.mine ? "" : `${item.authorName} · `}
              {new Date(item._creationTime).toLocaleString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </Text>
            <Text style={[styles.transcript, { color: colors.text }]}>
              {item.transcript}
            </Text>
            {item.mine && (
              <View style={styles.shareRow}>
                <Text style={styles.date}>
                  {item.shared
                    ? "Shared with your friends"
                    : "Only you can see this"}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => toggleShared(item._id, item.shared)}
                >
                  <Text style={[styles.shareAction, { color: colors.primary }]}>
                    {item.shared ? "Unshare" : "Share"}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
      />
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/record")}
        style={[styles.recordButton, { backgroundColor: colors.primary }]}
      >
        <SymbolView
          name={{ ios: "mic.fill", android: "mic", web: "mic" }}
          size={20}
          tintColor="#FFFFFF"
        />
        <Text style={styles.buttonLabel}>Record your day</Text>
      </Pressable>
    </>
  );
}

const secondaryText = "#8E8E93";

const styles = StyleSheet.create({
  content: {
    padding: 16,
    paddingBottom: 120,
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
  recordButton: {
    position: "absolute",
    bottom: 40,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 16,
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.2)",
  },
  buttonLabel: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
  date: {
    color: secondaryText,
    fontSize: 13,
    fontWeight: "500",
  },
  transcript: {
    fontSize: 17,
    lineHeight: 24,
  },
  shareRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  shareAction: {
    fontSize: 15,
    fontWeight: "600",
  },
  headerLink: {
    fontSize: 17,
  },
  empty: {
    color: secondaryText,
    marginTop: 24,
    textAlign: "center",
  },
});
