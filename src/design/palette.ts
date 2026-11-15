import { color } from "./tokens";

const fallback = [color.violet, color.aurora, color.rose];

export function worldPalette(palette?: string[]) {
  return palette && palette.length > 0 ? palette : fallback;
}

export function withAlpha(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value.slice(0, 6);
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return `rgba(139, 108, 255, ${alpha})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
