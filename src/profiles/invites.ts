import { ConvexError } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import * as Linking from "expo-linking";
import { Platform } from "react-native";

import { api } from "../../convex/_generated/api";

export function inviteCodeFromUrl(url: string | null) {
  return url?.match(/\/invite\/([A-Za-z0-9-]+)/)?.[1] ?? null;
}

export function inviteLink(code: string) {
  return Platform.OS === "web"
    ? Linking.createURL(`/invite/${code}`)
    : `worlds://invite/${code}`;
}

export function formatInviteCode(code: string) {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function describeInviteResult(
  result: FunctionReturnType<typeof api.friends.accept>,
) {
  switch (result.status) {
    case "connected":
      return `You and ${result.name} are now friends.`;
    case "alreadyFriends":
      return `You and ${result.name} are friends.`;
    case "self":
      return "This is your own invite. Send it to a friend instead.";
  }
}

export function errorMessage(error: unknown) {
  return error instanceof ConvexError
    ? String(error.data)
    : "Something went wrong. Try again.";
}
