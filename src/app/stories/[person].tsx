import { Image } from "expo-image";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { AccessibilityInfo, PanResponder, Platform, Pressable, StyleSheet, Text, View, type TextStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeInLeft,
  FadeInRight,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Backdrop } from "@/components/Backdrop";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Pearl } from "@/components/ui/Pearl";
import { haptics } from "@/design/haptics";
import { color, layout, motion, space, type } from "@/design/tokens";
import { WorldPlate } from "@/stories/plate";
import { usePeople, type Person } from "@/world/people";
import { isForming, type World } from "@/world/worlds";

/** How long each world stays up before the next one turns. */
const pageMs = 6000;
/** Room under the plate for two lines of title and three of words. */
const wordsHeight = 190;
/** Past this many worlds the bar shows them in pages, so segments never shrink to dots. */
const segmentsPerBar = 30;

function close() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

export default function StoriesScreen() {
  const { person: id } = useLocalSearchParams<{ person: string }>();
  const people = usePeople();
  const person =
    people === undefined
      ? undefined
      : id === "me"
        ? people.me
        : (people.friends.find((friend) => friend.id === id) ?? null);

  return (
    <View style={styles.screen}>
      <Backdrop />
      {person === undefined ? (
        <View style={styles.center} accessible accessibilityLabel="Loading">
          <Pearl size={56} />
        </View>
      ) : person === null ? (
        <Message title="These stories aren’t here." body="The link may be wrong, or you’re no longer friends." />
      ) : person.worlds.length === 0 ? (
        <Message
          name={person.name}
          title={person.me ? "You haven’t made a world yet." : `${person.name} hasn’t shared a world yet.`}
        />
      ) : (
        <Stories person={person} />
      )}
    </View>
  );
}

