# 3D worlds: handoff from Gurnoor Sandu's crew

Written on 2026-11-15, when the team moved from Capy to Claude Code. This branch (`capy/gurnoor-3d-worlds`) merges everything the five threads built for the 3D side of worlds. The original branches are still on GitHub with their full history. This branch supersedes draft PR worlds#3, which holds only the generation pipeline.

## What it's for
worlds turns a 20-second voice note about your day into a small 3D world you can walk around in, about a minute later. This branch holds the generation pipeline, the in-app 3D viewer, and the research behind the model, style, and walkability choices.

## The pipeline design
1. `worlds.add({ transcript })` stores the day and schedules a generation run. Voice capture from Danny's crew (worlds#5) ends in this call.
2. **dreaming**: an LLM scene writer turns the transcript into a scene spec: title, one-line caption, palette, key elements, and an image prompt for one centered diorama of the day. Supermemory's recall (`recallCast` in `convex/memory.ts`, from worlds#4) feeds recurring people and places into this step; see "Merged main and Supermemory" below.
3. **painting**: a text-to-image model makes the concept image, which doubles as the feed thumbnail.
4. **sculpting**: an image-to-3D model makes a textured GLB.
5. **ready**, or **failed** with an error. Files live in Convex storage. Each step records its duration and the provider's request id.

## The contract between the pipeline and the app
`worlds.list` and `worlds.get({ id })` return:
- `transcript: string`
- `status?: "queued" | "dreaming" | "painting" | "sculpting" | "ready" | "failed"`, absent on rows created before the pipeline
- `title?`, `caption?`, and `palette?` (3 to 5 hex colors)
- `imageUrl?`, the concept image, present once painting finishes
- `modelUrl?`, the GLB, present when ready
- `error?`, present when the world failed

`worlds.retry({ id })` restarts a failed world. Every public read and retry goes through `convex/access.ts`. That file is where the owner check goes once device profiles land, using Danny's crew's `ownerTokenIdentifier` field.

## Providers: what works as of 2026-11-15
- **GMI Cloud** (`GMI_API_KEY`): the OpenAI-compatible LLM endpoint (`https://api.gmi-serving.com/v1/chat/completions`) works, and so do the image models `hy-image-v3.5-preview` and `seedream-4-0-250828`.
- **GMI's only 3D model, `hunyuan-3d-pro`, does not work for this account.** Every submit since 20:44 UTC fails with `hunyuan api error [ResourceInsufficient] Resources are insufficient.` That points to GMI's upstream Tencent account. Failing request id for GMI support: `3df2b954-fb73-43f1-b663-011508e3a99b`.
- **fal.ai** has no key yet. The pipeline started on fal, and its provider interface keeps a fal path, so moving just the 3D step to fal is a one-line change in the models module once `FAL_KEY` exists.
- See `gmi-cloud.md` next to this file for GMI's API and catalog notes.

## Shared test inputs
`sample-days.md` holds the 8 sample transcripts every thread used, so results compare across experiments.

## Other crews' work this depends on
- Voice capture: worlds#5 (`capy/add-voice-capture-sheet`), not on this branch.
- Supermemory: worlds#4 is merged into main and into this branch.
- The glass redesign, including the WorldCard feed component and the design system: `capy/glass-redesign`, from Neel Kolhe's crew, not on this branch. The 3D viewer here owns `src/app/world/` and `src/world/`, and the feed rows are meant to move to WorldCard.
- Device profiles (identity): Danny's crew.

## Where each part lives, its status, and next steps

### Source branches and their heads

