"""Send chosen flat images through GMI hunyuan-3d-pro, one job in flight at a time, and download every output file.

usage: python scripts/run_3d.py --manifest picks.json --out outputs/3d/v1 [--generate-type Normal|LowPoly]
manifest: [{"style": "clay", "slug": "dolores-park", "image_model": "flare", "url": "https://...", "generate_type": "Normal"}]
"""
import argparse, asyncio, json, pathlib, sys, os
import httpx
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import gmi

async def one(client, item, out, default_type):
    gtype = item.get("generate_type") or default_type
    stem = f"{item['slug']}__{item['image_model']}__{gtype}"
    dest_dir = pathlib.Path(out) / item["style"]
    meta_p = dest_dir / f"{stem}.json"
    if meta_p.exists():
        return json.loads(meta_p.read_text())
    tag = f"3d:{item['style']}:{stem}"
    payload = {"image_url": item["url"], "generate_type": gtype, "enable_pbr": False}
    try:
        sub, dt, server_s = await gmi.queue_run(client, "hunyuan-3d-pro", payload, tag, timeout=1800, poll_s=5.0, retries_on_fail=0)
    except Exception as e:
        print("ERR", tag, str(e)[:400], flush=True)
        return {"tag": tag, "error": str(e)[:500]}
    files = []
    for i, url in enumerate(gmi.media_urls(sub)):
        name = url.split("?")[0].rsplit("/", 1)[-1] or f"out{i}"
        p = await gmi.download(client, url, dest_dir / f"{stem}__{name}")
        files.append({"url": url, "path": str(p), "bytes": p.stat().st_size})
    meta = {**item, "generate_type": gtype, "latency_s": round(dt, 1), "server_s": server_s, "request_id": sub.get("request_id"), "files": files, "outcome": sub.get("outcome")}
    dest_dir.mkdir(parents=True, exist_ok=True)
    meta_p.write_text(json.dumps(meta, indent=1))
    print(f"3d {item['style']:10s} {stem:44s} {dt:6.1f}s files={[pathlib.Path(f['path']).name for f in files]}", flush=True)
    return meta

async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--generate-type", default="Normal")
    a = ap.parse_args()
    items = json.load(open(a.manifest))
    assert len(items) <= 24, f"refusing {len(items)} 3D calls in one run"
    print(f"{len(items)} 3D jobs, one at a time, est {len(items) * gmi.PRICE['hunyuan-3d-pro']:.2f} USD, spent so far {gmi.spent():.2f}", flush=True)
    async with httpx.AsyncClient() as client:
        for it in items:
            await one(client, it, a.out, a.generate_type)
    print(f"ledger total {gmi.spent():.2f} USD")

asyncio.run(main())
