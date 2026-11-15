#!/usr/bin/env python3
"""Run MoGe-2 locally (CPU or GPU) on the perspective views from pipeline.mjs, as a stand-in for a hosted depth endpoint.

Writes per-view float32 ray-distance maps (0 = masked) and validity masks next to views.json and records
timings, so 'node pipeline.mjs fuse' can fuse them exactly like hosted MoGe output.
usage: python local_moge.py <out/day dir> [--model Ruicheng/moge-2-vitl-normal] [--level 9] [--threads 4]
"""
import argparse, json, os, sys, time
import numpy as np
import torch
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("dir")
ap.add_argument("--model", default="Ruicheng/moge-2-vitl-normal")
ap.add_argument("--level", type=int, default=9)
ap.add_argument("--threads", type=int, default=os.cpu_count() or 4)
ap.add_argument("--only", default=None, help="comma-separated view indices")
args = ap.parse_args()

torch.set_num_threads(args.threads)
from moge.model.v2 import MoGeModel

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
t0 = time.time()
model = MoGeModel.from_pretrained(args.model).to(device).eval()
load_s = time.time() - t0
vj_path = os.path.join(args.dir, "views.json")
vj = json.load(open(vj_path))
outd = os.path.join(args.dir, "moge_local")
os.makedirs(outd, exist_ok=True)
only = set(int(x) for x in args.only.split(",")) if args.only else None
times = []
for v in vj["views"]:
    if only is not None and v["i"] not in only:
        continue
    base = os.path.join(outd, "view_%02d" % v["i"])
    if os.path.exists(base + ".f32") and os.path.exists(base + "_mask.png"):
        v["moge"] = {"local": True, "model": args.model, "level": args.level, "device": str(device), "threads": args.threads,
                     "infer_s": None, "depth": base + ".f32", "mask": base + "_mask.png", "resumed": True}
        print("view %d: reused from an earlier run" % v["i"], flush=True)
        continue
    img = np.array(Image.open(os.path.join(args.dir, v["file"])).convert("RGB"))
    x = torch.tensor(img / 255.0, dtype=torch.float32, device=device).permute(2, 0, 1)
    t = time.time()
    with torch.inference_mode():
        out = model.infer(x, fov_x=float(v["fov"]), resolution_level=args.level, use_fp16=device.type == "cuda")
    dt = time.time() - t
    times.append(dt)
    pts = out["points"].cpu().numpy()
    mask = out["mask"].cpu().numpy().astype(bool)
    dist = np.linalg.norm(pts, axis=-1).astype(np.float32)
    dist[~mask | ~np.isfinite(dist)] = 0
    dist.tofile(base + ".f32")
    Image.fromarray((mask * 255).astype(np.uint8)).save(base + "_mask.png")
    K = out["intrinsics"].cpu().numpy().tolist()
    v["moge"] = {"local": True, "model": args.model, "level": args.level, "device": str(device), "threads": args.threads,
                 "infer_s": round(dt, 2), "intrinsics": K, "depth": base + ".f32", "mask": base + "_mask.png",
                 "valid_pct": round(100 * float(mask.mean()), 1)}
    print("view %d: %.1f s, valid %.1f%%, median dist %.2f m" % (v["i"], dt, 100 * mask.mean(), float(np.median(dist[mask])) if mask.any() else -1), flush=True)
vj["moge_local"] = {"model": args.model, "level": args.level, "device": str(device), "threads": args.threads, "load_s": round(load_s, 1),
                    "views_s": round(sum(times), 1), "per_view_s": round(sum(times) / max(1, len(times)), 2)}
json.dump(vj, open(vj_path, "w"), indent=2)
print(json.dumps(vj["moge_local"]))
