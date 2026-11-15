"""Render scene specs through house-style recipes and GMI text-to-image models.

usage: python scripts/run_images.py --scenes outputs/scenes/v4/google__gemini-3.8-flash --styles clay,lowpoly --models nb21,flare --days hackathon,dolores-park --out outputs/images/scout1
"""
import argparse, asyncio, json, pathlib, sys, statistics
import httpx
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import gmi

ROOT = gmi.ROOT
MODELS = {
    "nb21": ("gemini-nano-banana-2.1", None, lambda p, seed: {"prompt": p, "image_size": "1K", "aspect_ratio": "1:1", "image_output_format": "png"}),
    "nb21min": ("gemini-nano-banana-2.1", None, lambda p, seed: {"prompt": p, "image_size": "1K", "aspect_ratio": "1:1", "image_output_format": "png", "thinking": "minimal"}),
    "nblite": ("gemini-3.1-flash-lite-image", None, lambda p, seed: {"prompt": p, "aspect_ratio": "1:1", "image_output_format": "png"}),
    "flare": ("gpt-image-2.5-flare-generate", None, lambda p, seed: {"prompt": p, "size": "1024x1024", "quality": "medium", "output_format": "png", "background": "opaque"}),
    "flarehigh": ("gpt-image-2.5-flare-generate", 0.0527, lambda p, seed: {"prompt": p, "size": "1024x1024", "quality": "high", "output_format": "png", "background": "opaque"}),
    "flaret": ("gpt-image-2.5-flare-generate", None, lambda p, seed: {"prompt": p, "size": "1024x1024", "quality": "medium", "output_format": "png", "background": "transparent"}),
    "sd5lite": ("seedream-5.0-lite", None, lambda p, seed: {"prompt": p, "size": "2048x2048", "output_format": "png", "max_images": 1, "watermark": False}),
    "sd5pro": ("seedream-5.0-pro", None, lambda p, seed: {"prompt": p, "size": "2048x2048", "output_format": "png", "max_images": 1, "watermark": False}),
    "klein": ("Flux2-Klein", None, lambda p, seed: {"prompt": p, "width": 1024, "height": 1024, "seed": seed}),
    "hyimg": ("hy-image-v3.5-preview", None, lambda p, seed: {"prompt": p, "size": "1024x1024", "seed": seed}),
    "wan27": ("wan2.7-image", 0.03, lambda p, seed: {"text": p, "size": "1024*1024", "n": 1}),
    "gem31": ("gemini-3.1-flash-image", 0.067, lambda p, seed: {"prompt": p, "image_size": "1K", "aspect_ratio": "1:1", "image_output_format": "png"}),
}

def build_prompt(spec, style):
    return " ".join([style["lead"], spec["scene"].strip(), style["look"], style["guard"]])

async def one(client, sems, model_key, style_key, style, slug, spec, out, seed, attempts):
    model, price, mk = MODELS[model_key]
    prompt = build_prompt(spec, style)
    dest = pathlib.Path(out) / style_key / model_key / f"{slug}.png"
    meta_p = dest.with_suffix(".json")
    if meta_p.exists():
        return json.loads(meta_p.read_text())
    async with sems[model_key]:
        tag = f"img:{model_key}:{style_key}:{slug}"
        try:
            sub, dt, server_s = await gmi.queue_run(client, model, mk(prompt, seed), tag, est=price, timeout=300, max_submit_attempts=attempts)
            urls = gmi.media_urls(sub)
            await gmi.download(client, urls[0], dest)
        except Exception as e:
            print("ERR", tag, str(e)[:400], flush=True)
            return {"tag": tag, "error": str(e)[:500]}
    meta = {"model": model_key, "gmi_model": model, "style": style_key, "slug": slug, "latency_s": round(dt, 2), "server_s": server_s, "url": urls[0], "prompt": prompt, "seed": seed, "request_id": sub.get("request_id")}
    meta_p.write_text(json.dumps(meta, indent=1))
    print(f"{model_key:10s} {style_key:10s} {slug:16s} {dt:6.2f}s", flush=True)
    return meta

async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenes", required=True)
    ap.add_argument("--styles-file", default="scene_writer/styles.scout.json")
    ap.add_argument("--styles", required=True)
    ap.add_argument("--models", required=True)
    ap.add_argument("--days", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--concurrency", type=int, default=3)
    ap.add_argument("--attempts", type=int, default=4)
    a = ap.parse_args()
    styles = json.load(open(ROOT / a.styles_file))
    jobs = []
    for slug in a.days.split(","):
        f = sorted(pathlib.Path(a.scenes).glob(f"{slug}.r0.json"))
        spec = json.loads(f[0].read_text())["spec"]
        for s in a.styles.split(","):
            for m in a.models.split(","):
                jobs.append((m, s, styles[s], slug, spec))
    assert len(jobs) <= 160, f"refusing {len(jobs)} image calls in one run"
    est = sum((MODELS[m][1] or gmi.PRICE[MODELS[m][0]]) for m, *_ in jobs)
    print(f"{len(jobs)} images, est {est:.2f} USD, spent so far {gmi.spent():.2f}", flush=True)
    sems = {m: asyncio.Semaphore(a.concurrency) for m in a.models.split(",")}
    async with httpx.AsyncClient() as client:
        res = await asyncio.gather(*[one(client, sems, m, sk, s, slug, spec, a.out, a.seed, a.attempts) for m, sk, s, slug, spec in jobs])
    lat = {}
    for r in res:
        if "latency_s" in r:
            lat.setdefault(r["model"], []).append(r["latency_s"])
    print(json.dumps({m: {"n": len(v), "p50": statistics.median(v), "max": max(v)} for m, v in lat.items()}, indent=1))
    print(f"errors: {sum(1 for r in res if 'error' in r)}; ledger total {gmi.spent():.2f} USD")

asyncio.run(main())
