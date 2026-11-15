import * as SecureStore from "expo-secure-store";

const KEY = "worlds.deviceSecret";

export function readDeviceSecret() {
  return SecureStore.getItemAsync(KEY);
}

export function saveDeviceSecret(secret: string) {
  return SecureStore.setItemAsync(KEY, secret);
}
