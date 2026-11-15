import { Image } from "expo-image";
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { IconButton } from "@/components/ui/IconButton";
import { Pearl } from "@/components/ui/Pearl";
import { usePressScale } from "@/components/ui/press";
import { haptics } from "@/design/haptics";
import { withAlpha, worldPalette } from "@/design/palette";
import { color, motion, radius, shadow, space, type } from "@/design/tokens";

export type WorldStatus = "queued" | "dreaming" | "painting" | "sculpting" | "ready" | "failed";

const STATUS: Record<WorldStatus, { label: string; step: number }> = {
  queued: { label: "Waiting to dream", step: 0 },
  dreaming: { label: "Dreaming", step: 1 },
  painting: { label: "Painting", step: 2 },
  sculpting: { label: "Sculpting", step: 3 },
  ready: { label: "Ready", step: 4 },
  failed: { label: "Didn't form", step: 0 },
};

const STEPS = 4;

export type WorldCardProps = {
  date: number;
  title?: string;
  caption?: string;
  transcript?: string;
  status?: WorldStatus;
  image?: string | number;
  palette?: string[];
  error?: string;
  author?: string;
  shared?: boolean;
  onToggleShare?: () => void;
  onPress?: () => void;
  onRetry?: () => void;
  variant?: "hero" | "compact";
  index?: number;
};

export function formatWorldDate(date: number, long = true) {
  const d = new Date(date);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Tonight";
  if (d.toDateString() === yesterday.toDateString()) return "Last night";
  return d.toLocaleDateString(undefined, long ? { weekday: "long", month: "long", day: "numeric" } : { month: "short", day: "numeric" });
}

/**
 * A world on the page: its art as a plate, with the caption printed underneath
 * like a print in a book. Worlds without art yet get a nacre plate where a small
 * pearl is still forming; worlds that never formed keep the words that made them.
 */
export function WorldCard({
  date,
  title,
  caption,
  transcript,
  status,
  image,
  palette,
  error,
  author,
  shared,
  onToggleShare,
  onPress,
  onRetry,
  variant = "hero",
  index = 0,
}: WorldCardProps) {
  const hero = variant === "hero";
  const colors = worldPalette(palette);
  const forming = status !== undefined && status !== "ready" && status !== "failed";
  const failed = status === "failed";
  const meta = status ? STATUS[status] : undefined;
  const words = caption ?? transcript;
  const notePlate = image === undefined && !forming;
  const showWords = !!words && !notePlate && (hero || !title);
  const quoting = caption === undefined;
  const press = usePressScale(0.98);
  const plateRadius = hero ? radius.lg + 4 : radius.md + 2;

  const chip = failed ? (
    <Chip label={STATUS.failed.label} dot={color.danger} />
  ) : forming && meta ? (
    <Chip label={meta.label} dot="nacre" pulsing />
  ) : author ? (
    <Chip label={`from ${author}`} />
  ) : null;

  const share = onToggleShare ? (
    <IconButton
      size={hero ? 40 : 34}
      variant={shared ? "ink" : "paper"}
      icon={shared ? { ios: "person.2.fill", web: "group" } : { ios: "square.and.arrow.up", web: "ios_share" }}
      accessibilityLabel={shared ? "Stop sharing with friends" : "Share with friends"}
      onPress={onToggleShare}
    />
  ) : null;

  const entering = hero
    ? FadeInDown.delay(120).springify().damping(motion.gentle.damping).stiffness(motion.gentle.stiffness)
    : FadeIn.delay(Math.min(index, 8) * motion.stagger).duration(500);

  return (
    <Animated.View entering={entering} style={hero ? styles.wrapHero : styles.wrapCompact}>
      <Animated.View style={press.style}>
        <Pressable
          accessibilityRole={onPress ? "button" : undefined}
          disabled={!onPress}
          onPressIn={onPress ? press.onPressIn : undefined}
          onPressOut={onPress ? press.onPressOut : undefined}
          onPress={() => {
            haptics.tap();
            onPress?.();
          }}
        >
          <View style={[styles.plateShadow, { borderRadius: plateRadius }]}>
            <View style={[styles.plate, { borderRadius: plateRadius }]}>
              {image !== undefined ? (
                <Image source={image} style={StyleSheet.absoluteFill} contentFit="cover" transition={400} />
              ) : forming ? (
                <FormingPlate colors={colors} hero={hero} />
              ) : (
                <NotePlate words={words} hero={hero} muted={failed} />
              )}
              {status === "sculpting" && image !== undefined ? <Shimmer /> : null}
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.edge, { borderRadius: plateRadius }]} />
              {chip || share ? (
                <View style={[styles.plateTop, hero ? styles.plateTopHero : styles.plateTopCompact]}>
                  {chip ?? <View />}
                  {share}
                </View>
              ) : null}
            </View>
          </View>

          <View style={hero ? styles.captionHero : styles.captionCompact}>
            <Text style={type.meta} numberOfLines={1}>
              {formatWorldDate(date, hero)}
            </Text>
            {title ? (
              <Text style={hero ? type.headline : styles.titleCompact} numberOfLines={hero ? 3 : 2}>
                {title}
              </Text>
            ) : forming && hero ? (
              <Text style={[type.headline, styles.pending]}>Something is forming…</Text>
            ) : null}
            {showWords ? (
              <Text
                style={quoting ? (hero ? styles.quoteHero : styles.quoteCompact) : hero ? type.body : type.caption}
                numberOfLines={2}
              >
                {quoting ? `“${words}”` : words}
              </Text>
            ) : null}
            {hero && forming && meta ? <Progress step={meta.step} /> : null}
            {failed ? (
              <View style={styles.failed}>
                <Text style={[type.caption, styles.error]}>{error ?? "This world didn't take shape."}</Text>
                {onRetry ? (
                  <Button
                    variant="secondary"
                    size="small"
                    label="Try again"
                    icon={{ ios: "arrow.clockwise", web: "refresh" }}
                    onPress={onRetry}
                    style={styles.retry}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

function FormingPlate({ colors, hero }: { colors: string[]; hero: boolean }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withRepeat(withTiming(1, { duration: 6400, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [t]);
  const drift = useAnimatedStyle(() => ({
    transform: [{ scale: 1.15 + t.value * 0.2 }, { rotate: `${t.value * 24}deg` }],
  }));
  const [a, b, c = a] = colors;
  return (
    <View style={[StyleSheet.absoluteFill, styles.formingBase]}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundImage: [
              `radial-gradient(circle at 28% 30%, ${withAlpha(a, 0.4)} 0%, ${withAlpha(a, 0)} 58%)`,
              `radial-gradient(circle at 74% 64%, ${withAlpha(b, 0.34)} 0%, ${withAlpha(b, 0)} 55%)`,
              `radial-gradient(circle at 40% 90%, ${withAlpha(c, 0.3)} 0%, ${withAlpha(c, 0)} 50%)`,
            ].join(", "),
          },
          drift,
        ]}
      />
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Pearl size={hero ? 46 : 30} />
      </View>
    </View>
  );
}

function NotePlate({ words, hero, muted }: { words?: string; hero: boolean; muted: boolean }) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.note, hero ? styles.noteHero : styles.noteCompact, muted && styles.noteMuted]}>
      {words ? (
        <Text
          style={[hero ? styles.noteQuoteHero : styles.noteQuote, muted && styles.noteQuoteMuted]}
          numberOfLines={hero ? 7 : 5}
        >
          “{words}”
        </Text>
      ) : null}
    </View>
  );
}

