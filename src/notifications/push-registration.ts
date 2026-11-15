import * as Crypto from "expo-crypto";
import {
  AndroidImportance,
  type DevicePushToken,
  getDevicePushTokenAsync,
  getExpoPushTokenAsync,
  getPermissionsAsync,
  IosAuthorizationStatus,
  type NotificationPermissionsStatus,
  requestPermissionsAsync,
  setNotificationChannelAsync,
} from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { Platform } from "react-native";

export type PushStatus =
  | "unsupported"
  | "checking"
  | "prompt"
  | "blocked"
  | "off"
  | "on"
  | "error";

type PushState = { status: PushStatus; error?: string };

type Register = (args: {
  installId: string;
  token: string;
  timeZone: string;
  reminderMinutes?: number;
}) => Promise<null>;
type Unregister = (args: { installId: string }) => Promise<null>;

const INSTALL_ID_KEY = "worlds.installId";
const OPTED_OUT_KEY = "worlds.pushOptedOut";
const ANDROID_CHANNEL_ID = "default";

export const pushSupported = Platform.OS === "ios" || Platform.OS === "android";

let installId: Promise<string> | undefined;
let state: PushState = { status: pushSupported ? "checking" : "unsupported" };
const listeners = new Set<() => void>();
let queue: Promise<unknown> = Promise.resolve();
let registeredDeviceToken: DevicePushToken["data"] | undefined;

export function getInstallId() {
  installId ??= loadInstallId().catch((error) => {
    installId = undefined;
    throw error;
  });
  return installId;
}

async function loadInstallId() {
  const saved = await SecureStore.getItemAsync(INSTALL_ID_KEY);
  if (saved) {
    return saved;
  }
  const created = Crypto.randomUUID();
  await SecureStore.setItemAsync(INSTALL_ID_KEY, created);
  return created;
}

export function usePushState() {
  return useSyncExternalStore(subscribe, () => state);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setState(next: PushState) {
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

function serialized<T>(task: () => Promise<T>) {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}

export function syncPushRegistration(options: {
  register: Register;
  unregister: Unregister;
  prompt: boolean;
  reminderMinutes?: number;
  devicePushToken?: DevicePushToken;
}) {
  return serialized(() => sync(options));
}

async function sync({
  register,
  unregister,
  prompt,
  reminderMinutes,
  devicePushToken,
}: Parameters<typeof syncPushRegistration>[0]) {
  if (
    !pushSupported ||
    (devicePushToken && devicePushToken.data === registeredDeviceToken)
  ) {
    return;
  }
  try {
    const id = await getInstallId();
    if (prompt) {
      await SecureStore.deleteItemAsync(OPTED_OUT_KEY);
    } else if (await SecureStore.getItemAsync(OPTED_OUT_KEY)) {
      registeredDeviceToken = undefined;
      await unregister({ installId: id });
      setState({ status: "off" });
      return;
    }
    const permission = await notificationPermission(prompt);
    if (permission !== "granted") {
      registeredDeviceToken = undefined;
      await unregister({ installId: id });
      setState({ status: permission });
      return;
    }
    const deviceToken = devicePushToken ?? (await getDevicePushTokenAsync());
    const { data: token } = await getExpoPushTokenAsync({
      devicePushToken: deviceToken,
    });
    await register({
      installId: id,
      token,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      reminderMinutes,
    });
    registeredDeviceToken = deviceToken.data;
    setState({ status: "on" });
  } catch (error) {
    setState({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function turnOffPush(unregister: Unregister) {
  return serialized(async () => {
    registeredDeviceToken = undefined;
    await SecureStore.setItemAsync(OPTED_OUT_KEY, "true");
    await unregister({ installId: await getInstallId() });
    setState({ status: "off" });
  });
}

async function notificationPermission(prompt: boolean) {
  if (Platform.OS === "android") {
    await setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: "Reminders and worlds",
      importance: AndroidImportance.HIGH,
    });
  }
  let permission = await getPermissionsAsync();
  if (prompt && !isGranted(permission) && permission.canAskAgain) {
    permission = await requestPermissionsAsync();
  }
  if (isGranted(permission)) {
    return "granted";
  }
  return permission.canAskAgain ? "prompt" : "blocked";
}

function isGranted(permission: NotificationPermissionsStatus) {
  return (
    permission.granted ||
    permission.ios?.status === IosAuthorizationStatus.PROVISIONAL
  );
}
