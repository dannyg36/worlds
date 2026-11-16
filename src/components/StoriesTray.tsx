import { useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { GestureDetector, GestureHandlerRootView, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { Icon } from "@/components/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { usePressScale } from "@/components/ui/press";
import { Surface } from "@/components/ui/Surface";
import { haptics } from "@/design/haptics";
import { color, font, layout, motion, radius, shadow, space, type } from "@/design/tokens";
import { isFresh, todaysWorld, type People, type Person } from "@/world/people";

/** The panel also reaches this far above the screen, so pulling it past open never shows a gap. */
const OVERPULL = 64;
/** Pulling the closed pill down this far opens the tray all the way. */
const PULL = 96;
/** Avatar discs in the open tray and in the closed pill; their rings add 10. */
const FACE = 58;
const MINI = 22;
/** Each person's column in the open tray. */
const SLOT = 72;
/** The pill's touch area reaches this far past its edge. */
const REACH = 6;

const closing = { ...motion.spring, overshootClamping: true };

/**
 * Friends' worlds, Instagram-stories style: a quiet pill at the top of the world
 * that pulls down into a frosted tray of you, your friends, and a way to add one.
 * Render it over the whole screen; everything but its own controls lets touches through.
 */
export function StoriesTray({
  people,
  top,
  onOpenPerson,
  onAddFriend,
}: {
  people: People;
  /** The safe-area top inset; the pill sits just below it. */
  top: number;
  onOpenPerson: (person: Person) => void;
  onAddFriend: () => void;
}) {
  const [open, setOpen] = useState(false);
  /** Set once a press turns into a drag, so letting go doesn't also count as a tap. */
  const dragged = useRef(false);
  /** 0 closed, 1 open, a little past 1 while pulled beyond open. */
  const progress = useSharedValue(0);
  /** How far the open panel hangs below the top of the screen. */
  const depth = useSharedValue(0);
  const from = useSharedValue(0);
  const anchor = useSharedValue(0);

  const settle = (next: boolean) => {
    setOpen(next);
    progress.set(withSpring(next ? 1 : 0, next ? motion.spring : closing));
  };
  const hide = () => {
    haptics.tap();
    settle(false);
  };
  /** Presses on the pill and in the tray; one that became a drag has already moved the tray. */
  const tap = (action: () => void) => () => {
    if (dragged.current) return;
    haptics.tap();
    action();
  };
  const noteDrag = (value: boolean) => {
    dragged.current = value;
  };
  const commit = (next: boolean, changed: boolean) => {
    if (changed) haptics.tap();
    setOpen(next);
  };

  useEffect(() => {
    if (!open) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      haptics.tap();
      setOpen(false);
      progress.set(withSpring(0, closing));
      return true;
    });
    return () => subscription.remove();
  }, [open, progress]);

  const grab = (translation: number) => {
    "worklet";
    scheduleOnRN(noteDrag, true);
    cancelAnimation(progress);
    from.set(progress.get());
    anchor.set(translation);
  };
  const follow = (translation: number, distance: number) => {
    "worklet";
    const raw = from.get() + (translation - anchor.get()) / distance;
    const over = raw - 1;
    progress.set(over > 0 ? 1 + over / (2 + over * 8) : Math.max(raw, 0));
  };
  /** A flick goes where it was flung; otherwise a short pull is enough to open or close. */
  const release = (velocityY: number, distance: number, wasOpen: boolean) => {
    "worklet";
    const reached = progress.get();
    const next = Math.abs(velocityY) > 300 ? velocityY > 0 : reached > (wasOpen ? 0.75 : 0.3);
    const spring = next ? motion.spring : closing;
    progress.set(withSpring(next ? 1 : 0, { ...spring, velocity: velocityY / distance }));
    scheduleOnRN(commit, next, next !== wasOpen);
  };

  const pull = usePanGesture({
    activeOffsetY: 6,
    failOffsetX: [-20, 20],
    onBegin: () => scheduleOnRN(noteDrag, false),
    onActivate: (event) => grab(event.translationY),
    onUpdate: (event) => follow(event.translationY, PULL),
    onDeactivate: (event) => release(event.velocityY, PULL, false),
  });
  const push = usePanGesture({
    activeOffsetY: [-8, 8],
    failOffsetX: [-12, 12],
    onBegin: () => scheduleOnRN(noteDrag, false),
    onActivate: (event) => grab(event.translationY),
    onUpdate: (event) => follow(event.translationY, Math.max(depth.get(), 1)),
    onDeactivate: (event) => release(event.velocityY, Math.max(depth.get(), 1), true),
  });

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1], Extrapolation.CLAMP),
  }));
  const panelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.04], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: (progress.value - 1) * depth.value }],
  }));
  const pillStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.3], [1, 0], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [0, 12], Extrapolation.CLAMP) },
      { scale: interpolate(progress.value, [0, 0.3], [1, 0.94], Extrapolation.CLAMP) },
    ],
  }));

  const fresh = people.friends.filter((friend) => isFresh(friend));
  const faces = (fresh.length > 0 ? fresh : people.friends).slice(0, 3);

  return (
    <View
      pointerEvents="box-none"
      accessibilityViewIsModal={open}
      onAccessibilityEscape={open ? hide : undefined}
      style={StyleSheet.absoluteFill}
    >
      <Animated.View
        pointerEvents={open ? "auto" : "none"}
        style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}
      >
        <Pressable accessible={false} importantForAccessibility="no" style={StyleSheet.absoluteFill} onPress={hide} />
      </Animated.View>

      <Animated.View
        pointerEvents={open ? "box-none" : "none"}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? "auto" : "no-hide-descendants"}
        onLayout={(event) => depth.set(event.nativeEvent.layout.height - OVERPULL)}
        style={[styles.panelDock, panelStyle]}
      >
        <GestureHandlerRootView style={styles.panelRoot}>
          <GestureDetector gesture={push}>
            <Surface
              variant="frost"
              radius={radius.xl}
              style={[styles.panel, { paddingTop: OVERPULL + top + space.md }]}
            >
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                <Face
                  name={people.me.name}
                  label="You"
                  ring={todaysWorld(people.me) ? "fresh" : "quiet"}
                  onPress={tap(() => {
                    settle(false);
                    onOpenPerson(people.me);
                  })}
                />
                {people.friends.map((friend) => (
                  <Face
                    key={friend.id}
                    name={friend.name}
                    label={friend.name}
                    ring={isFresh(friend) ? "fresh" : "quiet"}
                    dim={friend.worlds.length === 0}
                    onPress={tap(() => {
                      settle(false);
                      onOpenPerson(friend);
                    })}
                  />
                ))}
                <AddSlot
                  onPress={tap(() => {
                    settle(false);
                    onAddFriend();
                  })}
                />
              </ScrollView>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Hide friends' worlds"
                hitSlop={{ top: 4, bottom: 8 }}
                onPress={tap(() => settle(false))}
                style={styles.handle}
              >
                <View style={styles.grabber} />
              </Pressable>
            </Surface>
          </GestureDetector>
        </GestureHandlerRootView>
      </Animated.View>

      <View pointerEvents="box-none" style={[styles.pillDock, { top: top + space.sm - REACH }]}>
        <Animated.View
          pointerEvents={open ? "none" : "auto"}
          accessibilityElementsHidden={open}
          importantForAccessibility={open ? "no-hide-descendants" : "auto"}
          style={pillStyle}
        >
          <GestureHandlerRootView style={styles.pillRoot}>
            <GestureDetector gesture={pull}>
              <Pill faces={faces} onPress={tap(() => settle(true))} />
            </GestureDetector>
          </GestureHandlerRootView>
        </Animated.View>
      </View>
    </View>
  );
}

