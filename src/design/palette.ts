import { color } from "./tokens";

const fallback = [color.lilac, color.mint, color.blush];

export function worldPalette(palette?: string[]) {
  return palette && palette.length > 0 ? palette : fallback;
}

export function withAlpha(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value.slice(0, 6);
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return `rgba(227, 221, 243, ${alpha})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
