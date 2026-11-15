# 3D bake-off harness

Benchmarks image-to-3D and text-to-3D models for worlds: generate concept images, run every candidate on every sample day, inspect and render each GLB headlessly, and test phone-ready variants. Providers sit behind one adapter (`providers.mjs`: GMI Cloud's request queue and fal's queue), so a candidate names its provider and model. Outputs land in `out/` (git-ignored).

```bash
cd tools/3d-bakeoff && npm install
test -n "$GMI_API_KEY" && echo set         # GMI candidates; fal candidates need FAL_KEY. Never print either.
node concept.mjs                           # 8 concept images from recipe.json + days.json
node run.mjs --tag probe --candidates gmi-h3d-i-normal-500k --days rainy-monday   # one job
node run.mjs --tag gmi --candidates gmi-h3d-i-normal-150k,gmi-h3d-i-lowpoly --concurrency 2
node inspect.mjs --tag gmi                 # triangles, textures, size -> out/gmi/stats.json
node render.mjs --tag gmi                  # 4 orbit views per GLB (three.js in headless Chromium)
node sheet.mjs hero --tag gmi              # contact sheet: candidates x days
node optimize.mjs --tag gmi --candidates gmi-h3d-i-normal-150k --presets phone-100k,phone-50k
node fixture.mjs --tag gmi --candidate gmi-h3d-i-normal-150k   # Y up, 1-unit, grounded, concept view on +Z
```

- `candidates.json` lists each candidate's provider, model id, fixed parameters, image or text mode, and price per run.
- `run.mjs` records submit, start-of-processing, and result times, so wall-clock includes queueing. Every submission is written to `out/ledger.jsonl` first, and runs refuse to start past `--cap` (default `$BAKEOFF_CAP_USD` or $45). A rejected submit, or any error mentioning insufficient resources, quota, or a rate limit, stops the whole run with no retry. Other failures are retried only with `--retries N` (default 0).
- `hf_spaces.py` runs the same day set through public Hugging Face Spaces (SF3D, Hunyuan3D-2 and 2.1, TRELLIS.2) and writes the same `out/<tag>/<candidate>/<day>.glb` layout, so the inspect, render, and sheet steps work unchanged. Anonymous ZeroGPU calls are capped at a handful of runs per day per caller; a quota error stops the run. Feed it cutouts from `cutout.py`, which removes the plain studio background and keeps the diorama base.