/** Closed: who has something new, and a chevron that says "pull me down". */
function Pill({ faces, onPress }: { faces: Person[]; onPress: () => void }) {
  const press = usePressScale(0.95);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Show friends' worlds"
      accessibilityState={{ expanded: false }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={onPress}
      style={styles.pillHit}
    >
      <Animated.View style={press.style}>
        <Surface
          variant="frost"
          radius={radius.pill}
          style={[styles.pill, faces.length > 0 ? styles.pillFaces : styles.pillLabel]}
        >
          {faces.length > 0 ? (
            <View style={styles.stack}>
              {faces.map((person, index) => (
                <View
                  key={person.id}
                  style={[styles.stacked, index > 0 && styles.overlap, { zIndex: faces.length - index }]}
                >
                  <Avatar name={person.name} size={MINI} ring={isFresh(person) ? "fresh" : "quiet"} />
                </View>
              ))}
            </View>
          ) : (
            <>
              <Icon name={{ ios: "person.2", web: "group" }} size={15} tint={color.ink} />
              <Text style={styles.pillText}>Friends</Text>
            </>
          )}
          <Icon name={{ ios: "chevron.down", web: "expand_more" }} size={12} tint={color.inkSecondary} />
        </Surface>
      </Animated.View>
    </Pressable>
  );
}

