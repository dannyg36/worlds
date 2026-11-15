"""Cut the plain studio background out of concept images, keeping the whole diorama base.

Flood-fills from the image border over pixels close to the border's median colour, so enclosed regions of that colour
(a white awning) stay opaque. --gaps lists days whose enclosed background-coloured gaps larger than 0.3% of the image
(the sky between string lights) should also be cleared. Writes RGBA PNGs to out/<tag>/_rgba/<day>.png.
Run: uv run --with numpy --with scipy --with pillow python cutout.py [--tag hf] [--threshold 28] [--gaps birthday-dinner]
"""
import argparse
import json
import pathlib

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

HERE = pathlib.Path(__file__).resolve().parent


def cutout(path, threshold, clear_gaps=False):
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    ring = np.concatenate([rgb[:8].reshape(-1, 3), rgb[-8:].reshape(-1, 3), rgb[:, :8].reshape(-1, 3), rgb[:, -8:].reshape(-1, 3)])
    distance = np.linalg.norm(rgb - np.median(ring, axis=0), axis=2)
    labels, _ = ndimage.label(distance < threshold)
    edge = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    background = np.isin(labels, edge[edge > 0])
    gaps, count = ndimage.label(distance < threshold / 2.5)
    if clear_gaps and count:
        sizes = ndimage.sum(np.ones_like(gaps), gaps, range(1, count + 1))
        background |= np.isin(gaps, 1 + np.flatnonzero(sizes > 0.003 * gaps.size))
    parts, count = ndimage.label(~background)
    if count > 1:
        sizes = ndimage.sum(np.ones_like(parts), parts, range(1, count + 1))
        background |= np.isin(parts, 1 + np.flatnonzero(sizes < 0.002 * parts.size))
    alpha = Image.fromarray(np.where(background, 0, 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    image = Image.fromarray(rgb.astype(np.uint8)).convert("RGBA")
    image.putalpha(alpha)
    return image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", default="hf")
    parser.add_argument("--threshold", type=float, default=22)
    parser.add_argument("--days", default="")
    parser.add_argument("--gaps", default="")
    args = parser.parse_args()
    days = [d for d in args.days.split(",") if d] or list(json.loads((HERE / "days.json").read_text()))
    target = HERE / "out" / args.tag / "_rgba"
    target.mkdir(parents=True, exist_ok=True)
    for day in days:
        cutout(HERE / "out" / "concept" / (day + ".png"), args.threshold, day in args.gaps.split(",")).save(target / (day + ".png"))
        print("cut", day)


if __name__ == "__main__":
    main()
