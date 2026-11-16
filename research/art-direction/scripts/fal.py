"""Minimal fal.ai HTTP helpers with a spend ledger and a hard budget guard.

The key is read from FAL_KEY and never printed. Every paid call records an
estimated cost in ledger.jsonl before it is made, so a crash cannot hide spend.
"""
import asyncio, json, os, time, pathlib
import httpx

ROOT = pathlib.Path(__file__).resolve().parent.parent
LEDGER = ROOT / "ledger.jsonl"
BUDGET_USD = float(os.environ.get("ART_BUDGET_USD", "40"))

PRICE = {
    "google/nano-banana-2.1": 0.07,
    "bytedance/seedream/v5.5/text-to-image": 0.03,
    "blackforestlabs/flux-3/text-to-image": 0.048,
    "blackforestlabs/flux-3/klein/text-to-image": 0.009,
    "fal-ai/nano-banana-pro": 0.15,
    "krea/v3/text-to-image": 0.025,
    "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d": 0.375,
    "fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d": 0.225,
    "fal-ai/trellis-2": 0.30,
}

def _headers():
    key = os.environ.get("FAL_KEY")
    if not key:
        raise RuntimeError("FAL_KEY is not set")
    return {"Authorization": "Key " + key, "Content-Type": "application/json"}

def spent():
    if not LEDGER.exists():
        return 0.0
    total = 0.0
    for line in LEDGER.read_text().splitlines():
        if line.strip():
            rec = json.loads(line)
            total += rec.get("actual_usd", rec.get("est_usd", 0.0)) or 0.0
    return total

_lock = asyncio.Lock()

async def reserve(endpoint, est, tag):
    async with _lock:
        s = spent()
        if s + est > BUDGET_USD:
            raise RuntimeError(f"budget guard: spent {s:.2f} + {est:.2f} > {BUDGET_USD:.2f}")
        rec = {"ts": time.time(), "endpoint": endpoint, "est_usd": est, "tag": tag}
        with LEDGER.open("a") as f:
            f.write(json.dumps(rec) + "\n")
        return rec

def record_actual(tag, actual):
    with LEDGER.open("a") as f:
        f.write(json.dumps({"ts": time.time(), "endpoint": "adjust", "tag": tag, "actual_usd": actual}) + "\n")

async def run_sync(client, endpoint, payload, est, tag, timeout=180):
    await reserve(endpoint, est, tag)
    t0 = time.perf_counter()
    r = await client.post("https://fal.run/" + endpoint, json=payload, headers=_headers(), timeout=timeout)
    dt = time.perf_counter() - t0
    if r.status_code >= 400:
        raise RuntimeError(f"{endpoint} HTTP {r.status_code}: {r.text[:500]}")
    return r.json(), dt

async def run_queue(client, endpoint, payload, est, tag, timeout=900, poll=3.0):
    await reserve(endpoint, est, tag)
    t0 = time.perf_counter()
    r = await client.post("https://queue.fal.run/" + endpoint, json=payload, headers=_headers(), timeout=60)
    if r.status_code >= 400:
        raise RuntimeError(f"{endpoint} submit HTTP {r.status_code}: {r.text[:500]}")
    sub = r.json()
    status_url, response_url = sub["status_url"], sub["response_url"]
    while True:
        if time.perf_counter() - t0 > timeout:
            raise RuntimeError(f"{endpoint} timed out after {timeout}s (request {sub.get('request_id')})")
        await asyncio.sleep(poll)
        s = await client.get(status_url, headers=_headers(), timeout=60)
        st = s.json().get("status")
        if st == "COMPLETED":
            break
    res = await client.get(response_url, headers=_headers(), timeout=120)
    dt = time.perf_counter() - t0
    if res.status_code >= 400:
        raise RuntimeError(f"{endpoint} result HTTP {res.status_code}: {res.text[:500]}")
    return res.json(), dt, sub.get("request_id")

async def download(client, url, path):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    async with client.stream("GET", url, timeout=600) as r:
        r.raise_for_status()
        with path.open("wb") as f:
            async for chunk in r.aiter_bytes():
                f.write(chunk)
    return path
