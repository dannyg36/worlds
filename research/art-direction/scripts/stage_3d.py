"""Stage the 3D-check inputs: 3 images per style, with public URLs and the hunyuan-3d-pro payload.

usage: python scripts/stage_3d.py --out outputs/style-3d-inputs [--picks picks.json]
picks.json: {"<style>": {"<day>": "flare"|"sd5lite"}} overrides the default image model (flare).
"""
import argparse, json, pathlib, shutil
import httpx

ROOT = pathlib.Path(__file__).resolve().parent.parent
FULL = ROOT / "outputs/images/full"
SCENES = ROOT / "outputs/scenes/v5/google__gemini-3.8-flash"
DAYS = ["dolores-park", "birthday-dinner", "santa-cruz"]
GENERATE = {"lowpoly": ["LowPoly", "Normal"]}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--picks", default="")
    a = ap.parse_args()
    picks = json.loads(pathlib.Path(a.picks).read_text()) if a.picks else {}
    styles = json.loads((ROOT / "scene_writer/styles.final.json").read_text())
    out = pathlib.Path(a.out)
    for sk, st in styles.items():
        d = out / sk
        d.mkdir(parents=True, exist_ok=True)
        inputs = []
        for day in DAYS:
            mk = picks.get(sk, {}).get(day, "flare")
            meta = json.loads((FULL / sk / mk / f"{day}.json").read_text())
            r = httpx.head(meta["url"], timeout=30, follow_redirects=True)
            assert r.status_code == 200, f"{sk}/{day}: {meta['url']} returned {r.status_code}"
            shutil.copy(FULL / sk / mk / f"{day}.png", d / f"{day}.png")
            spec = json.loads((SCENES / f"{day}.r0.json").read_text())["spec"]
            inputs.append({"day": day, "file": f"{day}.png", "image_url": meta["url"], "image_model": meta["gmi_model"], "title": spec["title"], "image_prompt": meta["prompt"]})
        types = GENERATE.get(sk, ["Normal"])
        manifest = {
            "style": sk,
            "name": st["name"],
            "jobs": [{"day": i["day"], "model": "hunyuan-3d-pro", "payload": {"image_url": i["image_url"], "generate_type": t, "enable_pbr": False}} for i in inputs for t in types],
            "inputs": inputs,
        }
        (d / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
        print(sk, [i["day"] + ":" + i["image_model"] for i in inputs], "jobs", len(manifest["jobs"]))

main()
