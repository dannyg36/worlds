import { ConvexReactClient } from "convex/react";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { useColorScheme } from "react-native";

import { DeviceProfileProvider } from "../profiles/DeviceProfileProvider";

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
  unsavedChangesWarning: false,
});

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <DeviceProfileProvider client={convex}>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen
            name="index"
            options={{ title: "Worlds", headerLargeTitleEnabled: true }}
          />
        </Stack>
      </ThemeProvider>
    </DeviceProfileProvider>
  );
}
