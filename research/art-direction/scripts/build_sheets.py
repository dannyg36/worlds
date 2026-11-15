"""Build the YCCO-9 contact sheets from outputs/images/full and outputs/images/scout1.

usage: python scripts/build_sheets.py --out outputs/sheets [--threed outputs/3d]
"""
import argparse, json, pathlib, statistics, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DAYS = ["dolores-park", "birthday-dinner", "farmers-market", "santa-cruz", "mission-peak", "hackathon", "finals-library", "rainy-monday"]
SCENES = ROOT / "outputs/scenes/v5/google__gemini-3.8-flash"
FULL = ROOT / "outputs/images/full"
SCOUT = ROOT / "outputs/images/scout1"
MODELS = {
    "flare": ("gpt-image-2.5 Flare", "medium quality, 1024 px, $0.013 per image"),
    "sd5lite": ("Seedream 5.0 Lite", "2048 px, $0.035 per image, 2 requests a minute per GMI account"),
}
BLURB = {
    "clay": "Matte plasticine with thumbprints on a thick round wooden base; chunky figures with bead eyes.",
    "lowpoly": "A faceted floating island with a rocky underside that tapers to a point; flat-shaded pastel polygons.",
    "miniature": "A photographed model-railway tabletop: flocked grass, painted figurines, round wooden plinth.",
    "vinyl": "Glossy designer-toy plastic in candy colors on a rounded base; figures with oversized heads.",
    "paper": "Layered cut paper and folded cardstock on a round paper base.",
    "felt": "Needle-felted wool with visible fibers on a round felted base.",
    "painted": "A hand-painted cozy-game diorama on a round platform of earth.",
    "voxel": "Everything built from small uniform cubes on a square block base.",
}
THREED_DAYS = ["dolores-park", "birthday-dinner", "santa-cruz"]

def title(slug):
    return json.loads((SCENES / f"{slug}.r0.json").read_text())["spec"]["title"]

def p50(style, model):
    v = [json.loads(p.read_text())["latency_s"] for p in (FULL / style / model).glob("*.json")]
    return f"p50 {statistics.median(v):.0f} s" if v else ""

def run(layout, path):
    path.write_text(json.dumps(layout))
    subprocess.run([sys.executable, str(ROOT / "scripts/sheet.py"), str(path)], check=True)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--threed", default="")
    ap.add_argument("--picks", default="")
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    styles = json.loads((ROOT / "scene_writer/styles.final.json").read_text())
    picks = json.loads(pathlib.Path(a.picks).read_text()) if a.picks else {}
    for i, (sk, st) in enumerate(styles.items(), 1):
        sections = []
        for mk, (mname, mnote) in MODELS.items():
            rows = []
            for chunk in (DAYS[:4], DAYS[4:]):
                rows.append({"tiles": [{"img": str(FULL / sk / mk / f"{d}.png") if (FULL / sk / mk / f"{d}.png").exists() else None, "caption": title(d), "sub": d} for d in chunk]})
            sections.append({"label": f"{mname}  ·  {mnote}  ·  {p50(sk, mk)}", "cols": 4, "rows": rows})
        tiles = []
        for d in THREED_DAYS:
            mk = picks.get(sk, {}).get(d, "flare")
            tiles.append({"img": str(FULL / sk / mk / f"{d}.png"), "caption": title(d), "sub": f"input · {MODELS[mk][0]}"})
            glb = pathlib.Path(a.threed) / sk / f"{d}.png" if a.threed else None
            tiles.append({"img": str(glb) if glb and glb.exists() else None, "caption": "3D render" if glb and glb.exists() else "3D pending", "sub": "hunyuan-3d-pro" if glb and glb.exists() else "GMI 3D unavailable", "tag": None if glb and glb.exists() else "pending"})
        sections.append({"label": "3D check  ·  image in, GLB render out  ·  pending until GMI hunyuan-3d-pro works", "cols": 6, "rows": [{"tiles": tiles}]})
        run({
            "title": f"{i}. {st['name']}",
            "subtitle": BLURB[sk],
            "meta": "worlds house style option  ·  YCCO-9  ·  8 sample days, scene writer gemini-3.8-flash, images on GMI Cloud",
            "out": str(out / f"{i}-{sk}.jpg"),
            "width": 2400,
            "sections": sections,
        }, out / f"{sk}.layout.json")
    over_days = ["dolores-park", "birthday-dinner", "farmers-market", "finals-library"]
    run({
        "title": "worlds: four house styles",
        "subtitle": "The same four days in each style, rendered by gpt-image-2.5 Flare on GMI. One style becomes the look of every world in the feed.",
        "meta": "YCCO-9  ·  full sheets per style in renders/YCCO-9/  ·  3D check pending",
        "out": str(out / "0-overview.jpg"),
        "width": 2400,
        "sections": [{"label": f"{i}. {st['name']}", "cols": 4, "rows": [{"tiles": [{"img": str(FULL / sk / "flare" / f"{d}.png"), "caption": title(d) if i == 1 else None} for d in over_days]}]} for i, (sk, st) in enumerate(styles.items(), 1)],
    }, out / "overview.layout.json")
    alts = json.loads((ROOT / "scene_writer/styles.alternates.json").read_text())
    run({
        "title": "Runners-up from scouting",
        "subtitle": "Eight styles were scouted on two days with both image models; these four were not carried into the full run. Scouting used the earlier recipe, before the no-horizon rule.",
        "meta": "YCCO-9  ·  columns: Flare dolores-park, Flare birthday-dinner, Seedream dolores-park, Seedream birthday-dinner",
        "out": str(out / "5-runners-up.jpg"),
        "width": 2400,
        "sections": [{"label": f"{st['name']}  ·  {BLURB[sk]}", "cols": 4, "rows": [{"tiles": [{"img": str(SCOUT / sk / m / f"{d}.png")} for m in ("flare", "sd5lite") for d in ("dolores-park", "birthday-dinner")]}]} for sk, st in alts.items()],
    }, out / "runners-up.layout.json")

main()
