import { SymbolView, type SymbolViewProps } from "expo-symbols";

import { color } from "@/design/tokens";

export type IconName = Extract<SymbolViewProps["name"], { ios?: unknown }>;

export function Icon({
  name,
  size = 20,
  tint = color.text,
  weight = "semibold",
}: {
  name: IconName;
  size?: number;
  tint?: string;
  weight?: "regular" | "medium" | "semibold" | "bold";
}) {
  return <SymbolView name={{ ...name, android: name.android ?? name.web }} size={size} tintColor={tint} weight={weight} />;
}
