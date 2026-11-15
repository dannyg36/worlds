import { Image } from "expo-image";
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { GlassButton, usePressScale } from "@/components/glass/GlassButton";
import { GlassChip } from "@/components/glass/GlassChip";
import { GlassIconButton } from "@/components/glass/GlassIconButton";
import { GlassSurface } from "@/components/glass/GlassSurface";
import { haptics } from "@/design/haptics";
import { withAlpha, worldPalette } from "@/design/palette";
import { color, motion, radius, space, type } from "@/design/tokens";

export type WorldStatus = "queued" | "dreaming" | "painting" | "sculpting" | "ready" | "failed";

const STATUS: Record<WorldStatus, { label: string; dot: string; step: number }> = {
  queued: { label: "Waiting to dream", dot: color.mist, step: 0 },
  dreaming: { label: "Dreaming", dot: color.mint, step: 1 },
  painting: { label: "Painting", dot: color.mint, step: 2 },
  sculpting: { label: "Sculpting", dot: color.mint, step: 3 },
  ready: { label: "Ready", dot: color.mint, step: 4 },
  failed: { label: "Didn't form", dot: color.danger, step: 0 },
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
  return d.toLocaleDateString(undefined, long ? { weekday: "short", month: "short", day: "numeric" } : { month: "short", day: "numeric" });
}

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
  const colors = worldPalette(palette);
  const glow = colors[0];
  const hero = variant === "hero";
  const forming = status !== undefined && status !== "ready" && status !== "failed";
  const meta = status ? STATUS[status] : undefined;
  const press = usePressScale(0.975);
  const showArt = image !== undefined || forming;
  const words = caption ?? transcript;
  const chip =
    meta && status !== "ready" ? (
      <GlassChip label={meta.label} dot={meta.dot} pulsing={forming} />
    ) : author && !hero ? (
      <GlassChip label={`from ${author}`} dot={color.lilac} />
    ) : null;
  const share = onToggleShare ? (
    <GlassIconButton
      size={hero ? 38 : 32}
      icon={shared ? { ios: "person.2.fill", web: "group" } : { ios: "square.and.arrow.up", web: "ios_share" }}
      tint={shared ? color.aurora : color.text}
      accessibilityLabel={shared ? "Stop sharing with friends" : "Share with friends"}
      onPress={onToggleShare}
    />
  ) : null;

  const details = (
    <>
      <View style={styles.metaRow}>
        <Text style={type.eyebrow} numberOfLines={1}>
          {formatWorldDate(date, hero)}
        </Text>
        {author && hero ? (
          <>
            <View style={styles.metaDot} />
            <Text style={[type.eyebrow, styles.author]} numberOfLines={1}>
              from {author}
            </Text>
          </>
        ) : null}
      </View>
      {title ? (
        <Text style={hero ? type.cardTitle : type.cardTitleCompact} numberOfLines={2}>
          {title}
        </Text>
      ) : showArt ? (
        hero || !words ? (
          <Text style={[hero ? type.cardTitle : type.cardTitleCompact, styles.untitled]}>Something is forming…</Text>
        ) : null
      ) : words ? (
        <Text style={[styles.quote, !hero && styles.quoteCompact]} numberOfLines={hero ? 5 : 5}>
          “{words}”
        </Text>
      ) : null}
      {words && showArt && (hero || !title) ? (
        <Text style={hero ? type.body : type.caption} numberOfLines={2}>
          {words}
        </Text>
      ) : null}
      {status === "failed" ? (
        <View style={styles.failed}>
          <Text style={[type.caption, { color: color.danger }]}>
            {error ?? "This world didn't take shape."}
          </Text>
          {onRetry ? <GlassButton label="Try again" onPress={onRetry} style={styles.retry} /> : null}
        </View>
      ) : null}
    </>
  );

  return (
    <Animated.View
      entering={FadeInDown.delay(Math.min(index, 8) * motion.stagger)
        .springify()
        .damping(motion.spring.damping)
        .stiffness(motion.spring.stiffness)}
      style={[styles.wrap, hero ? styles.wrapHero : styles.wrapCompact]}
    >
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.glow,
          { borderRadius: hero ? radius.xl : radius.lg, boxShadow: `0 18px 48px -14px ${withAlpha(glow, hero ? 0.6 : 0.45)}` },
        ]}
      />
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
          <GlassSurface radius={hero ? radius.xl : radius.lg} tint={withAlpha(glow, 0.08)}>
            {showArt ? (
              <View style={[styles.art, hero ? styles.artHero : styles.artCompact]}>
                {image !== undefined ? (
                  <Image source={image} style={StyleSheet.absoluteFill} contentFit="cover" transition={400} />
                ) : (
                  <Nebula colors={colors} animate={forming} />
                )}
                {status === "sculpting" && image !== undefined ? <Shimmer /> : null}
                <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.artFade]} />
                <View style={[styles.topRow, styles.artTop]}>
                  {chip ?? <View />}
                  {share}
                </View>
                <GlassSurface
                  radius={hero ? radius.lg : radius.md}
                  strong
                  style={[styles.panel, hero ? styles.panelHero : styles.panelCompact]}
                >
                  {forming && meta && hero ? <Progress step={meta.step} tint={meta.dot} /> : null}
                  {details}
                </GlassSurface>
              </View>
            ) : (
              <View style={[styles.body, hero ? styles.bodyHero : styles.bodyCompact]}>
                {chip || share ? (
                  <View style={styles.topRow}>
                    {chip ?? <View />}
                    {share}
                  </View>
                ) : null}
                {details}
              </View>
            )}
          </GlassSurface>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

