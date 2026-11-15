import { useConvexConnectionState, useMutation } from "convex/react";
import { Asset } from "expo-asset";
import { useLocalSearchParams, useNavigation, useTheme } from "expo-router";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { type SpeechError, useSpeechToText } from "@/hooks/use-speech-to-text";
import { api } from "../../convex/_generated/api";

const MAX_SECONDS = 20;
const canRecord = Platform.OS !== "web";
const sampleClip = require("@/assets/audio/sample-day.wav");

const SPEECH_ERRORS: Record<
  SpeechError,
  { title: string; message: string; opensSettings?: boolean }
> = {
  "microphone-denied": {
    title: "Microphone access is off",
    message:
      "Turn on Microphone for worlds in Settings, or type your day instead.",
    opensSettings: true,
  },
  "speech-denied": {
    title: "Speech recognition is off",
    message:
      "Turn on Speech Recognition for worlds in Settings, or type your day instead.",
    opensSettings: true,
  },
  "no-speech": {
    title: "We didn't catch that",
    message:
      "Nothing came through. Try again a little closer to the mic, or type your day instead.",
  },
  network: {
    title: "No connection",
    message:
      "Speech recognition needs the internet right now. Check your connection, or type your day instead.",
  },
  unavailable: {
    title: "Speech recognition isn't available",
    message:
      "Check your connection and that Dictation is on in Settings, or type your day instead.",
  },
  interrupted: {
    title: "Recording stopped",
    message:
      "A call or another app took over the microphone. Try again when you're ready.",
  },
  failed: {
    title: "Couldn't listen",
    message:
      "Something went wrong with the microphone. Try again, or type your day instead.",
  },
};

const icons = {
  mic: { ios: "mic.fill", android: "mic", web: "mic" },
  stop: { ios: "stop.fill", android: "stop", web: "stop" },
  close: { ios: "xmark", android: "close", web: "close" },
  warning: {
    ios: "exclamationmark.triangle.fill",
    android: "warning",
    web: "warning",
  },
  sparkles: { ios: "sparkles", android: "auto_awesome", web: "auto_awesome" },
} satisfies Record<string, SymbolViewProps["name"]>;

const pulse = {
  from: { opacity: 0.45, transform: [{ scale: 1 }] },
  to: { opacity: 0, transform: [{ scale: 1.7 }] },
};

