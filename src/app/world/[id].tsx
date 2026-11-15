import * as Haptics from "expo-haptics";
import { Stack, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Aurora } from "@/world/aurora";
import { auroraBase } from "@/world/color";
import { GlassCard } from "@/world/glass-card";
import { WorldForming } from "@/world/forming";
import IslandViewer from "@/world/island-viewer";
import WorldViewer from "@/world/viewer";
import {
  defaultPalette,
  isForming,
  useRetryWorld,
  useWorld,
  worldDate,
  worldPalette,
  worldTitle,
  type World,
} from "@/world/worlds";

const showStats = process.env.EXPO_PUBLIC_VIEWER_STATS === "1";

export default function WorldScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const world = useWorld(id);

  return (
    <>
      <StatusBar style="light" />
      {world ? (
        <WorldScene world={world} />
      ) : (
        <View
          style={[
            styles.screen,
            { backgroundColor: auroraBase(defaultPalette) },
          ]}
        >
          <Aurora palette={defaultPalette} />
          {world === undefined ? (
            <ActivityIndicator color="#FFFFFF" style={styles.loading} />
          ) : (
            <View style={styles.centerContent}>
              <Text style={styles.messageTitle}>This world isn’t here</Text>
              <Text style={styles.messageBody}>
                It may have been deleted, or the link is wrong.
              </Text>
            </View>
          )}
        </View>
      )}
    </>
  );
}

function WorldScene({ world }: { world: World }) {
  const insets = useSafeAreaInsets();
  const palette = worldPalette(world);
  const failed = world.status === "failed";
  const scene = failed ? undefined : world.scene;
  const modelUrl = failed || scene ? undefined : world.modelUrl;
  const source = scene ?? modelUrl;
  const [readySource, setReadySource] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    url: string;
    fraction: number;
  } | null>(null);
  const [modelError, setModelError] = useState<{
    source: string;
    message: string;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [walking, setWalking] = useState(false);
  const [cardHeight, setCardHeight] = useState(150);
  const sawForming = useRef(isForming(world));
  const viewerReady = source !== undefined && readySource === source;
  const errorMessage =
    modelError && modelError.source === source ? modelError.message : null;
  const showOverlay =
    !failed &&
    (scene !== undefined
      ? !viewerReady
      : isForming(world) || (modelUrl !== undefined && !viewerReady));
  const insetTop = insets.top + 52;
  const insetBottom = walking ? insets.bottom : insets.bottom + cardHeight + 16;

  async function handleReady() {
    setReadySource(source ?? null);
    if (sawForming.current) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }

  async function handleError(message: string) {
    if (source !== undefined) {
      setModelError({ source, message });
    }
  }

  useEffect(() => {
    if (isForming(world)) {
      sawForming.current = true;
    }
  }, [world]);

  if (failed) {
    return <FailedWorld world={world} />;
  }
  if (!source && !isForming(world)) {
    return <QuietWorld world={world} />;
  }

  return (
    <View style={[styles.screen, { backgroundColor: auroraBase(palette) }]}>
      <Stack.Screen
        options={{
          headerRight:
            viewerReady && modelUrl
            ? () => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={walking ? "Stop walking" : "Walk around"}
                  hitSlop={10}
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setWalking((current) => !current);
                  }}
                  style={styles.headerButton}
                >
                  <SymbolView
                    name={walking ? "xmark" : "figure.walk"}
                    size={20}
                    tintColor="#FFFFFF"
                    fallback={
                      <Text style={styles.headerFallback}>
                        {walking ? "Done" : "Walk"}
                      </Text>
                    }
                  />
                </Pressable>
              )
            : undefined,
        }}
      />
      {source ? (
        <View style={StyleSheet.absoluteFill}>
          {scene ? (
            <IslandViewer
              key={`island#${attempt}`}
              sceneJson={scene}
              insetTop={insetTop}
              insetBottom={insetBottom}
              onReady={handleReady}
              onError={handleError}
              dom={{
                style: { flex: 1, backgroundColor: auroraBase(palette) },
                scrollEnabled: false,
                bounces: false,
                contentInsetAdjustmentBehavior: "never",
                automaticallyAdjustContentInsets: false,
                onContentProcessDidTerminate: () =>
                  setAttempt((current) => current + 1),
              }}
            />
          ) : modelUrl ? (
            <WorldViewer
              key={`${modelUrl}#${attempt}`}
              modelUrl={modelUrl}
              palette={palette}
              insetTop={insetTop}
              insetBottom={insetBottom}
              walking={walking}
              showStats={showStats}
              onProgress={async (fraction) =>
                setProgress({ url: modelUrl, fraction })
              }
              onReady={handleReady}
              onError={handleError}
              onTap={async () => {
                void Haptics.selectionAsync();
              }}
              onWalkingChange={async (value) => setWalking(value)}
              dom={{
                style: { flex: 1, backgroundColor: auroraBase(palette) },
                scrollEnabled: false,
                bounces: false,
                contentInsetAdjustmentBehavior: "never",
                automaticallyAdjustContentInsets: false,
                onContentProcessDidTerminate: () =>
                  setAttempt((current) => current + 1),
              }}
            />
          ) : null}
          <InfoCard
            world={world}
            visible={viewerReady && !walking}
            bottom={insets.bottom + 8}
            onHeight={setCardHeight}
          />
          {viewerReady && walking ? <WalkHint top={insets.top + 60} /> : null}
        </View>
      ) : null}
      {showOverlay ? (
        <Animated.View
          exiting={FadeOut.duration(900)}
          style={StyleSheet.absoluteFill}
        >
          <WorldForming
            world={world}
            progress={
              progress && progress.url === modelUrl ? progress.fraction : null
            }
          />
          {errorMessage ? (
            <Animated.View
              entering={FadeIn}
              style={[styles.errorWrap, { bottom: insets.bottom + 120 }]}
            >
              <GlassCard style={styles.errorCard}>
                <Text style={styles.errorText}>{errorMessage}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setModelError(null);
                    setProgress(null);
                    setAttempt((current) => current + 1);
                  }}
                  style={styles.pillButton}
                >
                  <Text style={styles.pillLabel}>Try again</Text>
                </Pressable>
              </GlassCard>
            </Animated.View>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );
}

