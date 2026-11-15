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

export function auroraBase(palette: string[]) {
  const darkest = [...palette].sort((a, b) => lightness(a) - lightness(b))[0];
  return mix(darkest, "#05040C", 0.6);
}

export function auroraGlows(palette: string[]) {
  return [...palette]
    .sort(
      (a, b) => saturation(b) + lightness(b) - (saturation(a) + lightness(a)),
    )
    .slice(0, 3);
}

export function saturation(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
}
