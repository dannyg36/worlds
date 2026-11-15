"""Panorama utilities for the skybox spike.

Run with: uv run --with numpy --with pillow python spike/walkable/skybox/tools/pano.py <cmd> ...

Conventions match three.js equirect sampling: pixel (x, y) -> theta = 2*pi*x/W - pi,
lat = pi*(0.5 - y/H), dir = (cos lat cos theta, sin lat, cos lat sin theta).
The image center (theta = 0) is +x, the direction the prototype starts facing.
"""
import argparse
import json
import math
import sys

import numpy as np
from PIL import Image, ImageDraw


def load(path):
    return np.asarray(Image.open(path).convert("RGB")).astype(np.float32)


def save(arr, path, quality=90):
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    if path.lower().endswith((".jpg", ".jpeg")):
        img.save(path, quality=quality, subsampling=0 if quality >= 90 else 2, optimize=True, progressive=True)
    else:
        img.save(path, optimize=True)


def sample(erp, dirs):
    H, W, _ = erp.shape
    x, y, z = dirs[..., 0], dirs[..., 1], dirs[..., 2]
    theta = np.arctan2(z, x)
    lat = np.arcsin(np.clip(y, -1, 1))
    u = (theta + math.pi) / (2 * math.pi) * W - 0.5
    v = (0.5 - lat / math.pi) * H - 0.5
    u0 = np.floor(u).astype(np.int64)
    v0 = np.clip(np.floor(v).astype(np.int64), 0, H - 1)
    v1 = np.clip(v0 + 1, 0, H - 1)
    fu = (u - u0)[..., None]
    fv = np.clip(v - np.floor(v), 0, 1)[..., None]
    u0w = u0 % W
    u1w = (u0 + 1) % W
    top = erp[v0, u0w] * (1 - fu) + erp[v0, u1w] * fu
    bot = erp[v1, u0w] * (1 - fu) + erp[v1, u1w] * fu
    return top * (1 - fv) + bot * fv


def basis(yaw_deg, pitch_deg):
    psi, phi = math.radians(yaw_deg), math.radians(pitch_deg)
    f = np.array([math.cos(phi) * math.cos(psi), math.sin(phi), math.cos(phi) * math.sin(psi)])
    r = np.array([-math.sin(psi), 0.0, math.cos(psi)])
    u = np.cross(r, f)
    return f, r, u


def view(erp, yaw, pitch, fov=90, size=512):
    f, r, u = basis(yaw, pitch)
    t = math.tan(math.radians(fov) / 2)
    s = (np.arange(size) + 0.5) / size * 2 - 1
    nx, ny = np.meshgrid(s * t, -s * t)
    d = f[None, None] + nx[..., None] * r[None, None] + ny[..., None] * u[None, None]
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    return sample(erp, d)


