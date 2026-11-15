import { ConvexProvider, ConvexReactClient } from "convex/react";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { useColorScheme } from "react-native";

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
  unsavedChangesWarning: false,
});

export const unstable_settings = {
  anchor: "index",
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ConvexProvider client={convex}>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen
            name="index"
            options={{ title: "Worlds", headerLargeTitleEnabled: true }}
          />
          <Stack.Screen
            name="record"
            options={{
              presentation: "formSheet",
              headerShown: false,
              sheetGrabberVisible: true,
            }}
          />
        </Stack>
      </ThemeProvider>
    </ConvexProvider>
  );
}
