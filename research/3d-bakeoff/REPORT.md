# YCCO-8: image-to-3D bake-off (handoff for Claude Code)

## Outcome
The harness, the provider surveys, 8 concept images, and 8 interim GLBs are done and on branch `capy/3d-bakeoff` (based on `main`). The bake-off itself is unfinished: GMI's only 3D model, hunyuan-3d-pro, has rejected every request since 20:44 UTC on 2026-11-15 (DAN-18), there is no FAL_KEY, and the anonymous Hugging Face allowance ran out after 8 runs.

### What works
- **Harness** in `tools/3d-bakeoff/`:
  - `providers.mjs` runs a job on GMI's request queue or fal's queue.
  - `concept.mjs` generates the concept images.
  - `run.mjs` runs the candidates x days matrix with a spend ledger and a cap. It stops the whole run on a rejected submit or a quota or rate-limit error, and doesn't retry by default.
  - `inspect.mjs`, `render.mjs` (three.js in headless Chromium), and `sheet.mjs` report triangles and textures, render 4 orbit views per GLB, and build contact sheets.
  - `optimize.mjs` makes phone-ready variants, and `fixture.mjs` normalizes a GLB (Y up, 1 unit, grounded, concept view on +Z).
  - `hf_spaces.py` runs Hugging Face Spaces, and `cutout.py` removes the studio background.
  - `candidates.json` has 6 hunyuan-3d-pro configs (image vs text, Normal vs LowPoly, 40k/150k/500k faces, PBR on/off) and 30 fal candidates.
- **Concept images** for all 8 sample days come from GMI `gpt-image-2.5-flare-generate` at quality low: $0.006 and 9 to 26 s each. They're in `research/3d-bakeoff/sample-worlds/<day>/concept.png`, and the prompts are in `research/3d-bakeoff/results/concept-manifest.json`. All 8 read as their day.
- **Interim GLBs** for all 8 days come from Stable Fast 3D on the public `stabilityai/stable-fast-3d` Space: 22k to 37k triangles, 1.0 to 1.6 MB, 4 to 9 s each with an empty queue and up to 62 s when queued. From the concept's viewpoint most days read as the day, but every model is a smeared shell from behind. dolores-park, birthday-dinner, and finals-library lost parts because the first background cutout was too aggressive. `cutout.py` now fixes that, but there was no quota left to rerun. Conventions are in `research/3d-bakeoff/sample-worlds/README.md`.
- **Catalog findings:**
  - GMI: `research/3d-bakeoff/gmi-cloud.md` and `research/3d-bakeoff/catalog/`. hunyuan-3d-pro is the only 3D model. The file also has image-model prices and latencies, LLM prices from `/v1/models`, and the request-queue API.
  - fal: `tools/3d-bakeoff/catalog-2026-11.json` lists about 50 image-to-3D endpoints with prices and options.

### Hugging Face Spaces (2026-11-15, anonymous)
| Space | State | GPU time it asks for | Result |
| --- | --- | --- | --- |
| stabilityai/stable-fast-3d | running, ZeroGPU | 60 s | 8 textured GLBs. Needs an RGBA input, and the API hides a button input, so pass "Run" as the first positional argument. |
| tencent/Hunyuan3D-2 | running | 90 s textured, 40 s shape only | Refused: "exceeded your ZeroGPU runs limit" |
| tencent/Hunyuan3D-2.1 | running | 180 s textured, 60 s shape only | Not tried; the 180 s ask exceeds the anonymous 120 s per day |
| microsoft/TRELLIS.2 | running | 120 s generate, then 120 s extract | Not tried; it needs 240 s |
| trellis-community/TRELLIS | running | 120 s for one call | Not tried |
| VAST-AI/TripoSG, TencentARC/InstantMesh, Stable-X/Hi3DGen | running | 90 to 210 s | Not tried |
| frogleo/Image-to-3D | running | 40 s | Untextured mesh only |
| tencent/Hunyuan3D-2mini-Turbo | running | n/a | Its API info returns HTTP 500 |
| microsoft/TRELLIS, stabilityai/TripoSR, stepfun-ai/Step1X-3D, stabilityai/stable-point-aware-3d | config, runtime, or build error, or paused | n/a | Unusable |
| wushuang98/Direct3D-S2, ilcve21/Sparc3D | CPU iframes to outside demos | n/a | Direct3D's backend doesn't resolve, and Sparc3D's is a web app |

