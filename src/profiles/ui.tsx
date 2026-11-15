import { DarkTheme, DefaultTheme } from "expo-router";
import {
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  type ColorValue,
} from "react-native";

/** Theme colors for screens drawn before the app's ThemeProvider mounts. */
export function useSchemeColors() {
  return (useColorScheme() === "dark" ? DarkTheme : DefaultTheme).colors;
}

export function Button({
  title,
  color,
  disabled = false,
  onPress,
}: {
  title: string;
  color: ColorValue;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        { backgroundColor: color, opacity: disabled ? 0.4 : 1 },
      ]}
    >
      <Text style={styles.buttonLabel}>{title}</Text>
    </Pressable>
  );
}

export const secondaryText = "#8E8E93";

export const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 12,
  },
  input: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 17,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  button: {
    alignItems: "center",
    borderRadius: 12,
    paddingVertical: 12,
  },
  buttonLabel: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
  label: {
    color: secondaryText,
    fontSize: 13,
    fontWeight: "500",
  },
  body: {
    fontSize: 17,
    lineHeight: 24,
  },
});
