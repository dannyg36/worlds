const KEY = "worlds.deviceSecret";

export async function readDeviceSecret() {
  return localStorage.getItem(KEY);
}

export async function saveDeviceSecret(secret: string) {
  localStorage.setItem(KEY, secret);
}