/** A person's worlds as pages: newest first, each up for a few seconds, tap to turn. */
function Stories({ person }: { person: Person }) {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const reducedMotion = useReducedMotion();
  const screenReader = useScreenReader();
  const [now] = useState(Date.now);
  const [page, setPage] = useState({ id: person.worlds[0]?._id, turn: 0, back: false });
  const [held, setHeld] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null);
  const fill = useSharedValue(0);
  const drag = useSharedValue(0);
  const clock = useRef({ key: "", elapsed: 0 });

  const { worlds } = person;
  const index = Math.max(0, worlds.findIndex((world) => world._id === page.id));
  const world = worlds[index];
  // Nothing turns on its own for people who asked for less motion or are using a screen reader.
  const auto = !reducedMotion && !screenReader;
  const running = auto && focused && !held && !dragging;
  const key = `${world._id}:${page.turn}`;
  const nextArt = worlds[index + 1]?.imageUrl;

  function go(to: number) {
    if (to >= worlds.length) {
      close();
      return;
    }
    const target = worlds[Math.max(to, 0)];
    setPage((current) => ({ id: target._id, turn: current.turn + 1, back: to < index }));
  }

  const turnPage = useEffectEvent(() => go(index + 1));

  // The page clock: fills the current segment and turns the page when it's full.
  // It keeps its place through pauses (holding, dragging, stepping inside a world).
  // A layout effect, so a new page's segment never paints with the last page's fill.
  useLayoutEffect(() => {
    const current = clock.current;
    if (current.key !== key) {
      current.key = key;
      current.elapsed = 0;
    }
    if (!auto) {
      fill.set(1);
      return;
    }
    fill.set(current.elapsed / pageMs);
    if (!running) return;
    const started = Date.now();
    const left = pageMs - current.elapsed;
    fill.set(withTiming(1, { duration: left, easing: Easing.linear }));
    const timer = setTimeout(() => turnPage(), left);
    return () => {
      clearTimeout(timer);
      cancelAnimation(fill);
      current.elapsed += Date.now() - started;
    };
  }, [key, auto, running, fill]);

  useEffect(() => {
    if (nextArt) void Image.prefetch(nextArt);
  }, [nextArt]);

  // Pull the page down to put it away. On the web a pull still ends in a click,
  // so the gesture remembers it was a pull and that click doesn't turn the page too.
  const [pull] = useState(() => {
    let pulled = false;
    const responder = PanResponder.create({
      onStartShouldSetPanResponderCapture: () => {
        pulled = false;
        return false;
      },
      onMoveShouldSetPanResponderCapture: (_, g) => g.dy > 10 && g.dy > Math.abs(g.dx) * 1.5,
      onPanResponderGrant: () => {
        pulled = true;
        setDragging(true);
      },
      onPanResponderMove: (_, g) => drag.set(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        setDragging(false);
        if (g.dy > 120 || g.vy > 0.8) close();
        else drag.set(withSpring(0, motion.spring));
      },
      onPanResponderTerminate: () => {
        setDragging(false);
        drag.set(withSpring(0, motion.spring));
      },
    });
    return { handlers: responder.panHandlers, happened: () => pulled };
  });
  const dragStyle = useAnimatedStyle(() => ({
    opacity: interpolate(drag.value, [0, 360], [1, 0.35], "clamp"),
    transform: [{ translateY: drag.value }, { scale: interpolate(drag.value, [0, 600], [1, 0.94], "clamp") }],
  }));

  const plate = stage
    ? Math.max(160, Math.floor(Math.min(stage.width - 2 * layout.gutter, stage.height - wordsHeight - 2 * space.xxl)))
    : 0;
  const top = stage ? Math.max(space.md, (stage.height - plate - wordsHeight) * 0.42) : 0;
  const entering = (page.back ? FadeInLeft : FadeInRight).duration(420).easing(Easing.out(Easing.cubic));

  function tap(to: number) {
    if (pull.happened()) return;
    haptics.tap();
    go(to);
  }

  const hold = {
    onPressIn: () => setHeld(true),
    onPressOut: () => setHeld(false),
    // A hold pauses; letting go shouldn't also turn the page.
    onLongPress: () => {},
    delayLongPress: 250,
  };

  return (
    <Animated.View style={[styles.column, dragStyle]} {...pull.handlers}>
      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <Progress count={worlds.length} index={index} fill={fill} />
        <View style={styles.header}>
          <Avatar name={person.name} size={36} />
          <View style={styles.who}>
            <Text style={type.label} numberOfLines={1}>
              {person.me ? "You" : person.name}
            </Text>
            <Animated.Text key={world._id} entering={FadeIn.duration(300)} style={type.meta} numberOfLines={1}>
              {storyTime(world._creationTime, now)}
            </Animated.Text>
          </View>
          <IconButton icon={{ ios: "xmark", web: "close" }} accessibilityLabel="Close" onPress={close} />
        </View>
      </View>

      <View style={styles.stage} onLayout={(event) => setStage(event.nativeEvent.layout)}>
        {stage ? (
          <Animated.View key={world._id} entering={entering} exiting={FadeOut.duration(200)} style={styles.page}>
            <View style={{ width: plate, marginTop: top }}>
              <WorldPlate world={world} size={plate} />
              <Words world={world} mine={person.me} />
            </View>
          </Animated.View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous world"
          onPress={() => tap(index - 1)}
          style={[styles.zone, styles.previous]}
          {...hold}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next world"
          onPress={() => tap(index + 1)}
          style={[styles.zone, styles.next]}
          {...hold}
        />
      </View>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space.lg) + space.sm }]}>
        <Footer world={world} />
      </View>
    </Animated.View>
  );
}

