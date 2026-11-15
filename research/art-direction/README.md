# YCCO-9: art direction (scene writer and house style)

Handoff for whoever continues in Claude Code. Everything is on branch `capy/art-direction` under `research/art-direction/`. All generation ran on GMI Cloud with `GMI_API_KEY`; fal was never used.

## Outcome
**Recommendation: clay (claymation diorama) as the house style.** It was the most consistent style across all 8 days and both image models, every personal detail reads at a glance (the dog with his tennis ball, the sparkler, the purple carrots, the cat in the latte), and matte, chunky clay on a solid wooden base is the material most likely to survive image-to-3D. Vinyl toy is the close second if Rikhil wants cuter and more collectible. The low-poly floating island should win instead if the 3D check shows that hunyuan's LowPoly meshes hold up, because they would be the lightest to render on a phone. The tilt-shift miniature looks the best flat, but it has the tiniest figures and the thinnest parts, so I expect it to lose in 3D. Rikhil picks, and the 3D check that could change this is still blocked (see Needs).

Start with `contact-sheets/0-overview.jpg` (four days in each style), then `1-clay.jpg` to `4-vinyl.jpg` (all 8 days on both image models) and `5-runners-up.jpg` (paper, felt, painted and voxel from scouting).

### What works
- **Scene writer** (`scene-writer/`): `sceneWriter.ts` is self-contained TypeScript (fetch only) with the prompt, schema, style recipes, a validator and a model fallback. On the final prompt, google/gemini-3.8-flash on GMI (`json_object`, `reasoning_effort: "minimal"`) returned 30 valid specs out of 30, p50 4.2 s, max 6.7 s, about $0.003 per call. The fallback, deepseek-v4.1-flash, has p50 2 s. The scene writer handles empty, filler, rambling, sad, profane, prompt-injection and Spanish notes. The file typechecks under strict `tsc`, and a live run through it worked, including the fallback path. `scene-writer/README.md` has the LLM comparison table and the image-model notes.
- **House styles**: four recipes in `scene-writer/styles.json` and four runners-up in `styles.alternates.json`. The image prompt is the style's lead, then the spec's scene, then the style's look and guard, so the LLM never sees the style and one spec renders in any style.
- **Style matrix**: 4 styles × 8 days rendered on gpt-image-2.5-flare (32 of 32, $0.0132 each, p50 25 s) and seedream-5.0-lite (26 of 32, $0.035 each, p50 68 s while rate-limited). JPEGs of every image are in `images/<style>/<model>/<day>.jpg`, and each original's public GMI URL and full prompt are in `outputs/images/full/<style>/<model>/<day>.json`.
- **3D inputs**: `style-3d-inputs/<style>/` has 3 PNGs per style and a `manifest.json` listing the exact 15 hunyuan-3d-pro jobs ($5.63 in total).

### What's unfinished
- **The 3D check.** No style has a GLB yet, because hunyuan-3d-pro fails for the GMI account (DAN-18). The contact sheets have empty "3D pending" tiles where the renders go.
- **6 Seedream tiles are blank** because the run stopped at the wrap-up: clay, low-poly and vinyl rainy-monday, and miniature hackathon, finals-library and rainy-monday.
- **One guard sentence is untested at scale.** "Show only what is described: no extra people or animals." was added to every recipe after the matrix rendered. I tested it on 8 Flare images: clay stopped inventing a diner at the empty balcony table, but vinyl still seated one. The sheets show the recipe without that sentence.
- **The GLB renderer** (`render/`) works on public example GLBs but has never rendered a hunyuan output, and the format GMI returns is unverified.

### How to run it
Run everything from `research/art-direction/`. The scripts treat that folder as their root, and `ledger.jsonl` there keeps the spend record that the budget guard reads (`ART_BUDGET_USD`, default 40).
```bash
python3 -m venv .venv && . .venv/bin/activate && pip install httpx pillow
export GMI_API_KEY=...   # never commit it
python scripts/run_scene_writer.py --models google/gemini-3.8-flash --sets sample,edge --repeat 2 --format json_object --extra '{"google/gemini-3.8-flash":{"reasoning_effort":"minimal"}}' --out outputs/scenes/v6
python scripts/run_images.py --scenes outputs/scenes/v5/google__gemini-3.8-flash --styles-file scene_writer/styles.final.json --styles clay --models flare --days dolores-park --out outputs/images/try
python scripts/make_handoff.py --styles-file scene_writer/styles.final.json --alternates scene_writer/styles.alternates.json --default clay --examples outputs/scenes/v5/google__gemini-3.8-flash --out /tmp/handoff
```
- `scripts/run_3d.py` submits hunyuan-3d-pro jobs one at a time and never retries a `ResourceInsufficient` error; `scripts/stage_3d.py` wrote the manifests.
- `scripts/build_sheets.py` rebuilds the contact sheets. It needs the original PNGs in `outputs/images/full/`, which are not committed, so download them first from the URLs in the meta JSONs.
- `render/render.mjs` renders GLBs headless with three.js and Chromium: `cd render && npm install && node render.mjs jobs.json 512`, where each job is `{glb, out, views: [{az, el, mode: "tex" | "clay"}], turntable}`.
- `scene-writer/handoff.test.ts` is a live smoke test for `sceneWriter.ts`. Copy it next to the file and run `node handoff.test.ts ../inputs/days.json`.

### Next three steps
1. Show Rikhil `contact-sheets/0-overview.jpg` and the four style sheets, get his pick, and set `DEFAULT_STYLE` in `sceneWriter.ts` (it is `clay` now).
2. When hunyuan-3d-pro works (DAN-18) or fal returns, run the 15 jobs in `style-3d-inputs/*/manifest.json` one at a time, render each GLB textured and untextured from a three-quarter view, and fill the "3D pending" tiles. If the pick falls apart in 3D, move to the next style that survives.
3. Hand `scene-writer/` to the pipeline (the Convex generation action): call `writeScene`, then `buildImagePrompt`, then Flare on GMI's request queue with `GMI_IMAGE_MODELS.flare`, and store `title`, `caption` and `palette` with the world.

## PR
None: this was research. Branch `capy/art-direction`, cut from `main`, holds everything under `research/art-direction/`.

## Needs
- **Rikhil**: pick one of the four styles, or a runner-up.
- **Blocked**: the 3D check waits on GMI's hunyuan-3d-pro (DAN-18, `ResourceInsufficient` for the account) or on a `FAL_KEY`.
- **Capy Drive copies** (they may be unreachable after the move): `captain-gurnoor-sandu/handoffs/scene-writer/`, `handoffs/style-3d-inputs/<style>/`, `renders/YCCO-9/` (the contact sheets) and this report at `reports/YCCO-9.md`. Every file there is also on the branch. The full-size originals (Seedream's are 2048 px, 4 to 8 MB each) are not in git or Drive; their public GMI storage URLs are in `outputs/images/full/**/*.json`.

## Cost
GMI generation: $3.18 in total from the ledger, for about 260 scene-writer calls and about 150 images. hunyuan-3d-pro charged nothing, because every submit was rejected. fal: $0. Capy model cost for the two host subagents was about $0.18.

## Lesson
Write the scene as content only and let a fixed per-style lead, look and guard wrap it. One spec then renders in any style, and the composition guard (one centered object, nothing past its edges, a plain background, no text) is what keeps the images usable for 3D. When an image model invents a backdrop or extra people, the fix belongs in that shared guard or in the scene-writer rules, never in a single style.
