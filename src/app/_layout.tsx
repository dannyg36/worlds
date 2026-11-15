import {
  InstrumentSerif_400Regular,
  InstrumentSerif_400Regular_Italic,
  useFonts,
} from "@expo-google-fonts/instrument-serif";
import { ConvexReactClient } from "convex/react";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform, StyleSheet, View } from "react-native";

import { Backdrop } from "@/components/Backdrop";
import { DeviceProfileProvider } from "@/profiles/DeviceProfileProvider";
import { color, fontFamily } from "@/design/tokens";

SplashScreen.preventAutoHideAsync();

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
  unsavedChangesWarning: false,
});

export const unstable_settings = {
  anchor: "index",
};

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: color.violet,
    background: "transparent",
    card: color.night,
    text: color.text,
    border: color.hairline,
  },
};

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ InstrumentSerif_400Regular, InstrumentSerif_400Regular_Italic });
  const ready = fontsLoaded || fontError !== null;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <View style={styles.root}>
      <Backdrop />
      <StatusBar style="light" />
      <DeviceProfileProvider client={convex}>
        <ThemeProvider value={theme}>
          <Stack
            screenOptions={{
              contentStyle: { backgroundColor: "transparent" },
              headerTransparent: Platform.OS === "ios",
              headerStyle: { backgroundColor: "transparent" },
              headerShadowVisible: false,
              headerTintColor: color.text,
              headerTitleStyle: { fontFamily: fontFamily.display, fontSize: 22, color: color.text },
              headerBackButtonDisplayMode: "minimal",
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false, title: "Worlds" }} />
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
      </DeviceProfileProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.ink,
  },
});
