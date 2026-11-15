# Walkable worlds spike (YCCO-10)

Throwaway prototypes that answer one question: how far past a single 3D diorama can we go on fal, toward a world you can stand inside and look around on an iPhone. Nothing here is app code and nothing here ships as-is; the winner's recipe goes to the viewer and pipeline threads as a handoff.

## Layout

- `kit/fal.mjs`: the only way this spike calls fal. Every call is checked against `kit/budget.json` and logged to `ledger/<approach>.jsonl` with latency, queue wait, request id, estimated cost, and the output files (downloaded when you pass `--out`).
- `scenes.json`: hand-written scene specs for the 8 sample days. `hackathon` (indoor) and `santa-cruz` (outdoor) are the two primary days and carry full prompts and object lists. Every approach uses these same prompts so results compare.
- `inputs.json`: shared base images per primary day (concept diorama image, eye-level image, first panorama) as fal CDN URLs. Use them instead of generating your own.
- `<approach>/`: one folder per approach, owned by exactly one agent: `skybox`, `pano3d`, `splats`, `worldmodels`, `composite`. Each ends with a `RESULTS.md`.

## Rules

- FAL_KEY: check presence only, with `test -n "$FAL_KEY" && echo set`. Never print it, write it to a file, send it to a browser, or put it in a page or URL. Browser pages never call fal directly; only CLI scripts and server code do, and a server that can call fal needs an endpoint allowlist and a hard spend cap.
- Budget: read the price in `https://fal.ai/models/<endpoint>/llms.txt` before each call and pass it as `--est` (USD). The kit refuses a call that would take your approach past its cap. No unbounded loops.
- Binaries (glb, ply, spz, drc, mp4, large images) stay out of git: keep their fal URLs in a manifest and download them into `<approach>/assets/`, which is gitignored.
- Each agent pushes only its own branch, `capy/walkable-<approach>`.

## Usage

```bash
cd spike/walkable/kit && npm install
node fal.mjs run --approach skybox --endpoint fal-ai/hunyuan_world --est 0.15 \
  --label hackathon-pano --out ../skybox/assets/hackathon \
  --input '{"image_url":"https://...","prompt":"..."}'
node fal.mjs upload ../skybox/assets/local.png        # returns a fal CDN URL
node fal.mjs charge --approach worldmodels --endpoint robbyant/lingbot-world-2 --est 0.15 --note "120 s session reserve"
node fal.mjs spent --approach skybox                   # or --all
```

From code: `import { run, upload, charge, spent } from "../kit/fal.mjs"`; `run({ approach, endpoint, input, estCostUsd, label, outDir })` returns `{ data, entry }`.
