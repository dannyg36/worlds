import { Platform } from "react-native";

export const color = {
  ink: "#05060F",
  night: "#0A0B1E",
  dusk: "#1B1240",
  violet: "#8B6CFF",
  lilac: "#C9B8FF",
  aurora: "#5BE3D4",
  mint: "#7CF6E4",
  mist: "#C8C4F0",
  ember: "#FF9A7A",
  rose: "#FF7EB6",
  text: "#F5F3FF",
  textSecondary: "rgba(236, 232, 255, 0.66)",
  textTertiary: "rgba(236, 232, 255, 0.42)",
  danger: "#FF8A8A",
  glassFill: "rgba(28, 24, 64, 0.32)",
  glassFillStrong: "rgba(22, 18, 52, 0.62)",
  glassTint: "rgba(120, 100, 255, 0.10)",
  hairline: "rgba(255, 255, 255, 0.12)",
  hairlineTop: "rgba(255, 255, 255, 0.34)",
  highlight: "rgba(255, 255, 255, 0.09)",
  scrim: "rgba(3, 3, 12, 0.55)",
} as const;

export const fontFamily = {
  display: "InstrumentSerif_400Regular",
  displayItalic: "InstrumentSerif_400Regular_Italic",
  system: Platform.select({ web: "system-ui, -apple-system, 'SF Pro Text', 'Segoe UI', sans-serif", default: undefined }),
} as const;

export const type = {
  hero: { fontFamily: fontFamily.display, fontSize: 52, lineHeight: 54, letterSpacing: -1, color: color.text },
  title: { fontFamily: fontFamily.display, fontSize: 32, lineHeight: 36, letterSpacing: -0.4, color: color.text },
  cardTitle: { fontFamily: fontFamily.display, fontSize: 30, lineHeight: 33, letterSpacing: -0.3, color: color.text },
  cardTitleCompact: { fontFamily: fontFamily.display, fontSize: 22, lineHeight: 25, letterSpacing: -0.2, color: color.text },
  section: { fontFamily: fontFamily.displayItalic, fontSize: 24, lineHeight: 28, color: color.text },
  body: { fontFamily: fontFamily.system, fontSize: 16, lineHeight: 23, color: color.textSecondary },
  bodyStrong: { fontFamily: fontFamily.system, fontSize: 16, lineHeight: 22, fontWeight: "600", color: color.text },
  caption: { fontFamily: fontFamily.system, fontSize: 13, lineHeight: 18, color: color.textSecondary },
  eyebrow: {
    fontFamily: fontFamily.system,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "600",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: color.textTertiary,
  },
  label: { fontFamily: fontFamily.system, fontSize: 15, lineHeight: 20, fontWeight: "600", color: color.text },
  chip: { fontFamily: fontFamily.system, fontSize: 12, lineHeight: 16, fontWeight: "600", letterSpacing: 0.2, color: color.text },
} as const;

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 40, huge: 64 } as const;

export const radius = { sm: 12, md: 18, lg: 26, xl: 34, pill: 999 } as const;

export const blur = { subtle: 18, regular: 32, strong: 54 } as const;

export const motion = {
  spring: { damping: 18, stiffness: 160, mass: 1 },
  gentle: { damping: 22, stiffness: 90, mass: 1 },
  stagger: 70,
  breathe: 3200,
  drift: 24000,
} as const;

export const layout = { gutter: 20, orb: 78, maxWidth: 560 } as const;
