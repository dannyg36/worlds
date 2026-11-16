/**
 * Pearl: a luminous off-white page, true black ink, and one iridescent accent
 * (nacre) that only appears on the pearl itself and on worlds still forming.
 * The worlds bring the color; the interface stays quiet around them.
 */
export const color = {
  pearl: "#F7F6F2",
  pearlLight: "#FCFBF9",
  pearlDeep: "#EEECE6",
  paper: "#FFFFFF",
  ink: "#000000",
  inkSecondary: "rgba(0, 0, 0, 0.58)",
  inkTertiary: "rgba(0, 0, 0, 0.45)",
  inkFaint: "rgba(0, 0, 0, 0.12)",
  onInk: "#FBFAF7",
  hairline: "rgba(0, 0, 0, 0.08)",
  hairlineStrong: "rgba(0, 0, 0, 0.16)",
  blush: "#F3DDE3",
  lilac: "#E3DDF3",
  mint: "#D6ECE7",
  champagne: "#F2E8D5",
  danger: "#9E2F22",
  frost: "rgba(252, 251, 248, 0.76)",
  scrim: "rgba(247, 246, 242, 0.7)",
} as const;

/** The iridescent stops of a pearl, in order around the sphere. */
export const nacre = [color.blush, color.lilac, color.mint, color.champagne] as const;

/**
 * One family per weight, so native never synthesizes weights.
 * Never pair these with fontWeight.
 */
export const font = {
  display: "NotoSerifDisplay_200ExtraLight",
  serifLight: "NotoSerifDisplay_300Light",
  serifLightItalic: "NotoSerifDisplay_300Light_Italic",
  serif: "NotoSerifDisplay_400Regular",
  serifItalic: "NotoSerifDisplay_400Regular_Italic",
  sans: "AlbertSans_400Regular",
  sansMedium: "AlbertSans_500Medium",
  sansSemiBold: "AlbertSans_600SemiBold",
} as const;

/**
 * Serif (Noto Serif Display) for what people said and named;
 * sans (Albert Sans) for everything the app says.
 */
export const type = {
  display: { fontFamily: font.display, fontSize: 48, lineHeight: 52, letterSpacing: -1, color: color.ink },
  title: { fontFamily: font.serifLight, fontSize: 36, lineHeight: 42, letterSpacing: -0.6, color: color.ink },
  headline: { fontFamily: font.serifLight, fontSize: 28, lineHeight: 34, letterSpacing: -0.3, color: color.ink },
  heading: { fontFamily: font.serif, fontSize: 20, lineHeight: 25, letterSpacing: -0.15, color: color.ink },
  quote: { fontFamily: font.serifLightItalic, fontSize: 21, lineHeight: 31, color: color.ink },
  body: { fontFamily: font.sans, fontSize: 16, lineHeight: 24, color: color.inkSecondary },
  label: { fontFamily: font.sansMedium, fontSize: 15, lineHeight: 20, color: color.ink },
  caption: { fontFamily: font.sans, fontSize: 14, lineHeight: 20, color: color.inkSecondary },
  meta: { fontFamily: font.sansMedium, fontSize: 12, lineHeight: 16, letterSpacing: 0.1, color: color.inkTertiary },
} as const;

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 40, huge: 64 } as const;

/** Radii follow hierarchy: big plates are softer than small controls. */
export const radius = { xs: 8, sm: 12, md: 16, lg: 24, xl: 32, pill: 999 } as const;

export const shadow = {
  plate: "0 1px 2px rgba(0, 0, 0, 0.05), 0 22px 40px -26px rgba(0, 0, 0, 0.38)",
  raised: "0 1px 1px rgba(0, 0, 0, 0.04), 0 8px 22px -12px rgba(0, 0, 0, 0.2)",
  float: "0 2px 6px rgba(0, 0, 0, 0.05), 0 26px 50px -22px rgba(0, 0, 0, 0.3)",
} as const;

export const motion = {
  spring: { damping: 18, stiffness: 160, mass: 1 },
  gentle: { damping: 22, stiffness: 90, mass: 1 },
  stagger: 70,
  breathe: 3600,
  drift: 26000,
} as const;

export const layout = { gutter: 20, maxWidth: 560, pearl: 72 } as const;
