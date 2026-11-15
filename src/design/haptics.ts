import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

const enabled = Platform.OS === "ios" || Platform.OS === "android";

export const haptics = {
  tap: () => enabled && Haptics.selectionAsync(),
  press: () => enabled && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  success: () => enabled && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  error: () => enabled && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
};
