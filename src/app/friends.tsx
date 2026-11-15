import { useMutation, useQuery } from "convex/react";
import { Stack, useTheme } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { api } from "../../convex/_generated/api";
import {
  describeInviteResult,
  errorMessage,
  formatInviteCode,
  inviteLink,
} from "../profiles/invites";
import { Button, secondaryText, styles as ui } from "../profiles/ui";

export default function FriendsScreen() {
  const { colors } = useTheme();
  const me = useQuery(api.profiles.me);
  const friends = useQuery(api.friends.list);
  const acceptInvite = useMutation(api.friends.accept);
  const [code, setCode] = useState("");
  const [adding, setAdding] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [addNotice, setAddNotice] = useState<string | null>(null);
  const cardStyle = [
    ui.card,
    { backgroundColor: colors.card, borderColor: colors.border },
  ];

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
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
    >
      <Stack.Screen options={{ title: "Friends" }} />
      {me && (
        <View style={cardStyle}>
          <Text style={ui.label}>YOUR INVITE CODE</Text>
          <Text selectable style={[styles.code, { color: colors.text }]}>
            {formatInviteCode(me.inviteCode)}
          </Text>
          <Text style={[ui.body, { color: colors.text }]}>
            Friends see you as {me.name}. When they open your invite link or
            enter your code, you see each other&apos;s shared worlds.
          </Text>
          <Button
            title="Share invite link"
            color={colors.primary}
            onPress={() => handleShare(me.inviteCode)}
          />
          {shareNotice && (
            <Text selectable style={styles.notice}>
              {shareNotice}
            </Text>
          )}
        </View>
      )}
      <View style={cardStyle}>
        <Text style={ui.label}>ADD A FRIEND</Text>
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder="Their code, like ABCD-EFGH"
          placeholderTextColor={secondaryText}
          accessibilityLabel="Friend's invite code"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={20}
          returnKeyType="done"
          onSubmitEditing={code.trim() && !adding ? handleAdd : undefined}
          style={[ui.input, { color: colors.text, borderColor: colors.border }]}
        />
        <Button
          title={adding ? "Adding…" : "Add friend"}
          color={colors.primary}
          disabled={!code.trim() || adding}
          onPress={handleAdd}
        />
        {addNotice && <Text style={styles.notice}>{addNotice}</Text>}
      </View>
      <Text style={[ui.label, styles.sectionLabel]}>YOUR FRIENDS</Text>
      {friends === undefined ? (
        <ActivityIndicator />
      ) : friends.length === 0 ? (
        <Text style={styles.notice}>
          No friends yet. Share your invite to add some.
        </Text>
      ) : (
        friends.map((friend) => (
          <View key={friend._id} style={cardStyle}>
            <Text style={[ui.body, { color: colors.text }]}>{friend.name}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    gap: 12,
  },
  code: {
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: 2,
  },
  notice: {
    color: secondaryText,
    fontSize: 15,
    lineHeight: 20,
  },
  sectionLabel: {
    marginTop: 12,
    marginHorizontal: 4,
  },
});