| Branch | Head SHA | What it holds on this branch | How it got here |
| --- | --- | --- | --- |
| `capy/world-generation-pipeline` | `2abf27cdacc2cd7e82e2be54d868209e2c1295ab` | `convex/` pipeline, `vitest.config.mts`, `research/world-generation/` | merge commit |
| `capy/world-viewer` | `86a16c726eb4556a9b794109d72d72e14b5b00ac` | `src/app/world/`, `src/world/`, `src/app/index.tsx`, `research/viewer/` | merge commit |
| `capy/3d-bakeoff` | `dda29cfa68085a0bf35c0b48562be07be35aaf10` | `tools/3d-bakeoff/`, `research/3d-bakeoff/` | merge commit |
| `capy/art-direction` | `34eb2056e3feceb187e1c27df29b662968a414ed` | `research/art-direction/` | merge commit |
| `capy/walkable-composite` | `0f33353dfd391c3092fb47b5fdf67b0fd41ea749` | `spike/walkable/`, `research/walkable-worlds/` | files copied, one commit |
| `capy/walkable-pano3d` | `c2482e6505046c687b795c1741d65cab493ad048` | same two folders | files copied, one commit |
| `capy/walkable-splats` | `76e439fba7be7f3886fd0c75c6584a79723ad8c1` | same two folders | files copied, one commit |
| `capy/walkable-worldmodels` | `124f48df0af6f5b38898d7a1666f112cc3c8c5ec` | same two folders | files copied, one commit |
| `capy/walkable-skybox` | `1a1b960296446f2ea676c8bd803b0a2fedcd4de4` | same two folders | files copied, one commit |
| `capy/walkable-worlds-spike` | `a7c0ce8645b4d0409c134b6e91f15d8bf7b7fcbf` | same two folders (newest kit and the final recommendation) | files copied, one commit |

The six walkable branches fork from the shelved sign-in commit `b8c47ca`, so they were not merged. Each was copied with `git checkout <sha> -- spike/walkable research/walkable-worlds`, in the order composite, pano3d, splats, worldmodels, skybox, spike. The later copies win on the shared `spike/walkable/kit/` files. A checkout deletes nothing, so a file that one prototype branch removed can still be here from an earlier copy. That doesn't matter for a spike folder. Anything those branches changed outside the two folders was left out. `b8c47ca` is not an ancestor of this branch.

