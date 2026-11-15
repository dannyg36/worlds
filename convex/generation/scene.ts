export type Scene = {
  title: string;
  caption: string;
  palette: string[];
  imagePrompt: string;
};

const HEX_COLOR = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function parseScene(text: string): Scene {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) {
    throw new Error("The scene writer returned no JSON object.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("The scene writer returned invalid JSON.");
  }
  const fields = (raw ?? {}) as Record<string, unknown>;
  const palette = (Array.isArray(fields.palette) ? fields.palette : [])
    .map((color) => (typeof color === "string" ? color.trim() : ""))
    .filter((color) => HEX_COLOR.test(color))
    .map(normalizeHex)
    .slice(0, 5);
  if (palette.length < 3) {
    throw new Error("The scene writer returned fewer than 3 palette colors.");
  }
  return {
    title: cleanText(fields.title, "title", 60),
    caption: cleanText(fields.caption, "caption", 160),
    palette,
    imagePrompt: cleanText(fields.imagePrompt, "image prompt", 2000),
  };
}

function cleanText(value: unknown, field: string, maxLength: number): string {
  const text =
    typeof value === "string"
      ? value
          .replace(/\s+/g, " ")
          .replace(/^["'“”]+|["'“”]+$/g, "")
          .trim()
      : "";
  if (!text) {
    throw new Error(`The scene writer returned no ${field}.`);
  }
  return text.slice(0, maxLength);
}

function normalizeHex(color: string): string {
  const digits = color.replace("#", "").toLowerCase();
  return digits.length === 3
    ? `#${[...digits].map((digit) => digit + digit).join("")}`
    : `#${digits}`;
}
