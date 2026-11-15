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
import { StyleSheet, View } from "react-native";

import { Backdrop } from "@/components/Backdrop";
import { color, fontFamily } from "@/design/tokens";
import { DeviceProfileProvider } from "@/profiles/DeviceProfileProvider";

import { PushNotifications } from "@/notifications/push-notifications";

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
    <DeviceProfileProvider client={convex}>
      <ThemeProvider value={theme}>
        <View style={styles.root}>
          <Backdrop />
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              contentStyle: { backgroundColor: "transparent" },
              headerTransparent: true,
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
            <Stack.Screen
              name="world/[id]"
              options={{
                headerTransparent: true,
                headerTitle: "",
                headerTintColor: "#FFFFFF",
                headerBackButtonDisplayMode: "minimal",
              }}
            />
          </Stack>
        </View>
      </ThemeProvider>
      <PushNotifications />
    </DeviceProfileProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.ink,
  },
});
