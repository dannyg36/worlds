import { ClerkProvider, useAuth, useClerk } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { ConvexReactClient, useConvexAuth } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import {
  DarkTheme,
  DefaultTheme,
  SplashScreen,
  Stack,
  ThemeProvider,
  useTheme,
} from "expo-router";
import { Pressable, Text, useColorScheme } from "react-native";

SplashScreen.preventAutoHideAsync();

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
  unsavedChangesWarning: false,
});

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ClerkProvider
      publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!}
      tokenCache={tokenCache}
    >
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
          <RootStack />
        </ThemeProvider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}

function RootStack() {
  const { isLoading, isAuthenticated } = useConvexAuth();

  if (isLoading) {
    return null;
  }
  SplashScreen.hide();

  return (
    <Stack>
      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen
          name="index"
          options={{
            title: "Worlds",
            headerLargeTitleEnabled: true,
            headerRight: () => <SignOutButton />,
          }}
        />
      </Stack.Protected>
      <Stack.Protected guard={!isAuthenticated}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

function SignOutButton() {
  const { signOut } = useClerk();
  const { colors } = useTheme();

  return (
    <Pressable accessibilityRole="button" hitSlop={8} onPress={() => signOut()}>
      <Text style={{ color: colors.primary, fontSize: 17 }}>Sign out</Text>
    </Pressable>
  );
}
