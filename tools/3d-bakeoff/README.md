# 3D bake-off harness

Benchmarks fal.ai image-to-3D endpoints for worlds: generate concept images, run every candidate on every sample day, inspect and render each GLB headlessly, and test phone-ready variants. Outputs land in `out/` (git-ignored).

```bash
cd tools/3d-bakeoff && npm install
test -n "$FAL_KEY" && echo set            # needs FAL_KEY; never print it
node concept.mjs                           # 8 concept images from recipe.json + days.json
node run.mjs --candidates trellis2-1024,hy31-rapid --days hackathon,santa-cruz --concurrency 4
node inspect.mjs --tag matrix              # triangles, textures, size -> out/matrix/stats.json
node render.mjs --tag matrix               # 4 orbit views per GLB (three.js in headless Chromium)
node sheet.mjs hero --tag matrix           # contact sheet: candidates x days
node optimize.mjs --tag matrix --candidates trellis2-1024 --presets phone-100k,phone-50k
```

- `candidates.json` lists each endpoint id, its fixed parameters, and its published price per run.
- `run.mjs` submits through fal's queue API and records submit, dispatch, completion, and result times, so wall-clock includes queueing.
- Every submission is written to `out/ledger.jsonl` first, and runs refuse to start past `--cap` (default `$BAKEOFF_CAP_USD` or $45).