function InfoCard({
  world,
  visible,
  bottom,
  onHeight,
}: {
  world: World;
  visible: boolean;
  bottom: number;
  onHeight: (height: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = useSharedValue(0);

  useEffect(() => {
    shown.set(
      visible
        ? withDelay(700, withTiming(1, { duration: 600 }))
        : withTiming(0, { duration: 250 }),
    );
  }, [shown, visible]);

  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: (1 - shown.value) * 24 }],
  }));

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      onLayout={(event) => {
        if (!expanded) {
          onHeight(event.nativeEvent.layout.height);
        }
      }}
      style={[styles.cardWrap, { bottom }, style]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityHint={
          expanded ? "Hides what you said" : "Shows what you said"
        }
        onPress={() => setExpanded((current) => !current)}
      >
        <GlassCard interactive style={styles.infoCard}>
          <Text style={styles.infoDate}>{worldDate(world)}</Text>
          <Text style={styles.infoTitle}>{worldTitle(world)}</Text>
          {world.caption ? (
            <Text style={styles.infoCaption}>{world.caption}</Text>
          ) : null}
          {expanded ? (
            <ScrollView style={styles.infoScroll}>
              <Text style={styles.infoTranscript}>“{world.transcript}”</Text>
            </ScrollView>
          ) : null}
        </GlassCard>
      </Pressable>
    </Animated.View>
  );
}

function WalkHint({ top }: { top: number }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 4500);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) {
    return null;
  }
  return (
    <Animated.View
      entering={FadeIn.delay(1200)}
      exiting={FadeOut}
      pointerEvents="none"
      style={[styles.hintWrap, { top }]}
    >
      <GlassCard style={styles.hint}>
        <Text style={styles.hintText}>
          Drag to look around · tap a spot to walk there
        </Text>
      </GlassCard>
    </Animated.View>
  );
}

