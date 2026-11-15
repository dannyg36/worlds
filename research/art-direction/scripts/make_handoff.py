"""Build the scene-writer handoff folder from the working files.

usage: python scripts/make_handoff.py --styles-file scene_writer/styles.final.json --default clay --examples outputs/scenes/v4/google__gemini-3.8-flash --out <dir>
"""
import argparse, json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

def build_prompt(spec, style):
    return " ".join([style["lead"], spec["scene"].strip(), style["look"], style["guard"]])

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--styles-file", required=True)
    ap.add_argument("--default", required=True)
    ap.add_argument("--examples", required=True)
    ap.add_argument("--alternates", default="")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    prompt = (ROOT / "scene_writer/system_prompt.md").read_text()
    schema = json.loads((ROOT / "scene_writer/llm_response.schema.json").read_text())
    styles = json.loads((ROOT / a.styles_file).read_text())
    styles = {k: {f: v[f] for f in ("name", "lead", "look", "guard")} for k, v in styles.items()}
    assert a.default in styles, f"default style {a.default} not in {list(styles)}"
    ts = (ROOT / "scene_writer/sceneWriter.template.ts").read_text()
    for k, v in {
        "__SYSTEM_PROMPT__": json.dumps(prompt),
        "__SCHEMA__": json.dumps(schema, indent=2),
        "__STYLES__": json.dumps(styles, indent=2),
        "__DEFAULT_STYLE__": json.dumps(a.default),
    }.items():
        ts = ts.replace(k, v)
    assert "__" not in ts.replace("__dirname", ""), "unreplaced placeholder"
    (out / "sceneWriter.ts").write_text(ts)
    (out / "system-prompt.md").write_text(prompt)
    (out / "user-template.txt").write_text((ROOT / "scene_writer/user_template.txt").read_text())
    full = json.loads(json.dumps(schema))
    full["title"] = "worlds scene spec"
    full["properties"]["image_prompt"] = {"type": "string", "description": "Filled by buildImagePrompt(spec, style): style lead + scene + style look + composition guard. Not requested from the LLM."}
    full["properties"]["style"] = {"type": "string", "description": "House style id used for image_prompt."}
    full["required"] = full["required"] + ["image_prompt", "style"]
    (out / "scene-spec.schema.json").write_text(json.dumps(full, indent=2))
    (out / "llm-response.schema.json").write_text(json.dumps(schema, indent=2))
    (out / "styles.json").write_text(json.dumps(styles, indent=2))
    if a.alternates:
        alts = json.loads((ROOT / a.alternates).read_text())
        alts = {k: {f: v[f] for f in ("name", "lead", "look", "guard")} for k, v in alts.items()}
        (out / "styles.alternates.json").write_text(json.dumps(alts, indent=2))
    days = json.loads((ROOT / "inputs/days.json").read_text())["sample"]
    ex = out / "examples"
    ex.mkdir(exist_ok=True)
    for slug, transcript in days.items():
        rec = json.loads((pathlib.Path(a.examples) / f"{slug}.r0.json").read_text())
        spec = rec["spec"]
        (ex / f"{slug}.json").write_text(json.dumps({
            "transcript": transcript,
            "model": rec["model"],
            "latency_s": rec["latency_s"],
            "spec": spec,
            "image_prompts": {k: build_prompt(spec, s) for k, s in styles.items()},
        }, indent=1, ensure_ascii=False))
    print("wrote", sorted(str(p.relative_to(out)) for p in out.rglob("*") if p.is_file()))

main()
