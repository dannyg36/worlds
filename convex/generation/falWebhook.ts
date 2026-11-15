const JWKS_URL = "https://rest.fal.ai/.well-known/jwks.json";
const JWKS_TTL_MS = 12 * 60 * 60 * 1000;
const JWKS_REFRESH_AFTER_MS = 5 * 60 * 1000;
const MAX_CLOCK_SKEW_SECONDS = 300;

let jwks: { keys: CryptoKey[]; fetchedAt: number } | undefined;

export async function verifyFalWebhook(
  headers: Headers,
  body: ArrayBuffer,
): Promise<boolean> {
  const requestId = headers.get("x-fal-webhook-request-id");
  const userId = headers.get("x-fal-webhook-user-id");
  const timestamp = headers.get("x-fal-webhook-timestamp");
  const signature = hexToBytes(headers.get("x-fal-webhook-signature") ?? "");
  if (!requestId || !userId || !timestamp || signature?.length !== 64) {
    return false;
  }
  const sentAt = Number(timestamp);
  if (
    !Number.isFinite(sentAt) ||
    Math.abs(Date.now() / 1000 - sentAt) > MAX_CLOCK_SKEW_SECONDS
  ) {
    return false;
  }
  const bodyHash = bytesToHex(await crypto.subtle.digest("SHA-256", body));
  const message = new TextEncoder().encode(
    [requestId, userId, timestamp, bodyHash].join("\n"),
  );
  if (await matchesAnyKey(await publicKeys(false), signature, message)) {
    return true;
  }
  const stale = !jwks || Date.now() - jwks.fetchedAt > JWKS_REFRESH_AFTER_MS;
  return stale && (await matchesAnyKey(await publicKeys(true), signature, message));
}

async function matchesAnyKey(
  keys: CryptoKey[],
  signature: Uint8Array<ArrayBuffer>,
  message: Uint8Array<ArrayBuffer>,
) {
  for (const key of keys) {
    if (await crypto.subtle.verify({ name: "Ed25519" }, key, signature, message)) {
      return true;
    }
  }
  return false;
}

async function publicKeys(refresh: boolean): Promise<CryptoKey[]> {
  if (!refresh && jwks && Date.now() - jwks.fetchedAt < JWKS_TTL_MS) {
    return jwks.keys;
  }
  const response = await fetch(JWKS_URL);
  if (!response.ok) {
    throw new Error(`Fetching fal's webhook keys failed with ${response.status}.`);
  }
  const { keys } = (await response.json()) as { keys?: { x?: unknown }[] };
  const imported = await Promise.all(
    (keys ?? [])
      .map((key) => key.x)
      .filter((x): x is string => typeof x === "string")
      .map((x) =>
        crypto.subtle.importKey(
          "raw",
          base64UrlToBytes(x),
          { name: "Ed25519" },
          false,
          ["verify"],
        ),
      ),
  );
  jwks = { keys: imported, fetchedAt: Date.now() };
  return imported;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^([0-9a-f]{2})+$/i.test(hex)) {
    return undefined;
  }
  return Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16));
}

function bytesToHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