function Progress({ count, index, fill }: { count: number; index: number; fill: SharedValue<number> }) {
  const first = Math.floor(index / segmentsPerBar) * segmentsPerBar;
  const shown = Math.min(segmentsPerBar, count - first);
  const filling = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));
  return (
    <View style={styles.progress} accessible accessibilityLabel={`World ${index + 1} of ${count}`}>
      {Array.from({ length: shown }, (_, i) => first + i).map((i) => (
        <View key={i} style={styles.segment}>
          {i < index ? (
            <View style={[styles.segmentFill, styles.segmentDone]} />
          ) : i === index ? (
            <Animated.View style={[styles.segmentFill, filling]} />
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** The title, then what you said (your own worlds) or the caption (a friend's). */
function Words({ world, mine }: { world: World; mine: boolean }) {
  // Worlds without art already carry their words on the plate.
  const onPlate = !world.imageUrl && !isForming(world);
  const quote = mine && !onPlate;
  const words = quote ? world.transcript : world.caption;
  const title = world.title ?? (isForming(world) ? "Something is forming…" : undefined);
  return (
    <View style={styles.words}>
      {title ? (
        <Text style={[styles.title, !world.title && styles.pending]} numberOfLines={2}>
          {title}
        </Text>
      ) : null}
      {words ? (
        <Text style={quote ? styles.quote : styles.caption} numberOfLines={3}>
          {quote ? `“${words}”` : words}
        </Text>
      ) : null}
    </View>
  );
}

function Footer({ world }: { world: World }) {
  const forming = isForming(world);
  const failed = world.status === "failed";
  if (world.modelUrl && !forming && !failed) {
    return (
      <Animated.View key="inside" entering={FadeIn.duration(400)}>
        <Button
          label="Step inside"
          icon={{ ios: "figure.walk", web: "directions_walk" }}
          onPress={() => router.push(`/world/${world._id}`)}
          style={styles.inside}
        />
      </Animated.View>
    );
  }
  const status = forming
    ? "You can step inside once it forms."
    : failed
      ? "This world didn’t form."
      : world.status
        ? "This world doesn’t have a 3D model."
        : "Saved before worlds could form.";
  return (
    <Animated.View key={status} entering={FadeIn.duration(400)} style={styles.status}>
      {forming ? <View style={styles.statusPearl} /> : null}
      <Text style={styles.statusText}>{status}</Text>
    </Animated.View>
  );
}

function Message({ name, title, body }: { name?: string; title: string; body?: string }) {
  return (
    <View style={styles.message}>
      {name ? <Avatar name={name} size={64} ring="quiet" /> : null}
      <View style={styles.messageWords}>
        <Text style={styles.messageTitle}>{title}</Text>
        {body ? <Text style={styles.messageBody}>{body}</Text> : null}
      </View>
      <Button variant="quiet" label="Close" onPress={close} />
    </View>
  );
}

function useScreenReader() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    // The web can't tell, and always answers yes.
    if (Platform.OS === "web") return;
    void AccessibilityInfo.isScreenReaderEnabled().then(setEnabled);
    const subscription = AccessibilityInfo.addEventListener("screenReaderChanged", setEnabled);
    return () => subscription.remove();
  }, []);
  return enabled;
}

const minute = 60 * 1000;
const hour = 60 * minute;

/** When a world was made, said plainly: "Just now", "3h ago", "Tonight", "Yesterday", "Tuesday", "Nov 3". */
function storyTime(time: number, now: number) {
  const ago = now - time;
  const made = new Date(time);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  if (ago < minute) return "Just now";
  if (ago < hour) return `${Math.floor(ago / minute)}m ago`;
  if (made.toDateString() === today.toDateString()) {
    return made.getHours() >= 18 ? "Tonight" : `${Math.floor(ago / hour)}h ago`;
  }
  if (made.toDateString() === yesterday.toDateString()) return "Yesterday";
  if (ago < 6 * 24 * hour) return made.toLocaleDateString(undefined, { weekday: "long" });
  return made.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: made.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  column: {
    flex: 1,
    width: "100%",
    maxWidth: layout.maxWidth,
    alignSelf: "center",
  },
  top: {
    paddingHorizontal: layout.gutter,
    gap: space.md + 2,
  },
  progress: {
    flexDirection: "row",
    gap: space.xs,
  },
  segment: {
    flex: 1,
    height: 2,
    borderRadius: 1,
    overflow: "hidden",
    backgroundColor: color.inkFaint,
  },
  segmentFill: {
    height: "100%",
    backgroundColor: color.ink,
  },
  segmentDone: {
    width: "100%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md - 2,
  },
  who: {
    flex: 1,
  },
  stage: {
    flex: 1,
  },
  page: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
  },
  zone: {
    position: "absolute",
    top: 0,
    bottom: 0,
  },
  previous: {
    left: 0,
    width: "33.3%",
  },
  next: {
    right: 0,
    width: "66.7%",
  },
  words: {
    paddingTop: space.xl,
    paddingHorizontal: space.xxs,
    gap: space.sm,
  },
  title: {
    ...type.title,
    // Web: no single-word last line in two-line names.
    textWrap: "balance",
  } as TextStyle,
  pending: {
    color: color.inkSecondary,
  },
  quote: {
    ...type.quote,
    fontSize: 18,
    lineHeight: 26,
    color: color.inkSecondary,
  },
  caption: {
    ...type.body,
  },
  footer: {
    alignItems: "center",
    paddingHorizontal: layout.gutter,
  },
  inside: {
    minWidth: 200,
  },
  status: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  statusPearl: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundImage: "radial-gradient(circle at 35% 30%, #FFFFFF 0%, #F3DDE3 35%, #D9D1F0 65%, #BFE0D8 100%)",
    boxShadow: "0 0 0 0.5px rgba(0, 0, 0, 0.12)",
  },
  statusText: {
    ...type.caption,
    textAlign: "center",
  },
  message: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space.xl,
    paddingHorizontal: space.xxxl,
  },
  messageWords: {
    alignItems: "center",
    gap: space.sm,
    maxWidth: 420,
  },
  messageTitle: {
    ...type.headline,
    textAlign: "center",
  },
  messageBody: {
    ...type.body,
    textAlign: "center",
  },
});