export default function RecordScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { bottom } = useSafeAreaInsets();
  const { source } = useLocalSearchParams<{ source?: string }>();
  const addWorld = useMutation(api.worlds.add);
  const { isWebSocketConnected } = useConvexConnectionState();
  const [draft, setDraft] = useState<string | null>(canRecord ? null : "");
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const speech = useSpeechToText({
    maxSeconds: MAX_SECONDS,
    onFinish: setDraft,
  });
  const usesSampleClip = source === "sample";
  const secondsLeft = Math.ceil(speech.remainingMs / 1000);
  const canCreate = !!draft?.trim() && isWebSocketConnected && !saving;

  async function record() {
    setDraft(null);
    setSaveFailed(false);
    const [clip] = usesSampleClip ? await Asset.loadAsync(sampleClip) : [];
    await speech.start(clip ? (clip.localUri ?? clip.uri) : undefined);
  }

  async function createWorld() {
    if (!draft) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      await addWorld({ transcript: draft });
      navigation.goBack();
    } catch {
      setSaveFailed(true);
      setSaving(false);
    }
  }

  const subtitle =
    draft === ""
      ? "Type a few lines about your day."
      : draft !== null
        ? "Check your words, then make your world."
        : speech.status === "idle"
          ? `Talk for up to ${MAX_SECONDS} seconds. We'll turn it into a world you can explore.`
          : "Listening. Tap stop when you're done.";

  return (
    <ScrollView
      style={{ backgroundColor: colors.card }}
      contentContainerStyle={[styles.container, { paddingBottom: bottom + 24 }]}
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.text }]}>
            Tell me about your day
          </Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={12}
          onPress={() => navigation.goBack()}
          style={[styles.closeButton, { backgroundColor: colors.background }]}
        >
          <SymbolView
            name={icons.close}
            size={14}
            weight="bold"
            tintColor={secondaryText}
          />
        </Pressable>
      </View>

      {usesSampleClip && draft === null && (
        <Text
          style={[
            styles.sampleBadge,
            { color: colors.primary, borderColor: colors.primary },
          ]}
        >
          Sample clip
        </Text>
      )}

      {draft === null && speech.error && (
        <Notice
          {...SPEECH_ERRORS[speech.error]}
          action={
            SPEECH_ERRORS[speech.error].opensSettings
              ? {
                  label: "Open Settings",
                  onPress: () => Linking.openSettings(),
                }
              : undefined
          }
        />
      )}

      {draft !== null ? (
        <>
          {!isWebSocketConnected && (
            <Notice
              title="You're offline"
              message="Connect to the internet to make your world. Your words will stay here."
            />
          )}
          {saveFailed && (
            <Notice
              title="Couldn't make your world"
              message="Something went wrong on our end. Try again in a moment."
            />
          )}
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="What happened today?"
            placeholderTextColor={secondaryText}
            accessibilityLabel="Your day"
            autoFocus={draft === ""}
            editable={!saving}
            multiline
            style={[
              styles.input,
              {
                color: colors.text,
                backgroundColor: colors.background,
                borderColor: colors.border,
              },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canCreate }}
            disabled={!canCreate}
            onPress={createWorld}
            style={[
              styles.primaryButton,
              { backgroundColor: colors.primary, opacity: canCreate ? 1 : 0.4 },
            ]}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <SymbolView name={icons.sparkles} size={18} tintColor="#FFFFFF" />
            )}
            <Text style={styles.primaryLabel}>
              {saving ? "Making your world…" : "Make my world"}
            </Text>
          </Pressable>
          {canRecord && (
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={record}
              style={styles.secondaryButton}
            >
              <SymbolView
                name={icons.mic}
                size={16}
                tintColor={colors.primary}
              />
              <Text style={[styles.secondaryLabel, { color: colors.primary }]}>
                Record again
              </Text>
            </Pressable>
          )}
        </>
      ) : speech.status === "idle" ? (
        <>
          <Text style={styles.prompt}>
            Where did you go? Who did you see? What stood out?
          </Text>
          <View style={styles.controls}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                usesSampleClip ? "Play the sample clip" : "Start recording"
              }
              onPress={record}
              style={[styles.roundButton, { backgroundColor: colors.primary }]}
            >
              <SymbolView name={icons.mic} size={34} tintColor="#FFFFFF" />
            </Pressable>
            <Text style={[styles.controlLabel, { color: colors.text }]}>
              {usesSampleClip ? "Tap to play the sample clip" : "Tap to talk"}
            </Text>
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setDraft("")}
            >
              <Text style={[styles.secondaryLabel, { color: colors.primary }]}>
                Type instead
              </Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Text
            style={[
              styles.transcript,
              { color: speech.transcript ? colors.text : secondaryText },
            ]}
          >
            {speech.transcript || "Listening…"}
          </Text>
          <View style={styles.controls}>
            <Text
              accessibilityLabel={`${secondsLeft} seconds left`}
              style={[styles.countdown, { color: colors.text }]}
            >
              0:{String(secondsLeft).padStart(2, "0")}
            </Text>
            <View style={[styles.track, { backgroundColor: colors.border }]}>
              <View
                style={[
                  styles.progress,
                  {
                    width: `${(speech.remainingMs / (MAX_SECONDS * 1000)) * 100}%`,
                  },
                ]}
              />
            </View>
            <View style={styles.roundButton}>
              {speech.status === "listening" && (
                <Animated.View
                  style={[
                    StyleSheet.absoluteFill,
                    styles.pulse,
                    {
                      animationName: pulse,
                      animationDuration: "1.4s",
                      animationIterationCount: "infinite",
                      animationTimingFunction: "ease-out",
                    },
                  ]}
                />
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Stop recording"
                disabled={speech.status !== "listening"}
                onPress={speech.stop}
                style={[styles.roundButton, styles.stopButton]}
              >
                {speech.status === "listening" ? (
                  <SymbolView name={icons.stop} size={28} tintColor="#FFFFFF" />
                ) : (
                  <ActivityIndicator color="#FFFFFF" />
                )}
              </Pressable>
            </View>
            <Text style={[styles.controlLabel, { color: colors.text }]}>
              {speech.status === "listening"
                ? "Tap to stop"
                : speech.status === "starting"
                  ? "Getting ready…"
                  : "Finishing up…"}
            </Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}

function Notice({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: { label: string; onPress: () => void };
}) {
  const { colors } = useTheme();

  return (
    <View accessibilityRole="alert" style={styles.notice}>
      <SymbolView name={icons.warning} size={18} tintColor={recordRed} />
      <View style={styles.noticeText}>
        <Text style={[styles.noticeTitle, { color: colors.text }]}>
          {title}
        </Text>
        <Text style={styles.noticeMessage}>{message}</Text>
        {action && (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={action.onPress}
          >
            <Text style={[styles.noticeAction, { color: colors.primary }]}>
              {action.label}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const secondaryText = "#8E8E93";
const recordRed = "#FF3B30";

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    gap: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  headerText: {
    flex: 1,
    gap: 6,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
  },
  subtitle: {
    color: secondaryText,
    fontSize: 15,
    lineHeight: 20,
  },
  closeButton: {
    alignItems: "center",
    justifyContent: "center",
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  sampleBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
    fontSize: 13,
    fontWeight: "600",
  },
  notice: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "rgba(255, 59, 48, 0.12)",
  },
  noticeText: {
    flex: 1,
    gap: 4,
  },
  noticeTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  noticeMessage: {
    color: secondaryText,
    fontSize: 15,
    lineHeight: 20,
  },
  noticeAction: {
    marginTop: 4,
    fontSize: 15,
    fontWeight: "600",
  },
  prompt: {
    color: secondaryText,
    fontSize: 22,
    lineHeight: 30,
  },
  transcript: {
    fontSize: 24,
    lineHeight: 32,
  },
  controls: {
    marginTop: "auto",
    alignItems: "center",
    gap: 14,
    paddingTop: 24,
  },
  roundButton: {
    alignItems: "center",
    justifyContent: "center",
    width: 84,
    height: 84,
    borderRadius: 42,
  },
  stopButton: {
    backgroundColor: recordRed,
  },
  pulse: {
    borderRadius: 42,
    backgroundColor: recordRed,
  },
  controlLabel: {
    fontSize: 15,
    fontWeight: "500",
  },
  countdown: {
    fontSize: 40,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  track: {
    alignSelf: "stretch",
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  progress: {
    height: "100%",
    backgroundColor: recordRed,
  },
  input: {
    minHeight: 160,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    fontSize: 20,
    lineHeight: 28,
    textAlignVertical: "top",
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 16,
  },
  primaryLabel: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
  },
  secondaryLabel: {
    fontSize: 17,
    fontWeight: "600",
  },
});
