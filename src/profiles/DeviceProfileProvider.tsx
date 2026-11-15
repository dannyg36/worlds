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
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { Pearl } from "@/components/ui/Pearl";
import { layout, space, type } from "@/design/tokens";
import { api } from "../../convex/_generated/api";
import { readDeviceSecret, saveDeviceSecret } from "./deviceSecret";
import { inviteCodeFromUrl } from "./invites";
import { Onboarding } from "./Onboarding";

type DeviceAuth = {
  isLoading: boolean;
  isAuthenticated: boolean;
  fetchAccessToken: () => Promise<string | null>;
};

const DeviceAuthContext = createContext<DeviceAuth | null>(null);
const RETRY_DELAYS_MS = [1000, 4000];

/**
 * Signs this device in to Convex with a secret only it knows, and asks for a
 * name on first launch. Convex functions see the device's profile through
 * `ctx.auth`, like any other sign-in.
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

  const fetchAccessToken = useCallback(async () => {
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
        if (attempt === RETRY_DELAYS_MS.length) {
          return null;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAYS_MS[attempt]),
        );
      }
    }
  }, [client, secret]);

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
  const { isLoading, isAuthenticated } = useConvexAuth();
  const profile = useQuery(api.profiles.me, isAuthenticated ? {} : "skip");
  const inviteCode = inviteCodeFromUrl(useLinkingURL());

  if (!isLoading && !isAuthenticated) {
    return (
      <View style={styles.centered}>
        <View style={styles.message}>
          <Text style={[type.headline, styles.text]}>
            Couldn&apos;t reach worlds
          </Text>
          <Text style={[type.body, styles.text]}>
            Check your connection and try again.
          </Text>
        </View>
        <Button label="Try again" onPress={onRetry} style={styles.retry} />
      </View>
    );
  }
  if (profile === undefined) {
    return (
      <View style={styles.centered}>
        <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading">
          <Pearl size={56} />
        </View>
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
    alignItems: "center",
    justifyContent: "center",
    gap: space.xxl,
    padding: layout.gutter,
  },
  message: {
    maxWidth: 360,
    gap: space.sm,
  },
  text: {
    textAlign: "center",
  },
  retry: {
    minWidth: 200,
  },
});
