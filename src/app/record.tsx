import { useConvexConnectionState, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { Asset } from "expo-asset";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, type IconName } from "@/components/Icon";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field } from "@/components/ui/Field";
import { IconButton } from "@/components/ui/IconButton";
import { Pearl } from "@/components/ui/Pearl";
import { usePressScale } from "@/components/ui/press";
import { Surface } from "@/components/ui/Surface";
import { haptics } from "@/design/haptics";
import { withAlpha } from "@/design/palette";
import { color, font, layout, radius, space, type } from "@/design/tokens";
import { type SpeechError, useSpeechToText } from "@/hooks/use-speech-to-text";
import { isFixtureWorldId, retryFixtureWorld } from "@/world/fixtures";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

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
  mic: { ios: "mic.fill", web: "mic" },
  keyboard: { ios: "keyboard", web: "keyboard" },
  close: { ios: "xmark", web: "close" },
  warning: { ios: "exclamationmark.triangle.fill", web: "warning" },
  sparkles: { ios: "sparkles", web: "auto_awesome" },
} satisfies Record<string, IconName>;

const PEARL_SIZE = 132;
const STOP_SIZE = 84;
const ENTRY_LINE = 31;
const LIVE_LINE = 36;
// While you talk, only the newest lines show, so the stop button stays put.
const LIVE_LINES = 5;

const ripple = {
  from: { opacity: 0.7, transform: [{ scale: 1 }] },
  to: { opacity: 0, transform: [{ scale: 1.7 }] },
};

