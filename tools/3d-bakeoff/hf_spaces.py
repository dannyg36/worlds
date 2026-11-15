"""Generate bake-off GLBs through public Hugging Face Spaces (ZeroGPU), writing the same out/<tag>/<candidate>/<day>.glb layout as run.mjs.

Inputs are the background-free cutouts that cutout.py writes to out/<tag>/_rgba/<day>.png.
Run: uv run --with gradio_client python hf_spaces.py --candidates hf-sf3d [--days a,b] [--tag hf]
Anonymous ZeroGPU calls share a 2-minute daily GPU quota per caller, and a Space only starts a call when the
remaining quota covers its declared duration, so a quota error halts the whole run instead of retrying.
"""
import argparse
import datetime
import json
import pathlib
import shutil
import time

from gradio_client import Client, handle_file

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "out"


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def file_arg(value):
    if isinstance(value, dict):
        value = value.get("path") or value.get("value")
    return handle_file(str(value))


class Timer:
    def __init__(self):
        self.t0 = time.perf_counter()
        self.steps = []

    def at(self):
        return round(time.perf_counter() - self.t0, 3)

    def call(self, client, api_name, *args, **kwargs):
        start = self.at()
        job = client.submit(*args, api_name=api_name, **kwargs)
        states = []
        while not job.done():
            code = job.status().code.name
            if not states or states[-1][0] != code:
                states.append((code, self.at()))
            time.sleep(0.2)
        processing = next((t for code, t in states if code in ("PROCESSING", "ITERATING", "PROGRESS")), None)
        try:
            return job.result()
        finally:
            self.steps.append({"api": api_name, "start_s": start, "processing_s": processing, "end_s": self.at(), "states": states})


def sf3d(client, rgba, timer, opts):
    timer.call(client, "/requires_bg_remove", image=handle_file(str(rgba)), fr=0.85)
    _, glb = timer.call(client, "/run_button", "Run", handle_file(str(rgba)), 0.85, opts.get("remesh", "None"), -1, opts.get("texture_size", 1024))
    return glb


def hunyuan(client, rgba, timer, opts):
    kwargs = dict(image=handle_file(str(rgba)), mv_image_front=None, mv_image_back=None, mv_image_left=None, mv_image_right=None, steps=opts.get("steps", 30), guidance_scale=5.0, seed=opts.get("seed", 1234), octree_resolution=opts.get("octree", 256), check_box_rembg=False, num_chunks=8000, randomize_seed=False)
    if opts.get("caption"):
        kwargs["caption"] = None
    out = timer.call(client, "/generation_all", **kwargs)
    return out[1]


def trellis2(client, rgba, timer, opts):
    timer.call(client, "/start_session")
    processed = timer.call(client, "/preprocess_image", input=handle_file(str(rgba)))
    timer.call(client, "/image_to_3d", image=file_arg(processed), seed=opts.get("seed", 0), resolution=opts.get("resolution", "1024"))
    glb, download = timer.call(client, "/extract_glb", decimation_target=opts.get("faces", 300000), texture_size=opts.get("texture_size", 2048))
    return download or glb


RECIPES = {
    "hf-sf3d": ("stabilityai/stable-fast-3d", sf3d, {}),
    "hf-hunyuan2": ("tencent/Hunyuan3D-2", hunyuan, {"caption": True}),
    "hf-hunyuan21": ("tencent/Hunyuan3D-2.1", hunyuan, {}),
    "hf-trellis2": ("microsoft/TRELLIS.2", trellis2, {}),
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidates", required=True)
    parser.add_argument("--days", default="")
    parser.add_argument("--tag", default="hf")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    days = json.loads((HERE / "days.json").read_text())
    slugs = [d for d in args.days.split(",") if d] or list(days)
    work = OUT / args.tag
    halted = None
    for cid in args.candidates.split(","):
        space, recipe, opts = RECIPES[cid]
        failures = 0
        for slug in slugs:
            if halted or failures >= 2:
                break
            record = work / cid / (slug + ".json")
            if record.exists() and not args.force and json.loads(record.read_text()).get("ok"):
                continue
            timer = Timer()
            entry = {"attempt": 0, "started": now(), "ok": False, "stage": None, "error": None}
            try:
                client = Client(space, verbose=False)
                entry["connect_s"] = timer.at()
                glb = recipe(client, work / "_rgba" / (slug + ".png"), timer, opts)
                target = work / cid / (slug + ".glb")
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(glb.get("path") or glb.get("value") if isinstance(glb, dict) else glb, target)
                data = target.read_bytes()
                entry.update(ok=True, model_file={"file": str(target), "bytes": len(data), "magic": data[:4].decode("latin1")})
                failures = 0
            except Exception as error:
                failures += 1
                entry.update(stage="space", error=(type(error).__name__ + ": " + str(error))[:1500])
                if "quota" in str(error).lower():
                    halted = entry["error"]
            entry["timeline"] = {"submitted_at": entry["started"], "result_s": timer.at(), "queue_s": round(sum((s["processing_s"] or s["end_s"]) - s["start_s"] for s in timer.steps), 3), "steps": timer.steps}
            row = {"candidate": cid, "provider": "hf", "model": space, "day": slug, **entry}
            with open(work / "runs.jsonl", "a") as log:
                log.write(json.dumps(row) + "\n")
            record.parent.mkdir(parents=True, exist_ok=True)
            record.write_text(json.dumps({"candidate": cid, "provider": "hf", "model": space, "day": slug, "input": {"image": "out/" + args.tag + "/_rgba/" + slug + ".png", **opts}, "price_usd": 0, "ok": entry["ok"], "attempts": [entry]}, indent=2) + "\n")
            size = "%.1fMB %s" % (entry["model_file"]["bytes"] / 1e6, entry["model_file"]["magic"]) if entry["ok"] else ""
            print(" | ".join([cid, slug, "ok" if entry["ok"] else "FAIL", "%ss total" % entry["timeline"]["result_s"], "%ss queued" % entry["timeline"]["queue_s"], size, "" if entry["ok"] else entry["error"][:300]]), flush=True)
    if halted:
        print("HALT: " + halted[:300])
        raise SystemExit(2)


if __name__ == "__main__":
    main()
