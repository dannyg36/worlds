"""Compose a contact sheet from a JSON layout.

layout = {
  "title": str, "subtitle": str, "meta": str, "out": path, "width": 2400,
  "sections": [
    {"label": str, "cols": int, "rows": [{"label": str, "tiles": [{"img": path|null, "caption": str|null, "sub": str|null}]}]}
  ]
}
"""
import json, sys, textwrap
from PIL import Image, ImageDraw, ImageFont

BG = (243, 241, 236)
TILE_BG = (233, 230, 223)
INK = (34, 32, 30)
MUTED = (120, 114, 106)
FONT_DIR = "/usr/share/fonts/opentype/inter/"

def font(weight, size):
    return ImageFont.truetype(FONT_DIR + {"bold": "Inter-SemiBold.otf", "medium": "Inter-Medium.otf", "regular": "Inter-Regular.otf"}[weight], size)

def fit(img_path, size):
    tile = Image.new("RGBA", (size, size), TILE_BG + (255,))
    if not img_path:
        return tile
    im = Image.open(img_path).convert("RGBA")
    im.thumbnail((size, size), Image.LANCZOS)
    tile.alpha_composite(im, ((size - im.width) // 2, (size - im.height) // 2))
    return tile

def wrap(draw, text, f, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=f) <= width:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines

def main(path):
    L = json.load(open(path))
    W = L.get("width", 2400)
    M = 48
    gap = 12
    probe = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    blocks = []
    y = M
    ft, fs, fm = font("bold", 54), font("regular", 22), font("regular", 19)
    sub_lines = wrap(probe, L.get("subtitle", ""), fs, W - 2 * M)
    y += 64 + 30 * len(sub_lines) + (28 if L.get("meta") else 0) + 24
    for sec in L["sections"]:
        cols = sec["cols"]
        size = (W - 2 * M - (cols - 1) * gap) // cols
        y += 46
        for row in sec["rows"]:
            if row.get("label"):
                y += 30
            has_cap = any(t.get("caption") for t in row["tiles"])
            has_sub = any(t.get("sub") for t in row["tiles"])
            y += size + (26 if has_cap else 0) + (20 if has_sub else 0) + gap
        y += 18
    H = y + M
    canvas = Image.new("RGBA", (W, H), BG + (255,))
    d = ImageDraw.Draw(canvas)
    y = M
    d.text((M, y), L["title"], font=ft, fill=INK)
    y += 64
    for line in sub_lines:
        d.text((M, y), line, font=fs, fill=INK)
        y += 30
    if L.get("meta"):
        d.text((M, y), L["meta"], font=fm, fill=MUTED)
        y += 28
    y += 24
    for sec in L["sections"]:
        cols = sec["cols"]
        size = (W - 2 * M - (cols - 1) * gap) // cols
        d.line([(M, y + 4), (W - M, y + 4)], fill=(214, 209, 200), width=2)
        d.text((M, y + 12), sec["label"], font=font("medium", 24), fill=INK)
        y += 46
        for row in sec["rows"]:
            if row.get("label"):
                d.text((M, y + 2), row["label"], font=font("medium", 18), fill=MUTED)
                y += 30
            has_cap = any(t.get("caption") for t in row["tiles"])
            has_sub = any(t.get("sub") for t in row["tiles"])
            for i, t in enumerate(row["tiles"]):
                x = M + i * (size + gap)
                canvas.alpha_composite(fit(t.get("img"), size), (x, y))
                if t.get("tag"):
                    f = font("medium", 15)
                    tw = d.textlength(t["tag"], font=f)
                    d.rounded_rectangle([x + 8, y + 8, x + 8 + tw + 14, y + 8 + 24], radius=6, fill=(255, 255, 255, 230))
                    d.text((x + 15, y + 11), t["tag"], font=f, fill=INK)
                cy = y + size + 4
                if t.get("caption"):
                    cap = t["caption"]
                    f = font("medium", 17)
                    while d.textlength(cap, font=f) > size and len(cap) > 3:
                        cap = cap[:-2]
                    if cap != t["caption"]:
                        cap = cap.rstrip() + "…"
                    d.text((x, cy), cap, font=f, fill=INK)
                    cy += 26
                if t.get("sub"):
                    d.text((x, cy), t["sub"], font=font("regular", 15), fill=MUTED)
            y += size + (26 if has_cap else 0) + (20 if has_sub else 0) + gap
        y += 18
    out = L["out"]
    img = canvas.convert("RGB")
    if out.endswith(".jpg"):
        img.save(out, quality=88, optimize=True)
    else:
        img.save(out)
    print("wrote", out, img.size)

if __name__ == "__main__":
    main(sys.argv[1])