function Shimmer() {
  const t = useSharedValue(-1);
  useEffect(() => {
    t.set(withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }), -1, false));
  }, [t]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: `${t.value * 120}%` }] }));
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.shimmer, style]} />
    </View>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <View style={styles.progress} accessibilityLabel={`Step ${Math.min(step + 1, STEPS)} of ${STEPS}`}>
      {Array.from({ length: STEPS }, (_, i) => (
        <View
          key={i}
          style={[styles.progressSeg, i < step && styles.progressDone, i === step && styles.progressNow]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapHero: {
    width: "100%",
  },
  wrapCompact: {
    flex: 1,
  },
  plateShadow: {
    boxShadow: shadow.plate,
    borderCurve: "continuous",
  },
  plate: {
    aspectRatio: 1,
    overflow: "hidden",
    borderCurve: "continuous",
    backgroundColor: color.pearlDeep,
  },
  edge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0, 0, 0, 0.07)",
  },
  plateTop: {
    position: "absolute",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  plateTopHero: {
    top: space.md + 2,
    left: space.md + 2,
    right: space.md + 2,
  },
  plateTopCompact: {
    top: space.sm,
    left: space.sm,
    right: space.sm,
  },
  captionHero: {
    paddingTop: space.lg,
    paddingHorizontal: space.xs,
    gap: space.xs + 2,
  },
  captionCompact: {
    paddingTop: space.md,
    paddingHorizontal: space.xxs,
    gap: space.xs,
  },
  titleCompact: {
    ...type.heading,
    fontSize: 18,
    lineHeight: 23,
  },
  pending: {
    color: color.inkSecondary,
  },
  quoteHero: {
    ...type.quote,
    fontSize: 18,
    lineHeight: 26,
    color: color.inkSecondary,
  },
  quoteCompact: {
    ...type.quote,
    fontSize: 15,
    lineHeight: 21,
    color: color.inkSecondary,
  },
  failed: {
    gap: space.md,
    paddingTop: space.xxs,
  },
  error: {
    color: color.inkSecondary,
  },
  retry: {
    alignSelf: "flex-start",
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  formingBase: {
    backgroundColor: color.pearlLight,
  },
  note: {
    backgroundColor: color.paper,
    justifyContent: "flex-end",
  },
  noteHero: {
    padding: space.xxl + 4,
    paddingTop: space.huge,
  },
  noteCompact: {
    padding: space.lg,
    paddingTop: space.xxxl + 6,
  },
  noteMuted: {
    backgroundColor: color.pearlLight,
    backgroundImage: `linear-gradient(160deg, ${color.pearlLight} 0%, ${color.pearl} 100%)`,
  },
  noteQuoteHero: {
    ...type.quote,
    fontSize: 26,
    lineHeight: 37,
  },
  noteQuote: {
    ...type.quote,
    fontSize: 15.5,
    lineHeight: 22,
  },
  noteQuoteMuted: {
    color: color.inkSecondary,
  },
  clip: {
    overflow: "hidden",
  },
  shimmer: {
    backgroundImage:
      "linear-gradient(100deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.32) 50%, rgba(255,255,255,0) 70%)",
  },
  progress: {
    flexDirection: "row",
    gap: 6,
    paddingTop: space.sm,
  },
  progressSeg: {
    flex: 1,
    height: 2,
    borderRadius: 1,
    backgroundColor: color.inkFaint,
  },
  progressDone: {
    backgroundColor: color.ink,
  },
  progressNow: {
    backgroundColor: "rgba(0, 0, 0, 0.32)",
  },
});