function FailedWorld({ world }: { world: World }) {
  const insets = useSafeAreaInsets();
  const retry = useRetryWorld();
  const [retrying, setRetrying] = useState(false);
  const palette = worldPalette(world);

  async function handleRetry() {
    setRetrying(true);
    try {
      await retry(world._id);
    } catch (error) {
      Alert.alert(
        "Couldn't retry this world",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setRetrying(false);
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: auroraBase(palette) }]}>
      <Aurora palette={palette} />
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[
          styles.centerContent,
          { paddingTop: insets.top + 72, paddingBottom: insets.bottom + 32 },
        ]}
      >
        <GlassCard style={styles.failCard}>
          <SymbolView name="cloud.drizzle.fill" size={36} tintColor="#FFFFFF" />
          <Text style={styles.failTitle}>This world didn’t form</Text>
          <Text style={styles.failBody}>
            {world.error ?? "Something went wrong while making it."}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: retrying }}
            disabled={retrying}
            onPress={handleRetry}
            style={[styles.pillButton, { opacity: retrying ? 0.7 : 1 }]}
          >
            {retrying ? (
              <ActivityIndicator color="#111111" />
            ) : (
              <Text style={styles.pillLabel}>Try again</Text>
            )}
          </Pressable>
        </GlassCard>
        <Text style={styles.quote}>“{world.transcript}”</Text>
      </ScrollView>
    </View>
  );
}

function QuietWorld({ world }: { world: World }) {
  const insets = useSafeAreaInsets();
  const palette = worldPalette(world);

  return (
    <View style={[styles.screen, { backgroundColor: auroraBase(palette) }]}>
      <Aurora palette={palette} />
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[
          styles.centerContent,
          { paddingTop: insets.top + 72, paddingBottom: insets.bottom + 32 },
        ]}
      >
        <Text style={styles.quietDate}>{worldDate(world)}</Text>
        <Text style={styles.quote}>“{world.transcript}”</Text>
        <Text style={styles.quietNote}>
          {world.status
            ? "This world doesn't have a 3D model."
            : "Saved before worlds could form."}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  loading: {
    flex: 1,
  },
  centerContent: {
    alignItems: "center",
    flexGrow: 1,
    gap: 24,
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  messageTitle: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "700",
  },
  messageBody: {
    color: "rgba(255, 255, 255, 0.72)",
    fontSize: 16,
    textAlign: "center",
  },
  headerButton: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
    minWidth: 36,
  },
  headerFallback: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
  cardWrap: {
    left: 12,
    position: "absolute",
    right: 12,
  },
  infoCard: {
    borderCurve: "continuous",
    borderRadius: 28,
    gap: 4,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  infoDate: {
    color: "rgba(255, 255, 255, 0.6)",
    fontSize: 13,
    fontWeight: "600",
  },
  infoTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  infoCaption: {
    color: "rgba(255, 255, 255, 0.78)",
    fontSize: 15,
    lineHeight: 20,
  },
  infoScroll: {
    marginTop: 8,
    maxHeight: 220,
  },
  infoTranscript: {
    color: "rgba(255, 255, 255, 0.9)",
    fontFamily: "Georgia",
    fontSize: 17,
    fontStyle: "italic",
    lineHeight: 25,
  },
  hintWrap: {
    alignItems: "center",
    left: 0,
    position: "absolute",
    right: 0,
  },
  hint: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  hintText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  errorWrap: {
    left: 20,
    position: "absolute",
    right: 20,
  },
  errorCard: {
    alignItems: "center",
    borderRadius: 24,
    gap: 14,
    padding: 18,
  },
  errorText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  failCard: {
    alignItems: "center",
    alignSelf: "stretch",
    borderCurve: "continuous",
    borderRadius: 32,
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 28,
  },
  failTitle: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
  },
  failBody: {
    color: "rgba(255, 255, 255, 0.75)",
    fontSize: 16,
    lineHeight: 22,
    textAlign: "center",
  },
  pillButton: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    marginTop: 8,
    minWidth: 160,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  pillLabel: {
    color: "#111111",
    fontSize: 17,
    fontWeight: "700",
  },
  quote: {
    color: "rgba(255, 255, 255, 0.85)",
    fontFamily: "Georgia",
    fontSize: 20,
    fontStyle: "italic",
    lineHeight: 30,
    textAlign: "center",
  },
  quietDate: {
    color: "rgba(255, 255, 255, 0.6)",
    fontSize: 14,
    fontWeight: "600",
  },
  quietNote: {
    color: "rgba(255, 255, 255, 0.6)",
    fontSize: 15,
    textAlign: "center",
  },
});
