import { AlbertSans_400Regular } from "@expo-google-fonts/albert-sans/400Regular";
import { AlbertSans_500Medium } from "@expo-google-fonts/albert-sans/500Medium";
import { AlbertSans_600SemiBold } from "@expo-google-fonts/albert-sans/600SemiBold";
import { NotoSerifDisplay_200ExtraLight } from "@expo-google-fonts/noto-serif-display/200ExtraLight";
import { NotoSerifDisplay_300Light } from "@expo-google-fonts/noto-serif-display/300Light";
import { NotoSerifDisplay_300Light_Italic } from "@expo-google-fonts/noto-serif-display/300Light_Italic";
import { NotoSerifDisplay_400Regular } from "@expo-google-fonts/noto-serif-display/400Regular";
import { NotoSerifDisplay_400Regular_Italic } from "@expo-google-fonts/noto-serif-display/400Regular_Italic";
import { ConvexReactClient } from "convex/react";
import { useFonts } from "expo-font";
import { DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";

import { Backdrop } from "@/components/Backdrop";
import { color, font } from "@/design/tokens";
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
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: color.ink,
    background: "transparent",
    card: color.pearl,
    text: color.ink,
    border: color.hairline,
  },
};

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    NotoSerifDisplay_200ExtraLight,
    NotoSerifDisplay_300Light,
    NotoSerifDisplay_300Light_Italic,
    NotoSerifDisplay_400Regular,
    NotoSerifDisplay_400Regular_Italic,
    AlbertSans_400Regular,
    AlbertSans_500Medium,
    AlbertSans_600SemiBold,
  });
  const ready = fontsLoaded || fontError !== null;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <View style={styles.root}>
      <Backdrop />
      <StatusBar style="dark" />
      <DeviceProfileProvider client={convex}>
        <ThemeProvider value={theme}>
          <Stack
            screenOptions={{
              contentStyle: { backgroundColor: "transparent" },
              headerTransparent: true,
              headerShadowVisible: false,
              headerTintColor: color.ink,
              headerTitleStyle: { fontFamily: font.serif, fontSize: 20, color: color.ink },
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
                headerBackButtonDisplayMode: "minimal",
              }}
            />
            <Stack.Screen
              name="stories/[person]"
              options={{
                presentation: "fullScreenModal",
                headerShown: false,
                animation: "fade",
              }}
            />
          </Stack>
        </ThemeProvider>
        <PushNotifications />
      </DeviceProfileProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.pearl,
  },
});