def metrics(path):
    img = load(path)
    H, W, _ = img.shape
    rows = slice(int(H * 0.05), int(H * 0.95))
    edge = np.abs(img[rows, 0] - img[rows, W - 1]).mean()
    rng = np.random.default_rng(0)
    cols = rng.integers(1, W - 2, 64)
    adj = np.median([np.abs(img[rows, c] - img[rows, c + 1]).mean() for c in cols])
    band = max(2, H // 100)
    gray = img.mean(axis=2)
    gx = np.abs(np.diff(gray, axis=1))
    mid = gx[int(H * 0.45):int(H * 0.55)].mean()
    return {
        "file": path,
        "size": [W, H],
        "aspect": round(W / H, 3),
        "seam_ratio": round(float(edge / max(adj, 1e-6)), 2),
        "seam_mean_abs_diff": round(float(edge), 2),
        "pole_top_std": round(float(img[:band].std(axis=(0, 1)).mean()), 2),
        "pole_bottom_std": round(float(img[-band:].std(axis=(0, 1)).mean()), 2),
        "pole_top_detail": round(float(gx[:band].mean() / max(mid, 1e-6)), 2),
        "pole_bottom_detail": round(float(gx[-band:].mean() / max(mid, 1e-6)), 2),
    }


def sheet(path, out, label=None):
    erp = load(path)
    tile = 360
    views = [("front 0", 0, 0), ("right 90", 90, 0), ("back 180 (seam)", 180, 0), ("left 270", 270, 0), ("up", 0, 90), ("down", 0, -90)]
    W = tile * 3
    erp_small = np.asarray(Image.fromarray(erp.astype(np.uint8)).resize((W, W // 2), Image.LANCZOS)).astype(np.float32)
    canvas = Image.new("RGB", (W, W // 2 + tile * 2 + 28), (16, 16, 16))
    canvas.paste(Image.fromarray(erp_small.astype(np.uint8)), (0, 28))
    draw = ImageDraw.Draw(canvas)
    m = metrics(path)
    draw.text((6, 6), (label or path.split("/")[-1]) + f"   {m['size'][0]}x{m['size'][1]}  seam {m['seam_ratio']}  pole detail top {m['pole_top_detail']} bottom {m['pole_bottom_detail']}", fill=(235, 235, 235))
    for i, (name, yaw, pitch) in enumerate(views):
        v = view(erp, yaw, pitch, 90, tile)
        x, y = (i % 3) * tile, W // 2 + 28 + (i // 3) * tile
        canvas.paste(Image.fromarray(np.clip(v, 0, 255).astype(np.uint8)), (x, y))
        draw.rectangle([x + 4, y + 4, x + 8 + 7 * len(name), y + 18], fill=(0, 0, 0))
        draw.text((x + 6, y + 5), name, fill=(255, 255, 255))
    canvas.save(out, quality=88)
    return m


def roll(path, out, mask_out=None, band=160):
    img = load(path)
    H, W, _ = img.shape
    rolled = np.roll(img, W // 2, axis=1)
    save(rolled, out)
    if mask_out:
        mask = np.zeros((H, W), np.uint8)
        mask[:, W // 2 - band // 2: W // 2 + band // 2] = 255
        Image.fromarray(mask).save(mask_out)


def control(path, out, hfov=90, yaw=0, pitch=0, W=2048):
    ref = load(path)
    h, w, _ = ref.shape
    H = W // 2
    xs = (np.arange(W) + 0.5) / W
    ys = (np.arange(H) + 0.5) / H
    th = 2 * math.pi * xs - math.pi
    lat = math.pi * (0.5 - ys)
    TH, LAT = np.meshgrid(th, lat)
    d = np.stack([np.cos(LAT) * np.cos(TH), np.sin(LAT), np.cos(LAT) * np.sin(TH)], -1)
    f, r, u = basis(yaw, pitch)
    cx, cy, cz = d @ r, d @ u, d @ f
    tx = math.tan(math.radians(hfov) / 2)
    ty = tx * h / w
    with np.errstate(divide="ignore", invalid="ignore"):
        px = cx / cz / tx
        py = cy / cz / ty
    inside = (cz > 0) & (np.abs(px) <= 1) & (np.abs(py) <= 1)
    col = np.clip(((px + 1) / 2 * w).astype(np.int64), 0, w - 1)
    row = np.clip(((1 - py) / 2 * h).astype(np.int64), 0, h - 1)
    canvas = np.zeros((H, W, 3), np.float32)
    canvas[...] = (0, 255, 0)
    canvas[inside] = ref[row[inside], col[inside]]
    save(canvas, out)


def cutout(path, out, size=1024, margin=0.02):
    img = Image.open(path).convert("RGBA")
    a = np.asarray(img)[..., 3]
    ys, xs = np.where(a > 8)
    pad = int(max(img.size) * margin)
    box = (max(0, xs.min() - pad), max(0, ys.min() - pad), min(img.width, xs.max() + 1 + pad), min(img.height, ys.max() + 1))
    img = img.crop(box)
    k = size / max(img.size)
    img = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
    img.save(out, optimize=True)
    return {"file": out, "size": [img.width, img.height], "crop": [int(v) for v in box]}


def tojpg(path, out, width=None, quality=88):
    img = Image.open(path).convert("RGB")
    if width and img.width != width:
        img = img.resize((width, width // 2), Image.LANCZOS)
    img.save(out, quality=quality, optimize=True, progressive=True)
    return {"file": out, "size": [img.width, img.height]}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("metrics"); a.add_argument("files", nargs="+")
    a = sub.add_parser("sheet"); a.add_argument("file"); a.add_argument("out"); a.add_argument("--label")
    a = sub.add_parser("roll"); a.add_argument("file"); a.add_argument("out"); a.add_argument("--mask"); a.add_argument("--band", type=int, default=160)
    a = sub.add_parser("control"); a.add_argument("file"); a.add_argument("out"); a.add_argument("--hfov", type=float, default=90); a.add_argument("--yaw", type=float, default=0); a.add_argument("--pitch", type=float, default=0); a.add_argument("--width", type=int, default=2048)
    a = sub.add_parser("cutout"); a.add_argument("file"); a.add_argument("out"); a.add_argument("--size", type=int, default=1024)
    a = sub.add_parser("tojpg"); a.add_argument("file"); a.add_argument("out"); a.add_argument("--width", type=int); a.add_argument("--quality", type=int, default=88)
    args = ap.parse_args()
    if args.cmd == "metrics":
        print(json.dumps([metrics(f) for f in args.files], indent=1))
    elif args.cmd == "sheet":
        print(json.dumps(sheet(args.file, args.out, args.label)))
    elif args.cmd == "roll":
        roll(args.file, args.out, args.mask, args.band)
    elif args.cmd == "control":
        control(args.file, args.out, args.hfov, args.yaw, args.pitch, args.width)
    elif args.cmd == "cutout":
        print(json.dumps(cutout(args.file, args.out, args.size)))
    elif args.cmd == "tojpg":
        print(json.dumps(tojpg(args.file, args.out, args.width, args.quality)))
