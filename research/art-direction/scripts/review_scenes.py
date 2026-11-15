"""Print a compact review of scene-writer outputs and a detail-retention score.

usage: python scripts/review_scenes.py outputs/scenes/v1
"""
import json, pathlib, sys, re, statistics

MUST = {
    "hackathon": [["energy", "can"], ["window", "sunset"], ["pizza"]],
    "santa-cruz": [["bike"], ["cliff"], ["chowder", "bread bowl"], ["sea lion"]],
    "rainy-monday": [["umbrella"], ["latte", "cat"], ["ramen"]],
    "dolores-park": [["dog", "biscuit"], ["tennis ball"], ["burrito"]],
    "birthday-dinner": [["string light"], ["tiramisu"], ["sparkler"]],
    "finals-library": [["lamp"], ["snow"], ["hot chocolate", "cocoa"]],
    "mission-peak": [["pole"], ["cow"], ["dad", "father"]],
    "farmers-market": [["peach"], ["purple carrot"], ["galette"]],
}

def retention(slug, spec):
    if slug not in MUST or not spec:
        return None
    blob = (spec.get("scene", "") + " " + " ".join(e["name"] + " " + e["look"] for e in spec.get("elements", []))).lower()
    hits = [any(k in blob for k in group) for group in MUST[slug]]
    return sum(hits), len(hits), [g[0] for g, h in zip(MUST[slug], hits) if not h]

def main(root, detail=False):
    root = pathlib.Path(root)
    for mdir in sorted(p for p in root.iterdir() if p.is_dir()):
        print("=" * 100)
        print(mdir.name)
        lats, keep, total = [], 0, 0
        for f in sorted(mdir.glob("*.json")):
            r = json.loads(f.read_text())
            s = r.get("spec") or {}
            slug = r["slug"]
            lats.append(r.get("latency_s", 0))
            ret = retention(slug, s)
            if ret:
                keep += ret[0]; total += ret[1]
            print(f"- {slug} r{r['rep']} {r.get('latency_s')}s [{s.get('status')}] {s.get('title')!r} | {s.get('caption')!r}")
            print(f"    mood={s.get('mood')} tod={s.get('time_of_day')} wx={s.get('weather')} pal={s.get('palette')} issues={r.get('issues')} retention={ret}")
            print(f"    moment: {s.get('moment')}")
            print(f"    elements: {[e['name'] for e in s.get('elements', [])]}")
            if detail:
                print(f"    scene: {s.get('scene')}")
        if lats:
            print(f"  latency p50={statistics.median(lats):.2f}s max={max(lats):.2f}s  retention {keep}/{total}")

if __name__ == "__main__":
    main(sys.argv[1], "--detail" in sys.argv)
