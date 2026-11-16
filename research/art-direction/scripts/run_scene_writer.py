"""Run the scene writer over sample and edge-case days on several fal-hosted LLMs.

usage: python scripts/run_scene_writer.py --models a,b,c --sets sample,edge --out outputs/scenes/v1 [--repeat 1]
"""
import argparse, asyncio, json, pathlib, re, time, statistics, sys
import httpx
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import gmi

ROOT = gmi.ROOT

STYLE_WORDS = ["claymation", "plasticine", "vinyl toy", "low-poly", "low poly", "voxel", "papercraft", "felted", "diorama", "camera", "background", "rendered in", "3d render", "isometric", "photograph", "miniature"]
TEXT_WORDS = [r"\bsign\b", r"\bsigns\b", r"\blogo", r"\blabel", r"\bletters?\b", r"\bwritten\b", r"\bwords?\b", r"\btext\b", r"\bred bull\b", r"\bYC\b"]
PROFANITY = ["fuck", "shit", "dick", "goddamn", "damn", "ass"]
NAMES = ["Danny", "Maya", "Biscuit", "Priya", "Jake", "Leo", "Sam", "Mochi"]

def build_user(transcript, date=None, known=None):
    t = open(ROOT / "scene_writer/user_template.txt").read()
    for key, val in (("known", known), ("date", date)):
        if val:
            t = t.replace("{{#" + key + "}}\n", "").replace("{{/" + key + "}}\n", "").replace("{{/" + key + "}}", "").replace("{{" + key + "}}", val)
        else:
            t = re.sub(r"\{\{#" + key + r"\}\}.*?\{\{/" + key + r"\}\}\n?", "", t, flags=re.S)
    return t.replace("{{transcript}}", transcript).strip() + "\n"

def checks(spec):
    issues = []
    words = len(spec.get("scene", "").split())
    if not 40 <= words <= 110:
        issues.append(f"scene_words={words}")
    if len(spec.get("caption", "").split()) > 14:
        issues.append(f"caption_words={len(spec['caption'].split())}")
    tw = len(spec.get("title", "").split())
    if not 1 <= tw <= 6:
        issues.append(f"title_words={tw}")
    if not 3 <= len(spec.get("palette", [])) <= 5 or not all(re.fullmatch(r"#[0-9A-Fa-f]{6}", c) for c in spec.get("palette", [])):
        issues.append("palette")
    if not 3 <= len(spec.get("elements", [])) <= 6:
        issues.append(f"elements={len(spec.get('elements', []))}")
    scene = spec.get("scene", "").lower()
    for w in STYLE_WORDS:
        if w in scene:
            issues.append(f"style_word:{w}")
    for p in TEXT_WORDS:
        if re.search(p, spec.get("scene", ""), flags=re.I):
            issues.append(f"text_word:{p}")
    for n in NAMES:
        if re.search(r"\b" + n + r"\b", spec.get("scene", "")):
            issues.append(f"name_in_scene:{n}")
    blob = json.dumps(spec).lower()
    for w in PROFANITY:
        if re.search(r"\b" + w, blob):
            issues.append(f"profanity:{w}")
    return issues

async def one(client, sem, model, slug, transcript, outdir, rep, extra, temperature, fmt):
    system = open(ROOT / "scene_writer/system_prompt.md").read()
    schema = json.load(open(ROOT / "scene_writer/llm_response.schema.json"))
    if fmt == "json_schema":
        rf = {"type": "json_schema", "json_schema": {"name": "scene_spec", "strict": True, "schema": schema}}
    else:
        system = system + "\n\nJSON schema to follow exactly:\n" + json.dumps(schema)
        rf = {"type": "json_object"}
    body = {
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": build_user(transcript)}],
        "response_format": rf,
        "temperature": temperature,
        "max_tokens": 1500,
        **((extra or {}).get(model, {}) if any("/" in k for k in (extra or {})) else (extra or {})),
    }
    async with sem:
        tag = f"llm:{model}:{slug}:{rep}"
        try:
            res, dt = await gmi.chat(client, model, body, tag)
        except Exception as e:
            print("ERR", tag, str(e)[:300], flush=True)
            return {"model": model, "slug": slug, "rep": rep, "error": str(e)[:500]}
    usage = res.get("usage", {}) or {}
    cost = gmi.llm_cost(model, usage)
    content = res["choices"][0]["message"].get("content") or ""
    m = re.search(r"\{.*\}", content, flags=re.S)
    try:
        spec = json.loads(m.group(0) if m else content)
        err = None
    except Exception as e:
        spec, err = None, f"json: {e}"
    rec = {"model": model, "slug": slug, "rep": rep, "latency_s": round(dt, 2), "usage": usage, "cost_usd": cost, "format": fmt,
           "spec": spec, "raw": None if spec else content[:2000], "parse_error": err,
           "issues": checks(spec) if spec else ["unparsed"]}
    p = pathlib.Path(outdir) / model.replace("/", "__") / f"{slug}.r{rep}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(rec, indent=1, ensure_ascii=False))
    print(f"{model:40s} {slug:16s} r{rep} {dt:5.2f}s out={usage.get('completion_tokens')} issues={rec['issues']}", flush=True)
    return rec

async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", required=True)
    ap.add_argument("--sets", default="sample,edge")
    ap.add_argument("--only", default="")
    ap.add_argument("--out", required=True)
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--concurrency", type=int, default=6)
    ap.add_argument("--extra", default="")
    ap.add_argument("--format", default="json_schema")
    ap.add_argument("--temperature", type=float, default=0.7)
    a = ap.parse_args()
    days = json.load(open(ROOT / "inputs/days.json"))
    items = []
    for s in a.sets.split(","):
        items += list(days[s].items())
    if a.only:
        keep = set(a.only.split(","))
        items = [(k, v) for k, v in items if k in keep]
    models = a.models.split(",")
    assert len(models) * len(items) * a.repeat <= 200, "refusing more than 200 LLM calls in one run"
    extra = json.loads(a.extra) if a.extra else None
    sem = asyncio.Semaphore(a.concurrency)
    async with httpx.AsyncClient() as client:
        tasks = [one(client, sem, m, k, v, a.out, r, extra, a.temperature, a.format) for r in range(a.repeat) for m in models for k, v in items]
        recs = await asyncio.gather(*tasks)
    summary = {}
    for m in models:
        rs = [r for r in recs if r["model"] == m and "latency_s" in r]
        lat = [r["latency_s"] for r in rs]
        summary[m] = {
            "n": len(rs), "errors": sum(1 for r in recs if r["model"] == m and "error" in r),
            "p50_s": round(statistics.median(lat), 2) if lat else None,
            "max_s": max(lat) if lat else None,
            "cost_usd": round(sum((r.get("cost_usd") or 0) for r in rs), 4),
            "with_issues": sum(1 for r in rs if r["issues"]),
        }
    pathlib.Path(a.out, "summary.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary, indent=1))
    print(f"ledger total so far: {gmi.spent():.3f} USD")

asyncio.run(main())
