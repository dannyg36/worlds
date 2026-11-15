import { ConvexHttpClient } from "convex/browser";
import {
  ConvexProviderWithAuth,
  useConvexAuth,
  useQuery,
  type ConvexReactClient,
} from "convex/react";
import { getRandomBytes } from "expo-crypto";
import { useLinkingURL } from "expo-linking";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { api } from "../../convex/_generated/api";
import { readDeviceSecret, saveDeviceSecret } from "./deviceSecret";
import { inviteCodeFromUrl } from "./invites";
import { Onboarding } from "./Onboarding";
import { Button, styles as ui, useSchemeColors } from "./ui";

type DeviceAuth = {
  isLoading: boolean;
  isAuthenticated: boolean;
  fetchAccessToken: (args: {
    forceRefreshToken: boolean;
  }) => Promise<string | null>;
};

const DeviceAuthContext = createContext<DeviceAuth | null>(null);
const RETRY_DELAYS_MS = [1000, 4000];
const REFRESH_RETRY_DELAY_MS = 10_000;

/**
 * Signs this device in to Convex with a secret only it knows, and asks for a
 * name on first launch. Convex functions see the device's profile through
 * `ctx.auth`, like any other sign-in. Once signed in, a token refresh keeps
 * retrying until the network is back instead of signing the device out, so
 * nothing on screen is lost while offline.
 */
export function DeviceProfileProvider({
  client,
  children,
}: {
  client: ConvexReactClient;
  children: ReactNode;
}) {
  const [secret, setSecret] = useState<string | null>();

  useEffect(() => {
    if (secret !== undefined) {
      return;
    }
    let active = true;
    loadDeviceSecret().then(
      (value) => {
        if (active) setSecret(value);
      },
      () => {
        if (active) setSecret(null);
      },
    );
    return () => {
      active = false;
    };
  }, [secret]);

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      if (!secret) {
        return null;
      }
      const http = new ConvexHttpClient(client.url);
      for (let attempt = 0; ; attempt++) {
        try {
          const token = await http.mutation(api.deviceAuth.token, { secret });
          if (token !== null) {
            return token;
          }
          await http.mutation(api.deviceAuth.register, { secret });
          return await http.mutation(api.deviceAuth.token, { secret });
        } catch {
          if (!forceRefreshToken && attempt === RETRY_DELAYS_MS.length) {
            return null;
          }
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              RETRY_DELAYS_MS[attempt] ?? REFRESH_RETRY_DELAY_MS,
            ),
          );
        }
      }
    },
    [client, secret],
  );

  return (
    <DeviceAuthContext
      value={{
        isLoading: secret === undefined,
        isAuthenticated: Boolean(secret),
        fetchAccessToken,
      }}
    >
      <ConvexProviderWithAuth client={client} useAuth={useDeviceAuth}>
        <ProfileGate onRetry={() => setSecret(undefined)}>
          {children}
        </ProfileGate>
      </ConvexProviderWithAuth>
    </DeviceAuthContext>
  );
}

function useDeviceAuth() {
  const auth = use(DeviceAuthContext);
  if (!auth) {
    throw new Error("useDeviceAuth must be used inside DeviceProfileProvider.");
  }
  return auth;
}

async function loadDeviceSecret() {
  const stored = await readDeviceSecret();
  if (stored) {
    return stored;
  }
  const secret = Array.from(getRandomBytes(32), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  await saveDeviceSecret(secret);
  return secret;
}

function ProfileGate({
  children,
  onRetry,
}: {
  children: ReactNode;
  onRetry: () => void;
}) {
  const colors = useSchemeColors();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const profile = useQuery(api.profiles.me, isAuthenticated ? {} : "skip");
  const inviteCode = inviteCodeFromUrl(useLinkingURL());

  if (!isLoading && !isAuthenticated) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[ui.body, styles.message, { color: colors.text }]}>
          Couldn&apos;t reach worlds. Check your connection and try again.
        </Text>
        <Button title="Try again" color={colors.primary} onPress={onRetry} />
      </View>
    );
  }
  if (profile === undefined) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator />
      </View>
    );
  }
  if (profile === null) {
    return <Onboarding inviteCode={inviteCode} />;
  }
  return children;
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: "center",
    gap: 16,
    padding: 24,
  },
  message: {
    textAlign: "center",
  },
});
