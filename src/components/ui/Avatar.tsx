import { StyleSheet, Text, View } from "react-native";

import { color, font } from "@/design/tokens";

/**
 * A person as a paper disc with their initial in serif.
 * ring="fresh" draws a nacre ring (they made a world in the last day); "quiet" a hairline.
 */
export function Avatar({
  name,
  size = 40,
  ring = "none",
}: {
  name: string;
  size?: number;
  ring?: "fresh" | "quiet" | "none";
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "·";
  const disc = (
    <View style={[styles.disc, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.initial, { fontSize: Math.round(size * 0.42), lineHeight: Math.round(size * 0.52) }]}>
        {initial}
      </Text>
    </View>
  );
  if (ring === "none") {
    return disc;
  }
  const outer = size + 10;
  return (
    <View
      style={[
        styles.ring,
        ring === "fresh" ? styles.fresh : styles.quiet,
        { width: outer, height: outer, borderRadius: outer / 2 },
      ]}
    >
      <View style={[styles.gap, { width: size + 5, height: size + 5, borderRadius: (size + 5) / 2 }]}>{disc}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairlineStrong,
  },
  initial: {
    fontFamily: font.serif,
    color: color.ink,
  },
  ring: {
    alignItems: "center",
    justifyContent: "center",
  },
  fresh: {
    backgroundImage: "linear-gradient(140deg, #F0BECE 0%, #CCC0F4 35%, #B2E2D6 68%, #F4E2BC 100%)",
  },
  quiet: {
    borderWidth: 1,
    borderColor: color.hairlineStrong,
  },
  gap: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.pearl,
  },
});