export default function RecordScreen() {
  const navigation = useNavigation();
  const { bottom } = useSafeAreaInsets();
  // With worldId, the sheet adds to today's world instead of starting a new one.
  const { source, worldId } = useLocalSearchParams<{ source?: string; worldId?: string }>();
  const addWorld = useMutation(api.worlds.add);
  const extendWorld = useMutation(api.worlds.extend);
  const adding = worldId !== undefined;
  const { isWebSocketConnected } = useConvexConnectionState();
  const [draft, setDraft] = useState<string | null>(canRecord ? null : "");
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const speech = useSpeechToText({
    maxSeconds: MAX_SECONDS,
    onFinish: setDraft,
  });
  const pearlPress = usePressScale(0.94);
  const stopPress = usePressScale(0.92);
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
      if (worldId && isFixtureWorldId(worldId)) {
        await retryFixtureWorld(worldId);
      } else if (worldId) {
        await extendWorld({ id: worldId as Id<"worlds">, transcript: draft });
      } else {
        await addWorld({ transcript: draft });
      }
      navigation.goBack();
    } catch (error) {
      // ConvexError carries a message meant for people, like "Today's world is full."
      setSaveMessage(error instanceof ConvexError ? String(error.data) : null);
      setSaveFailed(true);
      setSaving(false);
    }
  }

  const subtitle =
    draft === ""
      ? adding
        ? "Type what happened since."
        : "Type a few lines about your day."
      : draft !== null
        ? adding
          ? "Check your words, then add them to your world."
          : "Check your words, then make your world."
        : speech.status === "idle"
          ? adding
            ? `Talk for up to ${MAX_SECONDS} seconds. Your world will grow to hold it.`
            : `Talk for up to ${MAX_SECONDS} seconds. We'll turn it into a world you can explore.`
          : "Listening. Tap stop when you're done.";

  return (
    <ScrollView
      style={styles.sheet}
      contentContainerStyle={[
        styles.container,
        { paddingBottom: bottom + space.xxl },
      ]}
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text accessibilityRole="header" style={styles.title}>
            {adding ? "What else\nhappened?" : "Tell me about\nyour day"}
          </Text>
          <View style={styles.close}>
            <IconButton
              variant="paper"
              size={36}
              icon={icons.close}
              accessibilityLabel="Close"
              onPress={() => navigation.goBack()}
            />
          </View>
        </View>
        <Text style={type.body}>{subtitle}</Text>
      </View>

      {usesSampleClip && draft === null && <Chip label="Sample clip" />}

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
              title={adding ? "Couldn't add to your world" : "Couldn't make your world"}
              message={saveMessage ?? "Something went wrong on our end. Try again in a moment."}
            />
          )}
          <View style={styles.compose}>
            <Field
              value={draft}
              onChangeText={setDraft}
              placeholder="What happened today?"
              accessibilityLabel="Your day"
              autoFocus={draft === ""}
              editable={!saving}
              multiline
              style={styles.entry}
            />
            <View style={styles.actions}>
              <Button
                label={
                  adding
                    ? saving
                      ? "Adding to your world…"
                      : "Add to my world"
                    : saving
                      ? "Making your world…"
                      : "Make my world"
                }
                icon={icons.sparkles}
                loading={saving}
                disabled={!canCreate}
                onPress={createWorld}
              />
              {canRecord && (
                <Button
                  variant="quiet"
                  label="Record again"
                  icon={icons.mic}
                  disabled={saving}
                  onPress={record}
                />
              )}
            </View>
          </View>
        </>
      ) : speech.status === "idle" ? (
        <>
          <Text style={styles.prompts}>
            {"Where did you go?\nWho did you see?\nWhat stood out?"}
          </Text>
          <View style={styles.controls}>
            <Animated.View style={pearlPress.style}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  usesSampleClip ? "Play the sample clip" : "Start recording"
                }
                onPressIn={pearlPress.onPressIn}
                onPressOut={pearlPress.onPressOut}
                onPress={() => {
                  haptics.press();
                  record();
                }}
              >
                <Pearl size={PEARL_SIZE}>
                  <Icon
                    name={icons.mic}
                    size={38}
                    weight="medium"
                    tint={color.ink}
                  />
                </Pearl>
              </Pressable>
            </Animated.View>
            <Text style={[type.label, styles.hint]}>
              {usesSampleClip ? "Tap to play the sample clip" : "Tap to talk"}
            </Text>
            <Button
              variant="quiet"
              label="Type instead"
              icon={icons.keyboard}
              onPress={() => setDraft("")}
              style={styles.alternative}
            />
          </View>
        </>
      ) : (
        <>
          <View style={styles.live}>
            <Text
              style={[styles.transcript, !speech.transcript && styles.waiting]}
            >
              {speech.transcript || "Listening…"}
            </Text>
            <View style={styles.liveFade} />
          </View>
          <View style={styles.controls}>
            <Text
              accessibilityLabel={`${secondsLeft} seconds left`}
              style={styles.countdown}
            >
              0:{String(secondsLeft).padStart(2, "0")}
            </Text>
            <View style={styles.track}>
              <View
                style={[
                  styles.progress,
                  {
                    width: `${(speech.remainingMs / (MAX_SECONDS * 1000)) * 100}%`,
                  },
                ]}
              />
            </View>
            <View style={styles.stop}>
              {speech.status === "listening" &&
                [0, 1.2].map((delay) => (
                  <Animated.View
                    key={delay}
                    style={[
                      StyleSheet.absoluteFill,
                      styles.ripple,
                      {
                        animationName: ripple,
                        animationDuration: "2.4s",
                        animationDelay: `${delay}s`,
                        animationIterationCount: "infinite",
                        animationTimingFunction: "ease-out",
                      },
                    ]}
                  />
                ))}
              <Animated.View style={stopPress.style}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Stop recording"
                  disabled={speech.status !== "listening"}
                  onPressIn={stopPress.onPressIn}
                  onPressOut={stopPress.onPressOut}
                  onPress={speech.stop}
                  style={styles.stopButton}
                >
                  {speech.status === "listening" ? (
                    <View style={styles.stopGlyph} />
                  ) : (
                    <ActivityIndicator color={color.onInk} />
                  )}
                </Pressable>
              </Animated.View>
            </View>
            <Text style={[type.label, styles.hint]}>
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
  return (
    <Surface radius={radius.md} style={styles.notice}>
      <View accessibilityRole="alert" style={styles.noticeRow}>
        <View style={styles.noticeIcon}>
          <Icon name={icons.warning} size={16} tint={color.danger} />
        </View>
        <View style={styles.noticeText}>
          <Text style={type.label}>{title}</Text>
          <Text style={type.caption}>{message}</Text>
          {action && (
            <Button
              variant="quiet"
              size="small"
              label={action.label}
              onPress={action.onPress}
              style={styles.noticeAction}
            />
          )}
        </View>
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: color.pearl,
    backgroundImage: `linear-gradient(180deg, ${color.pearlLight} 0%, ${color.pearl} 100%)`,
  },
  container: {
    flexGrow: 1,
    width: "100%",
    maxWidth: layout.maxWidth,
    alignSelf: "center",
    paddingHorizontal: space.xl + space.xs,
    paddingTop: space.xxl + space.xs,
    gap: space.xxl,
  },
  header: {
    gap: space.md,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.lg,
  },
  title: {
    ...type.title,
    flex: 1,
  },
  close: {
    marginTop: 3,
  },
  prompts: {
    ...type.quote,
    color: color.inkSecondary,
  },
  controls: {
    marginTop: "auto",
    alignItems: "center",
    paddingTop: space.xxxl,
  },
  hint: {
    marginTop: space.xl,
  },
  alternative: {
    marginTop: space.sm,
  },
  live: {
    maxHeight: LIVE_LINE * LIVE_LINES,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  // Sits above the box until the text overflows, then softens the oldest line.
  liveFade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: LIVE_LINE * (LIVE_LINES - 1),
    height: LIVE_LINE,
    backgroundImage: `linear-gradient(180deg, ${color.pearlLight} 0%, ${withAlpha(color.pearlLight, 0)} 100%)`,
  },
  transcript: {
    flexShrink: 0,
    fontFamily: font.serifLight,
    fontSize: 26,
    lineHeight: LIVE_LINE,
    color: color.ink,
  },
  waiting: {
    fontFamily: font.serifLightItalic,
    color: color.inkTertiary,
  },
  countdown: {
    fontFamily: font.display,
    fontSize: 64,
    lineHeight: 72,
    letterSpacing: -1,
    color: color.ink,
    fontVariant: ["tabular-nums"],
  },
  track: {
    width: 200,
    height: 2,
    marginTop: space.md,
    borderRadius: 1,
    backgroundColor: color.inkFaint,
    overflow: "hidden",
  },
  progress: {
    height: "100%",
    backgroundColor: color.ink,
  },
  stop: {
    alignItems: "center",
    justifyContent: "center",
    width: STOP_SIZE,
    height: STOP_SIZE,
    marginTop: space.xxxl,
  },
  ripple: {
    borderRadius: STOP_SIZE / 2,
    backgroundColor: color.inkFaint,
  },
  stopButton: {
    alignItems: "center",
    justifyContent: "center",
    width: STOP_SIZE,
    height: STOP_SIZE,
    borderRadius: STOP_SIZE / 2,
    borderCurve: "continuous",
    backgroundColor: color.ink,
    boxShadow: "0 14px 28px -14px rgba(0, 0, 0, 0.6)",
  },
  stopGlyph: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderCurve: "continuous",
    backgroundColor: color.onInk,
  },
  compose: {
    gap: space.xl,
  },
  // Whole lines only, so text never shows sliced at the edge. Web can't
  // auto-grow, so it opens taller; native grows and keeps room for the keyboard.
  entry: {
    fontFamily: font.serifLight,
    fontSize: 21,
    lineHeight: ENTRY_LINE,
    minHeight: ENTRY_LINE * (Platform.OS === "web" ? 6 : 4),
    maxHeight: ENTRY_LINE * 8,
  },
  actions: {
    gap: space.xs,
  },
  notice: {
    padding: space.lg,
  },
  noticeRow: {
    flexDirection: "row",
    gap: space.md,
  },
  noticeIcon: {
    paddingTop: 2,
  },
  noticeText: {
    flex: 1,
    gap: space.xs,
  },
  // Lines the quiet button's label up with the message text.
  noticeAction: {
    alignSelf: "flex-start",
    marginTop: -space.xs,
    marginLeft: -(space.lg + 2),
    marginBottom: -space.sm,
  },
});
