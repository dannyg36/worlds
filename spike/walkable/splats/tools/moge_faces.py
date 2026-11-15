#!/usr/bin/env python3
"""MoGe-2 on CPU for the cube faces of a panorama (experiment 2, CPU depth).

  .venv/bin/python tools/moge_faces.py --faces work/x/face-*.png --fov 100 --out work/x/depth [--model Ruicheng/moge-2-vits-normal]

Writes <face>.f32 (float32 range in metres along each pixel ray, NaN where MoGe masks the pixel out, e.g. sky)
and moge.json with wall and CPU seconds per face."""
import argparse, json, os, time
import numpy as np
import torch
from PIL import Image
from moge.model.v2 import MoGeModel

ap = argparse.ArgumentParser()
ap.add_argument("--faces", nargs="+", required=True)
ap.add_argument("--fov", type=float, default=100.0)
ap.add_argument("--model", default="Ruicheng/moge-2-vits-normal")
ap.add_argument("--out", required=True)
ap.add_argument("--resolution-level", type=int, default=9)
ap.add_argument("--threads", type=int, default=os.cpu_count() or 4)
args = ap.parse_args()
torch.set_num_threads(args.threads)
os.makedirs(args.out, exist_ok=True)

t0 = time.time()
model = MoGeModel.from_pretrained(args.model).eval()
load_s = time.time() - t0
faces = []
for f in args.faces:
    img = np.asarray(Image.open(f).convert("RGB"), dtype=np.float32) / 255.0
    x = torch.from_numpy(img).permute(2, 0, 1).contiguous()
    w0, c0 = time.time(), time.process_time()
    out = model.infer(x, fov_x=args.fov, resolution_level=args.resolution_level, apply_mask=True, use_fp16=False)
    wall, cpu = time.time() - w0, time.process_time() - c0
    pts = out["points"].numpy()
    r = np.linalg.norm(pts, axis=-1).astype(np.float32)
    valid = np.isfinite(r)
    if "mask" in out and out["mask"] is not None:
        valid &= out["mask"].numpy().astype(bool)
    r[~valid] = np.nan
    name = os.path.splitext(os.path.basename(f))[0]
    r.tofile(os.path.join(args.out, name + ".f32"))
    K = out["intrinsics"].numpy().tolist() if "intrinsics" in out else None
    faces.append({"face": name, "width": int(r.shape[1]), "height": int(r.shape[0]), "wall_s": round(wall, 2), "cpu_s": round(cpu, 2),
                  "valid_frac": round(float(valid.mean()), 4), "median_range_m": round(float(np.nanmedian(r)) if valid.any() else -1, 3), "intrinsics": K})
    print(json.dumps(faces[-1]), flush=True)
summary = {"model": args.model, "fov": args.fov, "resolution_level": args.resolution_level, "threads": args.threads, "load_s": round(load_s, 2),
           "total_wall_s": round(time.time() - t0, 2), "faces": faces}
json.dump(summary, open(os.path.join(args.out, "moge.json"), "w"), indent=2)
print(json.dumps({k: v for k, v in summary.items() if k != "faces"}))
