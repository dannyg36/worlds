import { color } from "@/design/tokens";

export function hexToRgb(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export function withAlpha(hex: string, alpha: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function mix(from: string, to: string, amount: number) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const channel = (x: number, y: number) =>
    Math.round(x + (y - x) * amount)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(a.r, b.r)}${channel(a.g, b.g)}${channel(a.b, b.b)}`;
}

export function lightness(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
}

/**
 * The world's pearl: the page tinted by the palette's deepest color, which
 * carries the day's ambient mood. Lifted to a light tone first, so night
 * blues and forest greens become a cool pearl instead of a muddy gray.
 */
export function auroraBase(palette: string[]) {
  const darkest = [...palette].sort((a, b) => lightness(a) - lightness(b))[0];
  return mix(tone(darkest, 0.9), color.pearl, 0.7);
}

/** Pastel versions of the palette's three most characterful colors, most vivid first. */
export function auroraGlows(palette: string[]) {
  return [...palette]
    .sort((a, b) => vividness(b) - vividness(a))
    .slice(0, 3)
    .map((hex) => tone(hex, 0.8));
}

export function saturation(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
}

/** Saturated mid-tones score highest; near-blacks, near-whites and grays lowest. */
export function vividness(hex: string) {
  return saturation(hex) * (1 - Math.abs(lightness(hex) - 0.55));
}

/**
 * The same hue re-voiced at the given lightness. Muted colors get a little
 * more saturation and vivid ones are capped, so night blues and neon pinks
 * both land somewhere calm.
 */
export function tone(hex: string, light: number, maxSaturation = 0.65) {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  const sector =
    delta === 0
      ? 0
      : max === r
        ? ((g - b) / delta + 6) % 6
        : max === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4;
  const s = Math.min(saturation(hex) * 1.4, maxSaturation);
  const chroma = (1 - Math.abs(2 * light - 1)) * s;
  const channel = (offset: number) => {
    const k = (offset + sector) % 6;
    const ramp = Math.max(0, Math.min(1, Math.abs(k - 3) - 1));
    return Math.round((light + chroma * (ramp - 0.5)) * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(4)}${channel(2)}`;
}
