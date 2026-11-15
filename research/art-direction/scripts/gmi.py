"""Minimal GMI Cloud helpers: OpenAI-compatible chat, the request queue, a spend ledger and a hard budget guard.

The key is read from GMI_API_KEY and never printed. Every paid call reserves its
estimated price in ledger.jsonl before it is sent, so a crash cannot hide spend.
"""
import asyncio, json, os, time, pathlib
import httpx

ROOT = pathlib.Path(__file__).resolve().parent.parent
LEDGER = ROOT / "ledger.jsonl"
BUDGET_USD = float(os.environ.get("ART_BUDGET_USD", "40"))
QUEUE = "https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey/requests"
CHAT = "https://api.gmi-serving.com/v1/chat/completions"

PRICE = {
    "gemini-nano-banana-2.1": 0.041,
    "gemini-3.1-flash-lite-image": 0.035,
    "gpt-image-2.5-flare-generate": 0.0132,
    "gpt-image-2.5-flare-generate@high": 0.0527,
    "seedream-5.0-lite": 0.035,
    "seedream-5.0-pro": 0.085,
    "hy-image-v3.5-preview": 0.024,
    "Flux2-Klein": 0.01,
    "hunyuan-3d-pro": 0.375,
    "bria-image-remove-background": 0.018,
}

LLM_PRICES = {}
try:
    for m in json.load(open(ROOT / "gmi/llm_models.json"))["data"]:
        p = m.get("pricing") or {}
        LLM_PRICES[m["id"]] = (float(p.get("prompt", 0)), float(p.get("completion", 0)), float(m.get("discount_to_user") or 0))
except Exception:
    pass

def _headers():
    key = os.environ.get("GMI_API_KEY")
    if not key:
        raise RuntimeError("GMI_API_KEY is not set")
    return {"Authorization": "Bearer " + key, "Content-Type": "application/json"}

def spent():
    if not LEDGER.exists():
        return 0.0
    total = 0.0
    for line in LEDGER.read_text().splitlines():
        if line.strip():
            rec = json.loads(line)
            total += rec.get("usd", 0.0) or 0.0
    return total

_lock = asyncio.Lock()

async def reserve(what, est, tag):
    async with _lock:
        s = spent()
        if s + est > BUDGET_USD:
            raise RuntimeError(f"budget guard: spent {s:.2f} + {est:.2f} > {BUDGET_USD:.2f}")
        with LEDGER.open("a") as f:
            f.write(json.dumps({"ts": time.time(), "what": what, "usd": est, "tag": tag, "kind": "reserve"}) + "\n")

def adjust(tag, delta):
    with LEDGER.open("a") as f:
        f.write(json.dumps({"ts": time.time(), "what": "adjust", "usd": delta, "tag": tag, "kind": "adjust"}) + "\n")

def llm_cost(model, usage):
    pi, po, disc = LLM_PRICES.get(model, (0.0, 0.0, 0.0))
    return (usage.get("prompt_tokens", 0) * pi + usage.get("completion_tokens", 0) * po) * (1 - disc)

async def chat(client, model, body, tag, est=0.02, timeout=120):
    await reserve("llm:" + model, est, tag)
    t0 = time.perf_counter()
    try:
        r = await client.post(CHAT, json={"model": model, **body}, headers=_headers(), timeout=timeout)
    except Exception:
        adjust(tag, -est)
        raise
    dt = time.perf_counter() - t0
    if r.status_code >= 400:
        adjust(tag, -est)
        raise RuntimeError(f"{model} HTTP {r.status_code}: {r.text[:400]}")
    res = r.json()
    adjust(tag, llm_cost(model, res.get("usage") or {}) - est)
    return res, dt

NO_RETRY_MODELS = {"hunyuan-3d-pro"}

async def submit(client, model, payload, tag, max_attempts=12):
    if model in NO_RETRY_MODELS:
        max_attempts = 1
    for attempt in range(max_attempts):
        try:
            r = await client.post(QUEUE, json={"model": model, "payload": payload}, headers=_headers(), timeout=300)
        except httpx.HTTPError as e:
            if attempt == max_attempts - 1:
                raise RuntimeError(f"{model} submit network error: {e}")
            await asyncio.sleep(min(60, 5 * (attempt + 1)))
            continue
        if model in NO_RETRY_MODELS and r.status_code >= 400:
            raise RuntimeError(f"{model} submit HTTP {r.status_code} (no retry): {r.text[:400]}")
        if r.status_code == 429:
            try:
                wait_ms = r.json().get("rate_limit", {}).get("retry_after_ms", 30000)
            except Exception:
                wait_ms = 30000
            print(f"  429 {model} {tag}: waiting {wait_ms/1000:.0f}s", flush=True)
            await asyncio.sleep(wait_ms / 1000 + 1)
            continue
        if r.status_code >= 500:
            print(f"  {r.status_code} {model} {tag}: retrying", flush=True)
            await asyncio.sleep(min(60, 8 * (attempt + 1)))
            continue
        if r.status_code >= 400:
            raise RuntimeError(f"{model} submit HTTP {r.status_code}: {r.text[:400]}")
        return r.json()
    raise RuntimeError(f"{model} submit gave up after {max_attempts} attempts")

async def poll(client, rid, model, timeout, t0, poll_s=2.0, sub=None):
    st = (sub or {}).get("status")
    while st not in ("success", "failed", "cancelled"):
        if time.perf_counter() - t0 > timeout:
            raise RuntimeError(f"{model} timed out after {timeout}s (request {rid})")
        await asyncio.sleep(poll_s)
        try:
            s = await client.get(f"{QUEUE}/{rid}", headers=_headers(), timeout=60)
        except httpx.HTTPError:
            continue
        if s.status_code >= 400:
            continue
        sub = s.json()
        st = sub.get("status")
    return sub

async def queue_run(client, model, payload, tag, est=None, timeout=900, poll_s=2.0, retries_on_fail=1, max_submit_attempts=12):
    est = PRICE[model] if est is None else est
    await reserve(model, est, tag)
    for attempt in range(retries_on_fail + 1):
        t0 = time.perf_counter()
        try:
            sub = await submit(client, model, payload, tag, max_attempts=max_submit_attempts)
        except Exception:
            adjust(tag, -est)
            raise
        rid = sub.get("request_id")
        sub = await poll(client, rid, model, timeout, t0, poll_s, sub)
        dt = time.perf_counter() - t0
        if sub.get("status") == "success":
            server_s = (sub.get("updated_at") or 0) - (sub.get("created_at") or 0)
            return sub, dt, server_s
        print(f"  {model} {tag} request {rid} {sub.get('status')}: {json.dumps(sub.get('outcome') or {})[:200]}", flush=True)
    adjust(tag, -est)
    raise RuntimeError(f"{model} {sub.get('status')} (request {rid}): {json.dumps(sub.get('outcome') or sub)[:400]}")

def media_urls(sub):
    out = (sub.get("outcome") or {}).get("media_urls") or []
    return [m["url"] if isinstance(m, dict) else m for m in out]

async def download(client, url, path):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    async with client.stream("GET", url, timeout=600, follow_redirects=True) as r:
        r.raise_for_status()
        with path.open("wb") as f:
            async for chunk in r.aiter_bytes():
                f.write(chunk)
    return path
