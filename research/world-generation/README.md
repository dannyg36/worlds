# YCCO-6: World generation pipeline (handoff)

## Outcome

The pipeline turns a transcript into a world on Convex. It runs on GMI Cloud behind a small provider interface, and fal.ai's models are kept behind the same interface. The scene writer and the concept image work against real GMI. The 3D step is built and tested against a mocked GMI, but it has never run live, because GMI's hunyuan-3d-pro fails for our account.

### What works
- `worlds.add({ transcript })` creates a world and schedules a run. `status` moves through `queued`, `dreaming`, `painting`, and `sculpting` to `ready` or `failed`. Clients also get `title`, `caption`, `palette` (3 to 5 hex colors), `imageUrl`, `modelUrl`, and `error`.
- `worlds.get({ id })` returns one world, and `worlds.retry({ id })` regenerates a failed world from scratch. Every public read and the retry go through `convex/access.ts`, so the owner check for device profiles (YCCO-16, DAN-14) goes in that one file.
- **Steps:**
  1. `google/gemini-3.8-flash` writes the scene as JSON (title, caption, palette, image prompt).
  2. `seedream-4-0-250828` paints a 1024×1024 concept image.
  3. `hunyuan-3d-pro` (image-to-3D, 40,000 faces) should produce the GLB.
- The image and the GLB are stored in Convex file storage.
- **Run record:** every run is a `generationRuns` row. Each attempt records its provider, model, request id, submit, start, provider-done, and finish times, outcome, and error. The row also keeps per-step and total durations.
- **Reliability:**
  - GMI is polled with the scheduler, because it has no webhooks.
  - Failed or rejected requests are retried, with a per-model try limit.
  - A 3D job that runs past its timeout fails the world instead of paying for a second job, because GMI has no cancel endpoint.
  - Only one 3D job is in flight per deployment.
  - A one-minute cron watchdog revives lost poll chains and fails runs older than 30 minutes.
  - Duplicate completions are dropped, and their stored files are deleted.
- **Measured:** with real GMI on all 8 sample days, the 3D step starts about 12 s after `worlds.add` (median). Tables are in `results.md` and the images in `concepts/`.

### What's unfinished
- **The 3D step has never run live.**
  - GMI's `media_urls` shape for hunyuan-3d-pro is unverified. The code picks the entry whose `type` is `glb` or whose URL ends in `.glb`.
  - If GMI only returns Tencent's OBJ zip, the pipeline fails with "The model returned no GLB file (got …)" and needs a conversion step. Tencent's API returns GLB by default, so this is probably not needed.
  - The GLB's size (target under about 15 MB) and its latency are unknown.
- **Timeouts:** the 10-minute 3D timeout and the 3 s poll interval in `convex/generation/models.ts` are guesses until real runs exist.
- **Not wired yet:** the Supermemory recall call for the scene writer (Danny's crew owns `convex/memory.ts`) and owner scoping (YCCO-16).

### How to run it
```bash
npm ci
npx convex dev                                # local or your own dev deployment; never compassionate-goose-961
npx convex env set GMI_API_KEY <key>          # in a second terminal
npx vitest run                                # 25 Convex tests; GMI and fal are mocked
npx tsc --noEmit && npx expo lint && npx expo-doctor   # what CI runs
```
- **The model per step:** `convex/generation/models.ts`. `models = gmiModels` today; `falModels` is the fal version. To mix providers, use for example `{ ...gmiModels, sculpting: falModels.sculpting }` and set `FAL_KEY`.
- **Other code:**
  - Prompt: `convex/generation/sceneWriterPrompt.ts`.
  - Providers: `convex/generation/{provider,gmi,fal}.ts`.
  - State machine: `convex/pipeline.ts`.
- **Scripts** in `research/world-generation/scripts/` (absolute paths assume the repo is at `/workspace/worlds`):
  - `e2e-run.mjs` drives `worlds.add` on the local deployment.
  - `gmi.mjs` and `queue.mjs` probe GMI directly and redact the key.
  - `hunyuan-recent-jobs.mjs` lists the account's recent hunyuan jobs.

## PR

dannyg36/worlds#3 is a draft from branch `capy/world-generation-pipeline` into `main`. It does not contain the shelved sign-in commit b8c47ca.

## Needs

- **Blocked: GMI hunyuan-3d-pro (DAN-18, Rikhil).** Every submission fails with `ResourceInsufficient`, so GMI has to enable the model or fund it. The alternative is a fal key, which moves the 3D step to fal in one line. Send one probe first, never a burst.
- **Shipping to compassionate-goose-961:** aidan lee deploys it, and it needs `GMI_API_KEY` in that deployment's environment.
- **No auth yet:** anyone with the deployment URL can call `worlds.add` and start paid generation, until device profiles land.

### Next three steps
1. When DAN-18 clears, send one hunyuan-3d-pro job from a GMI concept image. Record the `outcome.media_urls` shape, the GLB size, and the queue and inference times. Then set the sculpting `timeoutMs` and `pollMs` from real numbers. If GLB size or format is a problem, add a conversion or compression step.
2. Run `scripts/e2e-run.mjs` on all 8 sample days with the real 3D step, one at a time, and fill in the 3D column of `results.md`. If the chain is far over a minute, try a faster image-to-3D model (one-line swap in `models.ts`), or show the concept image first.
3. Rebase onto YCCO-16's device profiles: add the owner check in `convex/access.ts` against `identity.tokenIdentifier`, with a test that another profile can't read or retry your world. Then wire the Supermemory recall into the scene writer's prompt.

## Cost

About $0.60 of GMI credit:
- **Images:** $0.40 for the 8 e2e concept images and $0.07 for the image probes. Two Z-Image-Turbo and Flux2-Klein requests are still queued at GMI and cost $0.01 each if they ever run.
- **LLMs:** about 130 short calls, probably under $0.15.
- **3D:** none. All 7 of this thread's hunyuan-3d-pro submissions failed at submit.

## Lesson

Reasoning models count their thinking against `max_tokens`. On short structured replies, deepseek-v4.1-flash sometimes spent the whole budget thinking and returned empty JSON. Check `finish_reason` in probes, and pick a model and setting that doesn't think for this kind of call.