function Face({
  name,
  label,
  ring,
  dim = false,
  onPress,
}: {
  name: string;
  label: string;
  ring: "fresh" | "quiet";
  dim?: boolean;
  onPress: () => void;
}) {
  const press = usePressScale(0.94);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={{ text: ring === "fresh" ? "New world" : dim ? "No worlds yet" : undefined }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={onPress}
      style={styles.slot}
    >
      <Animated.View style={[press.style, dim && styles.dim]}>
        <Avatar name={name} size={FACE} ring={ring} />
      </Animated.View>
      <Text numberOfLines={1} style={[styles.name, dim && styles.nameDim]}>
        {label}
      </Text>
    </Pressable>
  );
}

function AddSlot({ onPress }: { onPress: () => void }) {
  const press = usePressScale(0.94);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add a friend"
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={onPress}
      style={styles.slot}
    >
      <Animated.View style={[styles.ringBox, press.style]}>
        <View style={styles.add}>
          <Icon name={{ ios: "plus", web: "add" }} size={22} weight="medium" tint={color.ink} />
        </View>
      </Animated.View>
      <Text numberOfLines={1} style={styles.name}>
        Add
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: {
    backgroundColor: "rgba(247, 246, 242, 0.2)",
  },
  panelDock: {
    position: "absolute",
    top: -OVERPULL,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  panelRoot: {
    width: "100%",
    maxWidth: layout.maxWidth,
  },
  panel: {
    boxShadow: shadow.float,
  },
  row: {
    paddingHorizontal: space.lg,
    paddingBottom: space.xs,
    gap: space.sm,
  },
  slot: {
    width: SLOT,
    alignItems: "center",
    gap: space.xs + 2,
  },
  name: {
    ...type.meta,
    color: color.ink,
    alignSelf: "stretch",
    textAlign: "center",
  },
  nameDim: {
    color: color.inkSecondary,
  },
  dim: {
    opacity: 0.55,
  },
  ringBox: {
    width: FACE + 10,
    height: FACE + 10,
    alignItems: "center",
    justifyContent: "center",
  },
  add: {
    width: FACE,
    height: FACE,
    borderRadius: FACE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairlineStrong,
    boxShadow: shadow.raised,
  },
  handle: {
    alignSelf: "center",
    width: 160,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  grabber: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: color.inkFaint,
  },
  pillDock: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  pillRoot: {
    alignSelf: "center",
  },
  pillHit: {
    padding: REACH,
  },
  pill: {
    minHeight: MINI + 18,
    flexDirection: "row",
    alignItems: "center",
  },
  pillFaces: {
    paddingLeft: 2.5,
    paddingRight: space.md,
    gap: space.sm - 1,
  },
  pillLabel: {
    paddingHorizontal: space.md + 2,
    gap: space.xs + 2,
  },
  pillText: {
    fontFamily: font.sansMedium,
    fontSize: 13,
    lineHeight: 16,
    color: color.ink,
  },
  stack: {
    flexDirection: "row",
  },
  stacked: {
    padding: 1.5,
    borderRadius: radius.pill,
    backgroundColor: color.pearlLight,
  },
  overlap: {
    marginLeft: -11,
  },
});
