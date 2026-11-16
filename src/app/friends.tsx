import { useMutation, useQuery } from "convex/react";
import { Stack } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { Fragment, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Surface } from "@/components/ui/Surface";
import { color, font, layout, radius, space, type } from "@/design/tokens";
import { api } from "../../convex/_generated/api";
import {
  describeInviteResult,
  errorMessage,
  formatInviteCode,
  inviteLink,
} from "../profiles/invites";

const AVATAR = 40;
const CODE_TRACKING = 3;

export default function FriendsScreen() {
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // The code is the hero: as large as fits on one line inside the card
  // (nine glyphs at roughly 0.7em each, plus tracking).
  const codeWidth =
    Math.min(width - 2 * layout.gutter, layout.maxWidth) - 2 * space.xxl;
  const codeSize = Math.max(
    28,
    Math.min(42, Math.floor((codeWidth - 9 * CODE_TRACKING) / 6.4)),
  );
  const me = useQuery(api.profiles.me);
  const friends = useQuery(api.friends.list);
  const acceptInvite = useMutation(api.friends.accept);
  const [code, setCode] = useState("");
  const [adding, setAdding] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [addNotice, setAddNotice] = useState<string | null>(null);

  async function handleShare(inviteCode: string) {
    const link = inviteLink(inviteCode);
    try {
      if (Platform.OS === "web") {
        await navigator.clipboard.writeText(link);
        setShareNotice("Invite link copied.");
      } else {
        await Share.share({
          message: `Add me on worlds: open ${link} or enter my code ${formatInviteCode(inviteCode)}.`,
        });
      }
    } catch {
      setShareNotice(`Send your friends this link: ${link}`);
    }
  }

  async function handleAdd() {
    setAdding(true);
    try {
      setAddNotice(describeInviteResult(await acceptInvite({ code })));
      setCode("");
    } catch (error) {
      setAddNotice(errorMessage(error));
    } finally {
      setAdding(false);
    }
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: headerHeight + space.sm,
          paddingBottom: insets.bottom + space.huge,
        },
      ]}
    >
      <Stack.Screen options={{ title: "Friends", headerTitle: "" }} />
      <View style={styles.column}>
        <Text accessibilityRole="header" style={[type.title, styles.title]}>
          Friends
        </Text>

        {me && (
          <Surface radius={radius.xl} style={styles.invite}>
            <Text style={[type.caption, styles.centered]}>Your invite code</Text>
            <Text
              selectable
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[
                styles.code,
                { fontSize: codeSize, lineHeight: Math.round(codeSize * 1.2) },
              ]}
            >
              {formatInviteCode(me.inviteCode)}
            </Text>
            <Text style={[type.body, styles.centered]}>
              Friends see you as {me.name}. When they open your invite link or
              enter your code, you see each other&apos;s shared worlds.
            </Text>
            <Button
              label={Platform.OS === "web" ? "Copy invite link" : "Share invite link"}
              icon={{ ios: "square.and.arrow.up", android: "share", web: "content_copy" }}
              onPress={() => handleShare(me.inviteCode)}
              style={styles.shareButton}
            />
            {shareNotice && (
              <Text selectable style={[type.caption, styles.centered]}>
                {shareNotice}
              </Text>
            )}
          </Surface>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeading}>
            <Text accessibilityRole="header" style={type.heading}>
              Add a friend
            </Text>
            <Text style={type.body}>Enter the code a friend sent you.</Text>
          </View>
          <View style={styles.addRow}>
            <View style={styles.addField}>
              <Field
                value={code}
                onChangeText={setCode}
                placeholder="ABCD-EFGH"
                accessibilityLabel="Friend's invite code"
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={20}
                returnKeyType="done"
                onSubmitEditing={code.trim() && !adding ? handleAdd : undefined}
              />
            </View>
            <Button
              label="Add friend"
              variant="secondary"
              disabled={!code.trim()}
              loading={adding}
              onPress={handleAdd}
            />
          </View>
          {addNotice && <Text style={type.caption}>{addNotice}</Text>}
        </View>

        <View style={[styles.section, styles.friends]}>
          <Text accessibilityRole="header" style={type.heading}>
            Your friends
          </Text>
          {friends === undefined ? (
            <ActivityIndicator size="small" color={color.ink} style={styles.loading} />
          ) : friends.length === 0 ? (
            <Text style={type.body}>
              No friends yet. Share your invite link and their shared worlds will
              show up in your feed.
            </Text>
          ) : (
            <View>
              {friends.map((friend, index) => (
                <Fragment key={friend._id}>
                  {index > 0 && <View style={styles.separator} />}
                  <View style={styles.row}>
                    <View style={styles.avatar}>
                      <Text style={styles.initial}>
                        {Array.from(friend.name.trim())[0]?.toUpperCase()}
                      </Text>
                    </View>
                    <Text numberOfLines={1} style={[type.heading, styles.name]}>
                      {friend.name}
                    </Text>
                  </View>
                </Fragment>
              ))}
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: layout.gutter,
  },
  column: {
    width: "100%",
    maxWidth: layout.maxWidth,
    alignSelf: "center",
  },
  title: {
    marginBottom: space.xl + space.xs,
  },
  invite: {
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.xxl,
    paddingTop: space.xxl + space.xs,
    paddingBottom: space.xxl,
  },
  centered: {
    textAlign: "center",
  },
  code: {
    fontFamily: font.serifLight,
    letterSpacing: CODE_TRACKING,
    color: color.ink,
    textAlign: "center",
  },
  shareButton: {
    width: "100%",
    maxWidth: 360,
    marginTop: space.sm,
  },
  section: {
    gap: space.lg,
    marginTop: space.xxxl,
  },
  sectionHeading: {
    gap: space.xs,
  },
  friends: {
    gap: space.xs,
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm + 2,
  },
  addField: {
    flex: 1,
  },
  loading: {
    alignSelf: "flex-start",
    marginTop: space.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md + 2,
    paddingVertical: space.md,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairlineStrong,
  },
  initial: {
    fontFamily: font.serif,
    fontSize: 18,
    lineHeight: 22,
    color: color.ink,
  },
  name: {
    flex: 1,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: AVATAR + space.md + 2,
    backgroundColor: color.hairlineStrong,
  },
});
