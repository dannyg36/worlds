import asyncio, json, sys, pathlib, re
import httpx
sys.path.insert(0, "scripts")
import gmi
def build_user(transcript):
    t = open(gmi.ROOT / "scene_writer/user_template.txt").read()
    for key in ("known", "date"):
        t = re.sub(r"\{\{#" + key + r"\}\}.*?\{\{/" + key + r"\}\}\n?", "", t, flags=re.S)
    return t.replace("{{transcript}}", transcript).strip() + "\n"
ROOT = gmi.ROOT
days = json.load(open(ROOT / "inputs/days.json"))["sample"]
system = open(ROOT / "scene_writer/system_prompt.md").read()
schema = json.load(open(ROOT / "scene_writer/llm_response.schema.json"))
async def one(client, i, slug):
    body = {"messages": [{"role": "system", "content": system}, {"role": "user", "content": build_user(days[slug])}],
            "response_format": {"type": "json_schema", "json_schema": {"name": "scene_spec", "strict": True, "schema": schema}},
            "temperature": 0.7, "max_tokens": 1500, "thinking": {"type": "disabled"}}
    res, dt = await gmi.chat(client, "deepseek-ai/deepseek-v4.1-flash-1017", body, f"probe:ds:{slug}:{i}")
    c = res["choices"][0]["message"].get("content") or ""
    fr = res["choices"][0].get("finish_reason")
    try:
        json.loads(c[c.index("{"):c.rindex("}")+1]); ok = True; err = ""
    except Exception as e:
        ok = False; err = str(e)
    m = re.search(r"position (\d+)", err)
    pos = int(m.group(1)) if m else None
    print(slug, i, f"{dt:.2f}s", fr, "ok" if ok else "BAD", err[:80], repr(c[max(0,(pos or 0)-120):(pos or 0)+60]) if not ok else "", flush=True)
async def main():
    async with httpx.AsyncClient() as client:
        await asyncio.gather(*[one(client, i, s) for i in range(4) for s in ("hackathon", "birthday-dinner")])
asyncio.run(main())