Anonymous ZeroGPU quota is 2 minutes of GPU a day, plus a separate runs limit that was hit after 8 short SF3D runs. A Space starts a call only if the remaining quota covers the GPU time that call asks for. Per Hugging Face's docs, a free account gets 5 minutes a day (about 2 or 3 textured models) and PRO gets 40 minutes (all 8 days for 2 models in one sitting). The Hunyuan3D-2.1 and TRELLIS.2 recipes in `hf_spaces.py` are written but untested.

## PR
None. All work is on branch `capy/3d-bakeoff`, rebased onto `main` without the shelved sign-in commit b8c47ca.

### How to run
```bash
cd tools/3d-bakeoff && npm install
test -n "$GMI_API_KEY" && echo set
node run.mjs --tag probe --candidates gmi-h3d-i-normal-500k --days rainy-monday        # one job; send this first
node run.mjs --tag gmi --candidates gmi-h3d-i-normal-500k,gmi-h3d-i-normal-150k,gmi-h3d-i-normal-40k,gmi-h3d-i-normal-500k-pbr,gmi-h3d-i-lowpoly,gmi-h3d-t-normal-500k --concurrency 2
node inspect.mjs --tag gmi && node render.mjs --tag gmi && node sheet.mjs hero --tag gmi
node fixture.mjs --tag gmi --candidate <best> --yaw <deg>   # pick yaw so the concept view faces +Z
# Hugging Face (needs HF_TOKEN for more than a few runs; pass it to gradio_client's Client(hf_token=...)):
uv run --with numpy --with scipy --with pillow python cutout.py --tag hf --gaps birthday-dinner
uv run --with gradio_client python hf_spaces.py --candidates hf-sf3d --tag hf --force
```
Concept image URLs in `out/concept/manifest.json` are public GMI storage links. hunyuan-3d-pro's image-to-3D mode takes `image_url`, so regenerate the concepts if those links have expired.

### Blocked
- hunyuan-3d-pro fails every submit with HTTP 500 `hunyuan api error [ResourceInsufficient] Resources are insufficient.`, whatever the input or face count. All 30 hunyuan requests in the org's history failed this way, and none ever ran. DAN-18 is with Rikhil.
- No FAL_KEY, so the 30 fal candidates are untested.
- Hugging Face anonymous quota is used up until about 21:00 UTC on 2026-11-16.

## Needs
- A working 3D provider: GMI fixing hunyuan-3d-pro (DAN-18) or a FAL_KEY. Optionally an HF_TOKEN (PRO is best) to get good open-model GLBs in the meantime.
- Someone with GMI console access to check Usage for whether the failed hunyuan-3d-pro requests were billed.

### Next three steps
1. When GMI or fal works, send the single probe above. Confirm the output format by its magic bytes and measure its latency, then run the 6 GMI configs x 8 days (48 jobs, about $18, at most 2 in flight).
2. Render and inspect the outputs, rank them on reading as the day, textures, geometry, size, and latency, run `optimize.mjs` on the winner, and write `handoffs/3d-models.md` with the recommended model and settings.
3. Replace the 8 interim fixtures in `research/3d-bakeoff/sample-worlds/` (and Drive `handoffs/sample-worlds/`) with the winner's GLBs through `fixture.mjs`, keeping the file names so the viewer doesn't change.

## Cost
- Generation is about $0.29 by the local ledger. That covers 12 flare concept images and image-model probes on GMI. Hugging Face and fal cost $0.
- This thread sent 20 hunyuan-3d-pro submits that were all rejected. They would cost $7.50 if GMI bills failed requests, which is unverified.
- One Flux2-Klein probe has been stuck in queued since about 20:40 UTC. It costs $0.01 if it ever runs.
- This Capy thread cost $18.19 priced ($12.92 charged) by 21:15 UTC.

## Lesson
Send one probe before a matrix, and make the runner stop at the first rejection from the provider. My first GMI run sent 16 submits within seconds into an outage, which is now the runner's default.

### Files in Capy Drive (captain-gurnoor-sandu)
- `handoffs/sample-worlds/`: the same fixtures as `research/3d-bakeoff/sample-worlds/`
- `handoffs/gmi-cloud.md`: the shared GMI notes (copied to `research/3d-bakeoff/gmi-cloud.md`)
- `renders/YCCO-8/interim-sf3d-orbits.jpg`: 4 orbit views of each SF3D fixture (also in `research/3d-bakeoff/renders/`)
No file is over 5 MB, so nothing exists only in Drive.
