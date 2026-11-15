import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { color, layout, radius, space, type } from "@/design/tokens";
import { Aurora } from "@/world/aurora";
import { auroraBase } from "@/world/color";
import { WorldForming } from "@/world/forming";
import WorldViewer from "@/world/viewer";
import { isForming, useRetryWorld, worldDate, worldPalette, type World } from "@/world/worlds";

const showStats = process.env.EXPO_PUBLIC_VIEWER_STATS === "1";

/**
 * How much of the screen the host's own chrome covers, so models and pages stay clear of it.
 * `bottom` frames the 3D model; `pageBottom` (defaults to `bottom`) keeps the forming
 * progress and the failed/quiet pages clear of chrome that stays visible while they show.
 */
export type StageChrome = { top: number; bottom: number; pageBottom?: number };

/**
 * A world, full screen: the 3D viewer once its model is ready, the forming
 * overlay while it takes shape, and calm pages for worlds that failed or never formed.
 * Hosts draw their own chrome (headers, cards, the pearl) on top.
 */
export function WorldStage({
  world,
  chrome,
  walking,
  onWalkingChange,
  onViewerReadyChange,
}: {
  world: World;
  chrome: StageChrome;
  walking: boolean;
  onWalkingChange: (walking: boolean) => void;
  onViewerReadyChange?: (ready: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const palette = worldPalette(world);
  const pageBottom = chrome.pageBottom ?? chrome.bottom;
  const failed = world.status === "failed";
  const modelUrl = failed ? undefined : world.modelUrl;
  const [readyUrl, setReadyUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ url: string; fraction: number } | null>(null);
  const [modelError, setModelError] = useState<{ url: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const sawForming = useRef(isForming(world));
  const viewerReady = modelUrl !== undefined && readyUrl === modelUrl;
  const errorMessage = modelError && modelError.url === modelUrl ? modelError.message : null;
  const showOverlay = !failed && (isForming(world) || (modelUrl !== undefined && !viewerReady));

  useEffect(() => {
    if (isForming(world)) {
      sawForming.current = true;
    }
  }, [world]);

  useEffect(() => {
    onViewerReadyChange?.(viewerReady);
  }, [onViewerReadyChange, viewerReady]);

  if (failed) {
    return <FailedWorld world={world} chrome={chrome} />;
  }
  if (!modelUrl && !isForming(world)) {
    return <QuietWorld world={world} chrome={chrome} />;
  }

  return (
    <View style={[styles.screen, { backgroundColor: auroraBase(palette) }]}>
      {modelUrl ? (
        <View style={StyleSheet.absoluteFill}>
          <WorldViewer
            key={`${modelUrl}#${attempt}`}
            modelUrl={modelUrl}
            palette={palette}
            insetTop={chrome.top}
            insetBottom={walking ? insets.bottom : chrome.bottom}
            walking={walking}
            showStats={showStats}
            onProgress={async (fraction) => setProgress({ url: modelUrl, fraction })}
            onReady={async () => {
              setReadyUrl(modelUrl);
              if (sawForming.current) {
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
            }}
            onError={async (message) => setModelError({ url: modelUrl, message })}
            onTap={async () => {
              void Haptics.selectionAsync();
            }}
            onWalkingChange={async (value) => onWalkingChange(value)}
            dom={{
              style: { flex: 1, backgroundColor: auroraBase(palette) },
              scrollEnabled: false,
              bounces: false,
              contentInsetAdjustmentBehavior: "never",
              automaticallyAdjustContentInsets: false,
              onContentProcessDidTerminate: () => setAttempt((current) => current + 1),
            }}
          />
          {viewerReady && walking ? <WalkHint top={chrome.top + space.sm} /> : null}
        </View>
      ) : null}
      {showOverlay ? (
        <Animated.View exiting={FadeOut.duration(900)} style={StyleSheet.absoluteFill}>
          <WorldForming
            world={world}
            progress={progress && progress.url === modelUrl ? progress.fraction : null}
            bottomInset={pageBottom}
          />
          {errorMessage ? (
            <Animated.View entering={FadeIn} style={[styles.errorWrap, { bottom: pageBottom }]}>
              <Surface radius={radius.xl} style={styles.errorCard}>
                <Text style={styles.errorText}>{errorMessage}</Text>
                <Button
                  label="Try again"
                  onPress={() => {
                    setModelError(null);
                    setProgress(null);
                    setAttempt((current) => current + 1);
                  }}
                />
              </Surface>
            </Animated.View>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
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
      <Surface variant="frost" radius={radius.pill} style={styles.hint}>
        <Text style={styles.hintText}>Drag to look around. Tap a spot to walk there.</Text>
      </Surface>
    </Animated.View>
  );
}

function FailedWorld({ world, chrome }: { world: World; chrome: StageChrome }) {
  const retry = useRetryWorld();
  const [retrying, setRetrying] = useState(false);
  const palette = worldPalette(world);

  async function handleRetry() {
    setRetrying(true);
    try {
      await retry(world._id);
    } catch (error) {
      Alert.alert("Couldn't retry this world", error instanceof Error ? error.message : String(error));
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
          styles.page,
          { paddingTop: chrome.top + space.xl, paddingBottom: (chrome.pageBottom ?? chrome.bottom) + space.lg },
        ]}
      >
        <Surface radius={radius.xl} style={styles.failCard}>
          <Icon name={{ ios: "cloud.drizzle", web: "cloud" }} size={30} tint={color.inkSecondary} weight="regular" />
          <View style={styles.failText}>
            <Text style={styles.failTitle}>This world didn’t form</Text>
            <Text style={styles.failBody}>{world.error ?? "Something went wrong while making it."}</Text>
          </View>
          <Button label="Try again" loading={retrying} onPress={handleRetry} style={styles.failButton} />
        </Surface>
        <Text style={[styles.quote, styles.failQuote]}>“{world.transcript}”</Text>
      </ScrollView>
    </View>
  );
}

function QuietWorld({ world, chrome }: { world: World; chrome: StageChrome }) {
  const palette = worldPalette(world);

  return (
    <View style={[styles.screen, { backgroundColor: auroraBase(palette) }]}>
      <Aurora palette={palette} />
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[
          styles.page,
          { paddingTop: chrome.top + space.xl, paddingBottom: (chrome.pageBottom ?? chrome.bottom) + space.lg },
        ]}
      >
        <Text style={styles.quietDate}>{worldDate(world)}</Text>
        <Text style={styles.quote}>“{world.transcript}”</Text>
        <Text style={styles.quietNote}>
          {world.status ? "This world doesn't have a 3D model." : "Saved before worlds could form."}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  page: {
    alignItems: "center",
    alignSelf: "center",
    flexGrow: 1,
    gap: space.xxl,
    justifyContent: "center",
    maxWidth: layout.maxWidth,
    paddingHorizontal: layout.gutter,
    width: "100%",
  },
  hintWrap: {
    alignItems: "center",
    left: 0,
    paddingHorizontal: layout.gutter,
    position: "absolute",
    right: 0,
  },
  hint: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm + space.xxs,
  },
  hintText: {
    ...type.caption,
    color: color.ink,
    textAlign: "center",
  },
  errorWrap: {
    alignItems: "center",
    left: layout.gutter,
    position: "absolute",
    right: layout.gutter,
  },
  errorCard: {
    alignItems: "center",
    gap: space.lg,
    // Wide enough to cover the forming progress it replaces.
    maxWidth: layout.maxWidth - 2 * layout.gutter,
    padding: space.xl + space.xs,
    width: "100%",
  },
  errorText: {
    ...type.label,
    textAlign: "center",
  },
  failCard: {
    alignItems: "center",
    alignSelf: "stretch",
    gap: space.lg,
    paddingBottom: space.xxl,
    paddingHorizontal: space.xxl,
    paddingTop: space.xxl + space.xs,
  },
  failText: {
    alignItems: "center",
    gap: space.sm,
  },
  failTitle: {
    ...type.headline,
    textAlign: "center",
  },
  failBody: {
    ...type.body,
    textAlign: "center",
  },
  failButton: {
    marginTop: space.sm,
    minWidth: 180,
  },
  quote: {
    ...type.quote,
    paddingHorizontal: space.sm,
    textAlign: "center",
  },
  failQuote: {
    color: color.inkSecondary,
  },
  quietDate: {
    ...type.meta,
  },
  quietNote: {
    ...type.caption,
    textAlign: "center",
  },
});
