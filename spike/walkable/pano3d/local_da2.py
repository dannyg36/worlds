#!/usr/bin/env python3
"""Depth Anything V2 (metric checkpoints) on CPU, as a stand-in for a hosted depth endpoint.

Two modes:
  per-crop:  python local_da2.py out/<day> --scene indoor     -> view_XX ray-distance maps for 'node pipeline.mjs fuse --src da2'
  one-shot:  python local_da2.py out/<day> --scene indoor --equirect   -> da2_equirect.f32 (1024x512) for 'node pipeline.mjs da2eq'
"""
import argparse, json, os, time
import numpy as np
import torch
from PIL import Image
from transformers import AutoImageProcessor, AutoModelForDepthEstimation

ap = argparse.ArgumentParser()
ap.add_argument("dir")
ap.add_argument("--scene", choices=["indoor", "outdoor"], default="indoor")
ap.add_argument("--size", default="Small", choices=["Small", "Base", "Large"])
ap.add_argument("--equirect", action="store_true")
ap.add_argument("--threads", type=int, default=os.cpu_count() or 4)
args = ap.parse_args()
torch.set_num_threads(args.threads)

model_id = "depth-anything/Depth-Anything-V2-Metric-%s-%s-hf" % (args.scene.capitalize(), args.size)
t0 = time.time()
proc = AutoImageProcessor.from_pretrained(model_id)
model = AutoModelForDepthEstimation.from_pretrained(model_id).eval()
load_s = time.time() - t0


def infer(img):
    inputs = proc(images=img, return_tensors="pt")
    with torch.inference_mode():
        pred = model(**inputs).predicted_depth
    pred = torch.nn.functional.interpolate(pred.unsqueeze(1), size=(img.size[1], img.size[0]), mode="bicubic", align_corners=False)[0, 0]
    return pred.clamp(min=1e-3).numpy().astype(np.float32)


if args.equirect:
    img = Image.open(os.path.join(args.dir, "pano.jpg")).convert("RGB").resize((1024, 512), Image.BICUBIC)
    t = time.time()
    d = infer(img)
    dt = time.time() - t
    d.tofile(os.path.join(args.dir, "da2_equirect.f32"))
    info = {"model": model_id, "device": "cpu", "threads": args.threads, "load_s": round(load_s, 1), "infer_s": round(dt, 2), "w": 1024, "h": 512,
            "median_m": round(float(np.median(d)), 2)}
    json.dump(info, open(os.path.join(args.dir, "da2_equirect.json"), "w"), indent=2)
    print(json.dumps(info))
else:
    vj_path = os.path.join(args.dir, "views.json")
    vj = json.load(open(vj_path))
    outd = os.path.join(args.dir, "da2_local")
    os.makedirs(outd, exist_ok=True)
    times = []
    for v in vj["views"]:
        img = Image.open(os.path.join(args.dir, v["file"])).convert("RGB")
        S = v["S"]
        F = S / 2 / np.tan(np.radians(v["fov"] / 2))
        t = time.time()
        z = infer(img)
        dt = time.time() - t
        times.append(dt)
        xs = (np.arange(S) + 0.5 - S / 2) / F
        X, Y = np.meshgrid(xs, xs)
        r = (z * np.sqrt(1 + X ** 2 + Y ** 2)).astype(np.float32)
        base = os.path.join(outd, "view_%02d" % v["i"])
        r.tofile(base + ".f32")
        Image.fromarray(np.full((S, S), 255, np.uint8)).save(base + "_mask.png")
        v["da2"] = {"local": True, "model": model_id, "infer_s": round(dt, 2), "depth": base + ".f32", "mask": base + "_mask.png"}
        print("view %d: %.2f s, median %.2f m" % (v["i"], dt, float(np.median(r))), flush=True)
    vj["da2_local"] = {"model": model_id, "device": "cpu", "threads": args.threads, "load_s": round(load_s, 1),
                       "views_s": round(sum(times), 1), "per_view_s": round(sum(times) / max(1, len(times)), 2)}
    json.dump(vj, open(vj_path, "w"), indent=2)
    print(json.dumps(vj["da2_local"]))