function Nebula({ colors, animate }: { colors: string[]; animate: boolean }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(animate
      ? withRepeat(withTiming(1, { duration: 5200, easing: Easing.inOut(Easing.sin) }), -1, true)
      : 0);
  }, [animate, t]);
  const drift = useAnimatedStyle(() => ({
    transform: [{ scale: 1.15 + t.value * 0.25 }, { rotate: `${t.value * 28}deg` }],
  }));
  const seed = useAnimatedStyle(() => ({
    opacity: 0.7 + t.value * 0.3,
    transform: [{ scale: 0.85 + t.value * 0.35 }],
  }));
  const [a, b, c = a] = colors;
  return (
    <View style={[StyleSheet.absoluteFill, styles.nebulaBase]}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundImage: [
              `radial-gradient(circle at 30% 35%, ${withAlpha(a, 0.75)} 0%, ${withAlpha(a, 0)} 55%)`,
              `radial-gradient(circle at 72% 60%, ${withAlpha(b, 0.6)} 0%, ${withAlpha(b, 0)} 50%)`,
              `radial-gradient(circle at 45% 85%, ${withAlpha(c, 0.5)} 0%, ${withAlpha(c, 0)} 45%)`,
            ].join(", "),
          },
          drift,
        ]}
      />
      <Animated.View style={[styles.orbSeed, seed]}>
        <View
          style={[
            styles.orbSeedHalo,
            { backgroundImage: `radial-gradient(circle, ${withAlpha("#FFFFFF", 0.5)} 0%, ${withAlpha(a, 0.45)} 30%, ${withAlpha(a, 0)} 70%)` },
          ]}
        />
        <View style={[styles.orbSeedCore, { boxShadow: `0 0 18px 6px ${withAlpha(a, 0.9)}, 0 0 4px 1px #FFFFFF` }]} />
      </Animated.View>
    </View>
  );
}

function Shimmer() {
  const t = useSharedValue(-1);
  useEffect(() => {
    t.set(withRepeat(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.quad) }), -1, false));
  }, [t]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: `${t.value * 120}%` }] }));
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.shimmerClip]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.shimmer, style]} />
    </View>
  );
}

function Progress({ step, tint }: { step: number; tint: string }) {
  return (
    <View style={styles.progress}>
      {Array.from({ length: STEPS }, (_, i) => (
        <View
          key={i}
          style={[
            styles.progressSeg,
            i < step && { backgroundColor: tint, boxShadow: `0 0 10px ${withAlpha(tint, 0.8)}` },
            i === step && { backgroundColor: withAlpha(tint, 0.45) },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "relative",
  },
  wrapHero: {
    width: "100%",
  },
  wrapCompact: {
    flex: 1,
  },
  glow: {
    top: 24,
    left: 18,
    right: 18,
  },
  art: {
    overflow: "hidden",
    backgroundColor: "rgba(6, 8, 30, 0.6)",
  },
  artHero: {
    aspectRatio: 0.86,
  },
  artCompact: {
    aspectRatio: 0.68,
  },
  artFade: {
    backgroundImage: "linear-gradient(180deg, rgba(6,6,22,0.35) 0%, rgba(6,6,22,0) 22%, rgba(6,6,22,0) 50%, rgba(6,6,22,0.6) 100%)",
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  artTop: {
    position: "absolute",
    top: space.md,
    left: space.md,
    right: space.md,
  },
  panel: {
    position: "absolute",
    gap: space.xs,
  },
  panelHero: {
    left: space.sm + 2,
    right: space.sm + 2,
    bottom: space.sm + 2,
    padding: space.lg,
    paddingHorizontal: space.lg + 2,
    gap: space.sm,
  },
  panelCompact: {
    left: space.sm - 2,
    right: space.sm - 2,
    bottom: space.sm - 2,
    padding: space.md - 2,
  },
  body: {
    gap: space.md,
  },
  bodyHero: {
    padding: space.xl,
  },
  bodyCompact: {
    padding: space.lg - 2,
    gap: space.sm,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: color.textTertiary,
  },
  author: {
    color: color.lilac,
  },
  quote: {
    ...type.section,
    fontSize: 24,
    lineHeight: 31,
    color: color.text,
  },
  quoteCompact: {
    fontSize: 18,
    lineHeight: 24,
  },
  untitled: {
    color: color.textSecondary,
  },
  failed: {
    gap: space.md,
  },
  retry: {
    alignSelf: "flex-start",
  },
  nebulaBase: {
    backgroundColor: "#0B0A24",
    alignItems: "center",
    justifyContent: "center",
  },
  orbSeed: {
    position: "absolute",
    top: "32%",
    width: 120,
    height: 120,
    alignItems: "center",
    justifyContent: "center",
  },
  orbSeedHalo: {
    ...StyleSheet.absoluteFill,
    borderRadius: 60,
  },
  orbSeedCore: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#FFFFFF",
  },
  shimmerClip: {
    overflow: "hidden",
  },
  shimmer: {
    backgroundImage: "linear-gradient(100deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.18) 50%, rgba(255,255,255,0) 70%)",
  },
  progress: {
    flexDirection: "row",
    gap: 6,
    marginBottom: space.xs,
  },
  progressSeg: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
});
