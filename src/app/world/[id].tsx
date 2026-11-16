import * as Haptics from "expo-haptics";
import { Stack, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconButton } from "@/components/ui/IconButton";
import { usePressScale } from "@/components/ui/press";
import { Surface } from "@/components/ui/Surface";
import { color, layout, radius, space, type } from "@/design/tokens";
import { Aurora } from "@/world/aurora";
import { auroraBase } from "@/world/color";
import { WorldStage } from "@/world/WorldStage";
import {
  defaultPalette,
  useWorld,
  worldDate,
  worldTitle,
  type World,
} from "@/world/worlds";

export default function WorldScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const world = useWorld(id);

  return (
    <>
      <StatusBar style="dark" />
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
            <ActivityIndicator color={color.ink} style={styles.loading} />
          ) : (
            <View style={styles.message}>
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
  const [walking, setWalking] = useState(false);
  const [viewerReady, setViewerReady] = useState(false);
  const [cardHeight, setCardHeight] = useState(150);
  const failed = world.status === "failed";
  // An island scene takes the model's place, and islands can't be walked.
  const hasModel = !failed && !world.scene && world.modelUrl !== undefined;
  const hasViewer = !failed && (world.scene !== undefined || world.modelUrl !== undefined);

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerRight: viewerReady && hasModel
            ? () => (
                <View style={styles.headerAction}>
                  <IconButton
                    // iOS 26 wraps header items in its own glass capsule, so iOS gets the bare glyph.
                    variant={Platform.OS === "ios" ? "plain" : "frost"}
                    icon={
                      walking
                        ? { ios: "xmark", web: "close" }
                        : { ios: "figure.walk", web: "directions_walk" }
                    }
                    accessibilityLabel={
                      walking ? "Stop walking" : "Walk around"
                    }
                    onPress={() => {
                      void Haptics.impactAsync(
                        Haptics.ImpactFeedbackStyle.Light,
                      );
                      setWalking((current) => !current);
                    }}
                  />
                </View>
              )
            : undefined,
        }}
      />
      <WorldStage
        world={world}
        chrome={{
          top: insets.top + 52,
          bottom: insets.bottom + cardHeight + 16,
          pageBottom: insets.bottom + 28,
        }}
        walking={walking}
        onWalkingChange={setWalking}
        onViewerReadyChange={setViewerReady}
      />
      {hasViewer ? (
        <InfoCard
          world={world}
          visible={viewerReady && !walking}
          bottom={Math.max(insets.bottom, space.md)}
          onHeight={setCardHeight}
        />
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
  const press = usePressScale(0.98);

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
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onPress={() => setExpanded((current) => !current)}
        style={styles.cardPressable}
      >
        <Animated.View style={press.style}>
          <Surface variant="frost" radius={radius.xl} style={styles.infoCard}>
            <Text style={styles.infoDate}>{worldDate(world)}</Text>
            <Text style={styles.infoTitle} lineBreakStrategyIOS="standard">
              {worldTitle(world)}
            </Text>
            {world.caption ? (
              <Text style={styles.infoCaption}>{world.caption}</Text>
            ) : null}
            {expanded ? (
              <ScrollView style={styles.infoScroll}>
                <Text style={styles.infoTranscript}>“{world.transcript}”</Text>
              </ScrollView>
            ) : null}
          </Surface>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  loading: {
    flex: 1,
  },
  message: {
    alignItems: "center",
    flex: 1,
    gap: space.sm,
    justifyContent: "center",
    paddingHorizontal: space.xxl,
  },
  messageTitle: {
    ...type.headline,
    textAlign: "center",
  },
  messageBody: {
    ...type.body,
    textAlign: "center",
  },
  headerAction: {
    // The web header gives custom items no end margin; native bars add their own.
    marginRight: Platform.OS === "web" ? space.md : 0,
  },
  cardWrap: {
    alignItems: "center",
    left: space.md,
    position: "absolute",
    right: space.md,
  },
  cardPressable: {
    maxWidth: layout.maxWidth,
    width: "100%",
  },
  infoCard: {
    gap: space.xs,
    paddingBottom: space.xl + space.xxs,
    paddingHorizontal: space.xl + space.xs,
    paddingTop: space.xl,
  },
  infoDate: {
    ...type.meta,
  },
  infoTitle: {
    ...type.headline,
    // Web: no single-word last line in two-line names.
    textWrap: "balance",
  } as TextStyle,
  infoCaption: {
    ...type.caption,
  },
  infoScroll: {
    marginTop: space.md,
    maxHeight: 220,
  },
  infoTranscript: {
    ...type.quote,
  },
});