### Merged main and Supermemory
Main (f5df4e9, which includes worlds#4) is merged into this branch. Both sides had edits in `convex/convex.config.ts`, `convex/worlds.ts`, `convex/_generated/`, and `package.json`, and the merge keeps both. `worlds.add` now inserts the day, starts generation, and schedules `internal.memory.remember`. The generated API files were merged by hand in codegen order, so run `npx convex dev` once to regenerate them.

Recall is wired in. The `dreaming` step of `runStep` in `convex/pipeline.ts` calls `recallCast(transcript)` right before the LLM request. A non-empty `<recurring_cast>` block goes ahead of the voice note in the scene-writer prompt, with a blank line between them (`sceneWriterPrompt(transcript, cast)`). `recallCast` never throws and gives up after 4 seconds, and it returns `""` without `SUPERMEMORY_API_KEY`, so nothing changes without a key. It runs on the shared space; per-person spaces come with device profiles. `convex/pipeline.test.ts` mocks the recall and asserts the block reaches the LLM request. The two Supermemory tests that assumed no other scheduled work now ignore the pipeline's traffic.

### 1. Generation pipeline (YCCO-6)
- **Paths:** `convex/pipeline.ts`, `convex/generation/{provider,gmi,fal,models,scene,sceneWriterPrompt,tables}.ts`, `convex/access.ts`, `convex/crons.ts`, tests next to them, and `research/world-generation/` (README, `results.md`, `concepts/`, `scripts/`).
- **Works:** `worlds.add`, `worlds.get` and `worlds.retry` drive the status machine. Gemini 3.8 Flash writes the scene, Seedream paints the 1024 px concept image, and hunyuan-3d-pro sculpts the GLB. Every attempt is recorded in a `generationRuns` row with provider, model, request id, timings and outcome. GMI is polled through the scheduler. A one-minute cron watchdog revives lost chains and fails runs older than 30 minutes. A 3D job that times out fails the world instead of paying for a second one, because GMI has no cancel. Measured against real GMI on the 8 sample days, the 3D step starts about 12 s after `worlds.add`.
- **Run it:** `npm ci`, then `npx convex dev` on your own deployment (never compassionate-goose-961), then `npx convex env set GMI_API_KEY <key>`. `npx vitest run` runs the Convex tests with GMI and fal mocked. `research/world-generation/scripts/e2e-run.mjs` drives `worlds.add` on a local deployment, and `gmi.mjs` and `queue.mjs` probe GMI and redact the key. The absolute paths in those scripts assume `/workspace/worlds`.
- **Providers:** the model per step is in `convex/generation/models.ts`. `models = gmiModels` today. To move one step to fal, use `{ ...gmiModels, sculpting: falModels.sculpting }` and set `FAL_KEY`.
- **Blocked:** hunyuan-3d-pro fails every submit with `ResourceInsufficient` (DAN-18, Rikhil), so the 3D step has never run live. GMI's `media_urls` shape, the GLB's size and the 3D latency are unverified. The 10-minute 3D timeout and 3 s poll interval are guesses. There is no auth yet, so anyone with the deployment URL can start paid generation until device profiles land.
- **Next:**
  1. When the 3D provider works, send one hunyuan-3d-pro job from a concept image. Record the `media_urls` shape, the GLB size and the latency, then set `timeoutMs` and `pollMs`. Add a conversion or compression step if needed.
  2. Run `e2e-run.mjs` on all 8 sample days with the real 3D step, one at a time, and fill in the 3D column of `results.md`. If the chain is far over a minute, try a faster image-to-3D model or show the concept image first.
  3. Add the owner check in `convex/access.ts` against `identity.tokenIdentifier` when device profiles land, with a test that another profile can't read or retry your world.

### 2. World screen and viewer (YCCO-7)
- **Paths:** `src/app/world/[id].tsx`, `src/world/` (`viewer.tsx`, `forming.tsx`, `aurora.tsx`, `worlds.ts`, `fixtures.ts` and small UI pieces), `src/app/index.tsx` (feed rows), `research/viewer/` (README, screenshots, `webgl-test/`, `bake-off/`).
- **Works:** the world screen shows the forming state, then the viewer once `modelUrl` arrives. A failed world shows its error and a Try again button. A legacy row shows its transcript. The viewer is three.js r0.187 in an Expo DOM component (`"use dom"`, rendered by the built-in `@expo/dom-webview`) with a GLTF, Draco and Meshopt loader, palette-tinted stage, orbit controls, tap-to-fly, an entrance flight, and a walk mode with joystick, drag-to-look and tap-to-walk. Measured on a cloud iPhone 16 simulator: 60.1 fps average and 2.7 s load for the DamagedHelmet fixture, and 59 to 60 fps in Mobile Safari for 4 to 14 MB GLBs. Eight fixture worlds use Khronos sample GLBs.
- **Changed in this merge:** `useRetryWorld` in `src/world/worlds.ts` now calls `api.worlds.retry`, since the pipeline is on this branch. `useWorld` still reads `worlds.list` and finds the id, which returns null for unknown ids. Switching it to `api.worlds.get` needs an id check first, because `get` rejects ids that aren't Convex ids.
- **Run it:** `npm ci`. In `.env.local` (gitignored) set `EXPO_PUBLIC_CONVEX_URL` to your own Convex dev deployment, `EXPO_PUBLIC_FIXTURES=1`, and optionally `EXPO_PUBLIC_VIEWER_STATS=1`. Run `npx convex dev`, then `npx expo run:ios`. `npx expo start --web` also works for a quick look. Tap a feed row or open `worlds://world/fixture-dolores-park`. `fixture-hackathon` plays the whole forming sequence, and `fixture-rainy-monday` tests retry (retrying a fixture is handled locally).
- **Blocked / unverified:** the latest viewer commits (dark stage, contact shadow, walk mode, tap-to-fly, pinch) were checked only in Chrome on a cloud VM and not on a phone, because cloud phones stopped working (DAN-20). The rendering-stack bake-off arms (r3f/expo-gl and react-native-filament) never drew a model on a phone. Real hunyuan GLBs never replaced the fixtures (DAN-18). Neel's design spec never landed. Dev builds show a harmless LogBox warning about `DomWebView` (expo/expo#52503). Web isn't a target.
- **Next:**
  1. Run the viewer on an iPhone and record a short video: dark stage, contact shadow, walk mode, tap-to-fly, pinch, entrance.
  2. Swap the fixtures for real image-to-3D GLBs (40k+ faces, PBR). Check load time and 60 fps. Tune walk eye height (0.075) and speed (0.34).
  3. Move the feed rows to WorldCard from `capy/glass-redesign` and apply Neel's spec to the chrome.

### 3. Image-to-3D bake-off (YCCO-8)
- **Paths:** `tools/3d-bakeoff/` (harness) and `research/3d-bakeoff/` (`REPORT.md`, `catalog/`, `gmi-cloud.md`, `results/`, `renders/`, `sample-worlds/`).
- **Works:** the harness runs a candidates-by-days matrix on GMI's request queue or fal's queue, with a spend ledger and a cap, and stops the whole run at the first rejected submit or quota error. It also has GLB inspect, headless render and contact-sheet scripts, `optimize.mjs` for phone-ready variants, and `fixture.mjs` to normalize a GLB. `candidates.json` lists 6 hunyuan-3d-pro configs and 30 fal candidates. The 8 concept images are in `research/3d-bakeoff/sample-worlds/<day>/concept.png`. 8 interim GLBs from Stable Fast 3D (22k to 37k triangles, 1 to 1.6 MB) are there too, but they are smeared from behind and three days lost parts to a too-aggressive background cutout (`cutout.py` fixes that). The GMI and fal catalogs and the Hugging Face Space survey are in the report.
- **Run it:** `cd tools/3d-bakeoff && npm install`, check `test -n "$GMI_API_KEY" && echo set`, then send one probe: `node run.mjs --tag probe --candidates gmi-h3d-i-normal-500k --days rainy-monday`. `tools/3d-bakeoff/README.md` and `research/3d-bakeoff/REPORT.md` have the full matrix commands.
- **Blocked:** hunyuan-3d-pro rejects every submit (DAN-18), there's no `FAL_KEY`, and the anonymous Hugging Face ZeroGPU quota is used up until about 21:00 UTC on 2026-11-16. Someone with GMI console access should check whether the 20 failed submits were billed (up to $7.50 if so).
- **Next:**
  1. Once a 3D provider works, send the single probe, confirm the output format and latency, then run the 6 GMI configs by 8 days (48 jobs, about $18, at most 2 in flight).
  2. Render and inspect the outputs, rank them, run `optimize.mjs` on the winner, and write down the recommended model and settings.
  3. Replace the 8 interim fixtures with the winner's GLBs through `fixture.mjs`, keeping the file names so the viewer doesn't change.

### 4. Art direction (YCCO-9)
- **Paths:** `research/art-direction/` (`README.md`, `contact-sheets/`, `scene-writer/`, `scene_writer/`, `images/`, `style-3d-inputs/`, `scripts/`, `render/`, `ledger.jsonl`). Start with `contact-sheets/0-overview.jpg`.
- **Decision status: Rikhil has not picked the house style yet.** The recommendation is **clay** (claymation diorama): most consistent across all 8 days and both image models, every personal detail reads at a glance, and chunky matte clay on a wooden base is the likeliest to survive image-to-3D. **Vinyl toy** is a close second if he wants cuter and more collectible. **Low-poly floating island** wins only if hunyuan-3d-pro's LowPoly mode produces meshes that hold up. **Tilt-shift miniature** looks best flat but has the smallest figures and thinnest parts, so it will probably break in 3D.
- **Works:** `scene-writer/sceneWriter.ts` is self-contained TypeScript with the prompt, schema, style recipes, validator and model fallback. On gemini-3.8-flash it returned 30 valid specs out of 30 (p50 4.2 s, about $0.003 a call), and handles empty, filler, rambling, profane, injection and Spanish notes. Four house-style recipes live in `styles.json`, with four runners-up. The style matrix has 4 styles by 8 days on two image models (58 of 64 tiles). `style-3d-inputs/` has the 15 hunyuan jobs staged ($5.63).
- **Run it:** from `research/art-direction/`, `python3 -m venv .venv && . .venv/bin/activate && pip install httpx pillow`, export `GMI_API_KEY`, then use `scripts/run_scene_writer.py` and `scripts/run_images.py`. `research/art-direction/README.md` has the exact commands. `scripts/build_sheets.py` needs the full-size originals, which aren't committed; download them from the URLs in `outputs/images/full/**/*.json`.
- **Blocked / unfinished:** the 3D check waits on DAN-18 or a `FAL_KEY`, so the contact sheets show "3D pending" tiles. Six Seedream tiles are blank. A "no extra people or animals" guard sentence was tested on only 8 images (clay stopped inventing diners, vinyl still seated one).
- **Next:**
  1. Show Rikhil the overview and the four style sheets, get his pick, and set `DEFAULT_STYLE` in `sceneWriter.ts` (it is `clay` now).
  2. When 3D works, run the 15 staged jobs one at a time, render each GLB, and fill the "3D pending" tiles. If the pick falls apart in 3D, move to the next style.
  3. Hand `scene-writer/` to the pipeline: call `writeScene`, then `buildImagePrompt`, then Flare (`gpt-image-2.5-flare-generate`) on GMI's request queue, and store `title`, `caption` and `palette`. The pipeline's own prompt in `convex/generation/sceneWriterPrompt.ts` is simpler and has no style recipes, and `CONCEPT_IMAGE_STYLE` there is a clay-toy placeholder.

### 5. Walkable worlds spike (YCCO-10)
- **Paths:** `spike/walkable/` (`kit/`, `skybox/`, `pano3d/`, `splats/`, `worldmodels/`, `composite/`, `catalog/`, `ledger/`, `scenes.json`, `inputs.json`) and `research/walkable-worlds/` (`README.md` has the ranked table and numbers). `docs/3d-worlds/walkable-worlds.md` is the panorama recipe.
- **Recommendation:** ship the day's diorama inside a 360° panorama for the demo, viewed at orbit and table scale. A depth-lifted panorama (about a metre of parallax) is the stretch, and an image-card composite works as a "step inside" mode. Real-time world models aren't ready.
- **Works:** each approach has a three.js or Spark prototype and generated assets for the `hackathon` and `santa-cruz` days.
  - **Skybox:** a seam-fixed 4K panorama from GMI (`gpt-image-2.5-flare-generate`, then `bria-genfill`, then a 2x `bria-image-increase-resolution`) costs $0.088 and about 60 s per world. The viewer has orbit, stand and table modes, PMREM lighting and a HUD.
  - **pano3d:** CPU depth fused into a displaced-sphere mesh.
  - **splats:** a Spark 2.4 viewer and a pipeline from panorama to MoGe-2 depth to .spz (about 60 s a day, 8 MB worlds).
  - **composite:** object images from the scene spec, background removal, depth relief, walking and collision.
  - **worldmodels:** a guarded fal proxy (mock-tested) and a GMI image-to-video "branching walk".
  - **kit:** `kit/gmi.mjs` and `kit/fal.mjs` are budgeted runners that log every call to `spike/walkable/ledger/`.
- **Run it:** `cd spike/walkable/kit && npm install`, then `node spike/walkable/<approach>/fetch-assets.mjs && node spike/walkable/<approach>/serve.mjs` and open `http://localhost:<port>/?day=hackathon` (or `santa-cruz`). Ports: skybox 5101, pano3d 5102, splats 5103, worldmodels 5104, composite 5105. The pages load three.js and Spark from jsDelivr. To regenerate, set `GMI_API_KEY` and run `node spike/walkable/kit/gmi.mjs run --approach <approach> --model <id> --est <usd> --payload '{...}'`. Each approach's `RESULTS.md` has its generation commands.
- **Blocked / unfinished:** no approach has run on a real iPhone with final assets (DAN-20). Any true 3D (diorama GLB, life-size worlds, 3D composite, object splats) needs a working 3D provider (DAN-18); the fal options are `fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d` (\$0.225), `fal-ai/trellis-2` (\$0.25 to \$0.35) and `fal-ai/hyper3d/rodin/v2.5/fast` (\$0.10), and for splats `tripo3d/triposplat` or `speridlabs/idol` (\$0.10). Live world models need `FAL_KEY` (`robbyant/lingbot-world-2` or `alibaba/abot-world-0`, \$0.00125 a second) or a GPU, and HunyuanWorld panorama-to-world needs fal (`fal-ai/hunyuan_world/image-to-world`, \$0.30) or a GPU. Hosted depth (`microsoft/moge-2`, \$0.01 per megapixel) would also give the panorama its parallax. Smaller gaps: pano3d's santa-cruz depth stopped at 12 of 14 crops, the composite's sprite auto-crop failed on most cells, and `kit/gmi.mjs upload` fails on `.jpg` with `SignatureDoesNotMatch` (use `.jpeg`). The request id is logged only when a job finishes, so a machine that sleeps mid-poll loses it.
- **Next:**
  1. Hand the panorama recipe to the pipeline and viewer. The pipeline adds a `panoramaUrl` field and starts the panorama chain after the scene writer, in parallel with concept-to-3D. The viewer hosts the skybox page in `react-native-webview` or ports it to `expo-gl`.
  2. When phones or 3D come back, run the skybox viewer on a real iPhone with a real day GLB and the 4K panorama, and record FPS, cold load and memory.
  3. Fix the panorama's weak spots: upscale before the seam fix, add "no text, no signage" to the prompt, and replace the flat `GroundedSkybox` floor using depth.
- **Decision for Rikhil:** panorama at table scale for the demo (recommended), or wait for depth or 3D and go to life size.

## Repo layout notes
- `spike/`, `tools/` and `research/` hold sub-projects with their own `package.json` files. They are excluded from the root `tsc` and `expo lint` in `tsconfig.json` and `eslint.config.js`. The root `vitest` only runs `convex/**/*.test.ts`.
- No `.env` files or key values are committed. Every file is under 5 MB. Larger originals (such as Seedream's 2048 px images and some .spz worlds) were left out; some of them are in Capy Drive and may not be reachable after the move.
- The full-size art-direction originals are not in git. Their public GMI storage URLs are in `research/art-direction/outputs/images/full/**/*.json`.

## Check results
Run on this branch after the last merge, at the repo root:

| Check | Result |
| --- | --- |
| `npm install` / `npm ci` | succeeds; lockfile regenerated after the conflicting merges |
| `npx tsc --noEmit` | passes |
| `npx expo lint` | passes |
| `npx vitest run` | 5 files, 37 tests pass |
| `npx expo-doctor` | 20/20 checks pass |

Before `research/`, `tools/` and `spike/` were excluded, `tsc` failed only on `research/viewer/bake-off`, which imports packages the root doesn't install (`@react-three/fiber`, `react-native-filament`). The sub-projects' own checks (`tools/3d-bakeoff`, `spike/walkable/kit`) were not run.
