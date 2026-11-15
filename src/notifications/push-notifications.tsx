import { useMutation, useQuery } from "convex/react";
import * as Notifications from "expo-notifications";
import { router, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { api } from "../../convex/_generated/api";
import {
  getInstallId,
  pushSupported,
  syncPushRegistration,
  turnOffPush,
  usePushState,
} from "./push-registration";

if (pushSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export function PushNotifications() {
  const register = useMutation(api.notifications.register);
  const unregister = useMutation(api.notifications.unregister);

  useEffect(() => {
    if (!pushSupported) {
      return;
    }
    const sync = (devicePushToken?: Notifications.DevicePushToken) =>
      syncPushRegistration({
        register,
        unregister,
        prompt: false,
        devicePushToken,
      });
    void sync();
    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void sync();
      }
    });
    const tokens = Notifications.addPushTokenListener((token) => void sync(token));
    return () => {
      appState.remove();
      tokens.remove();
    };
  }, [register, unregister]);

  useEffect(() => {
    if (!pushSupported) {
      return;
    }
    function open(response: Notifications.NotificationResponse | null) {
      const url = response?.notification.request.content.data?.url;
      if (
        response?.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER ||
        typeof url !== "string" ||
        !url.startsWith("/")
      ) {
        return;
      }
      Notifications.clearLastNotificationResponse();
      router.navigate(url as Href);
    }
    open(Notifications.getLastNotificationResponse());
    const responses = Notifications.addNotificationResponseReceivedListener(open);
    return () => responses.remove();
  }, []);

  return null;
}

export function usePushNotifications() {
  const register = useMutation(api.notifications.register);
  const unregister = useMutation(api.notifications.unregister);
  const updateReminderTime = useMutation(api.notifications.setReminderTime);
  const { status, error } = usePushState();
  const [installId, setInstallId] = useState<string>();
  const registration = useQuery(
    api.notifications.registration,
    installId ? { installId } : "skip",
  );

  useEffect(() => {
    if (pushSupported) {
      getInstallId().then(setInstallId, () => {});
    }
  }, []);

  return {
    status,
    error,
    reminderMinutes: registration?.reminderMinutes,
    enable: (reminderMinutes?: number) =>
      syncPushRegistration({
        register,
        unregister,
        prompt: true,
        reminderMinutes,
      }),
    disable: () => turnOffPush(unregister),
    setReminderTime: async (minutes: number) =>
      updateReminderTime({ installId: await getInstallId(), minutes }),
  };
}
