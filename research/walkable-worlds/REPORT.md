# YCCO-10: Walkable worlds spike (handoff)

## Outcome

**Recommendation:** ship the day's diorama inside a 360° panorama for the demo, viewed at orbit and table scale. A depth-lifted panorama, giving about a metre of parallax, is the stretch. A composite of image cards works as a "step inside" mode. Real-time world models aren't ready yet. The ranked table and numbers are in `research/walkable-worlds/README.md` on `capy/walkable-worlds-spike`.

**What works**
- **Panorama skybox** (`capy/walkable-skybox`): a seam-fixed 4K equirectangular panorama from GMI (`gpt-image-2.5-flare-generate`, then `bria-genfill`, then a `bria-image-increase-resolution` 2× upscale) costs $0.088 and about 60 s per world. A three.js viewer has orbit, stand/table and stand/life modes, PMREM lighting from the panorama, `GroundedSkybox`, drag-look, a joystick, and a HUD that posts stats. A cutout card of the concept image stands in for the diorama. Real assets exist for both days.
- **Depth mesh** (`capy/walkable-pano3d`): CPU depth (MoGe-2 or Depth Anything V2) on crops of the panorama is fused into a displaced-sphere mesh, with a 3D/pano toggle and a "2 steps" button. Hackathon is complete in three depth modes.
- **Splats** (`capy/walkable-splats`): a Spark 2.4 viewer and a CPU pipeline from panorama to MoGe-2 depth to one Gaussian per pixel to .spz, about 60 s per day, with 8 MB worlds for both days. It includes a splat-count benchmark that ran on the cloud iPhone.
- **Image-card composite** (`capy/walkable-composite`): from the scene spec, it generates object images on GMI, removes their backgrounds, adds CPU depth relief, and lays them out procedurally on an island under the panorama, with walking and collision. Both days are built.
- **World models** (`capy/walkable-worldmodels`): a guarded fal WMA proxy (endpoint allowlist, session cap, spend cap) and a phone page with joystick, HUD, probes and recorder, mock-tested. A GMI "branching walk" of image-to-video clips works for both days.
- **Kit** (`capy/walkable-worlds-spike`): `spike/walkable/kit/gmi.mjs` and `fal.mjs` are budgeted runners that log every call to `spike/walkable/ledger/`. There are also catalog snapshots of GMI and fal, and shared inputs.

**Unfinished**
- No approach has run on a real iPhone with its final assets. Phones went down at about 21:00 UTC (DAN-20). The earlier cloud-iPhone runs used placeholder or sample assets on a device that may be a simulator.
- pano3d: santa-cruz MoGe-2 stopped at 12 of 14 crops, santa-cruz isn't published, and its WebKit check never ran.
- splats: the MP4 stopped at 4.2 s, and the VGGT stretch was cut.
- composite: the sprite-sheet auto-crop failed on most cells, and the depth step runs one object at a time.
- worldmodels: no live fal session has run, and santa-cruz has no second-hop clips.
- skybox: the best order is to upscale first and then fix the seam at 4K; that wasn't tested. The `GroundedSkybox` floor smears near your feet.
- kit: `gmi.mjs upload` fails on `.jpg` with a GCS `SignatureDoesNotMatch` (use `.jpeg`). The request id is logged only when a job finishes, so a machine that sleeps mid-poll loses it.

**How to run** (from the repo root, on the approach's branch)
1. `cd spike/walkable/kit && npm install && cd -`
2. `node spike/walkable/<approach>/fetch-assets.mjs && node spike/walkable/<approach>/serve.mjs`, then open `http://localhost:<port>/?day=hackathon` (or `?day=santa-cruz`). Ports: skybox 5101, pano3d 5102, splats 5103, worldmodels 5104, composite 5105. Pages load three.js and Spark from jsDelivr.
3. To regenerate, set `GMI_API_KEY` and run `node spike/walkable/kit/gmi.mjs run --approach <approach> --model <id> --est <usd> --payload '{...}'`. Each approach's RESULTS.md has its exact generation commands; skybox's are in `gen.mjs`.

**Blocked**
- Any true 3D (the day's diorama GLB, life-size worlds, the 3D composite, object splats) is **blocked: GMI `hunyuan-3d-pro` returns ResourceInsufficient** (DAN-18). The fal alternatives are `fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d` ($0.225), `fal-ai/trellis-2` ($0.25–0.35), `fal-ai/hyper3d/rodin/v2.5/fast` ($0.10), and for splats `tripo3d/triposplat` or `speridlabs/idol` ($0.10).
- **Real-iPhone checks:** pending until phones work (DAN-20).
- **Live world models:** need FAL_KEY (`robbyant/lingbot-world-2` or `alibaba/abot-world-0`, $0.00125 per second) or a GPU deployment.
- **HunyuanWorld panorama-to-world:** needs fal (`fal-ai/hunyuan_world/image-to-world`, $0.30) or a GPU.

**Next three steps**
1. Hand the panorama recipe (`handoffs/walkable-worlds.md` in the Captain drive) to the pipeline and the viewer. The pipeline adds a `panoramaUrl` field and starts the panorama chain right after the scene writer, in parallel with concept-to-3D. The viewer hosts the skybox page in `react-native-webview`, or ports it to `expo-gl`.
2. When phones or 3D come back, run the skybox viewer on a real iPhone with a real day GLB and the 4K seam-fixed panorama, and record FPS, cold load and memory.
3. Fix the panorama's weak spots: upscale before the seam fix, add "no text, no signage" to the prompt, and replace the flat `GroundedSkybox` floor using depth. Once a hosted depth model is available (fal `microsoft/moge-2`, $0.01 per megapixel), that same depth also gives about a metre of parallax, which is the rank 2 upgrade.

## PR

None; this was a spike. Six branches are pushed, with their head SHAs in the final report to the Captain:

| Branch | Contents |
| --- | --- |
| `capy/walkable-worlds-spike` | kit, scene specs, shared inputs, catalogs, `research/walkable-worlds/` (README, this report) |
| `capy/walkable-skybox` | panorama skybox prototype |
| `capy/walkable-pano3d` | panorama-to-depth-mesh prototype |
| `capy/walkable-splats` | splat viewer, benchmark, pano-to-splat pipeline |
| `capy/walkable-worldmodels` | world-model proxy and page, branching video walk |
| `capy/walkable-composite` | composite renderer and pipeline |

All six contain the shelved sign-in commit b8c47ca, because they fork from `capy/google-apple-sign-in`. The changes are confined to `spike/walkable/` and `research/walkable-worlds/`.

## Needs

- **DAN-18:** GMI 3D working again, or a FAL_KEY. Every true-3D path waits on it.
- **DAN-20:** cloud phones, for the real-iPhone checks.
- **A decision for Rikhil:** the panorama at table scale for the demo (recommended), or wait for depth or 3D and go to life size.

## Cost

- **GMI generation:** about $5.96, estimated from list prices: root $0.28, skybox $0.33, pano3d $0, splats $0, worldmodels $3.81, composite $1.54. That includes a few reservations and requests whose results were lost when machines slept. GMI didn't charge the failed 3D submits.
- **fal:** $0; no calls were made.
- **Capy (LLM and VMs) for this thread and its subagents:** about $92.70 priced, of which $66.26 was charged to Capy credits and $24.13 went to Rikhil's Anthropic key. The five subagents account for about $78 of the priced total.

## Lesson

Pin the provider and test a 3D call before fanning out. Five parallel prototypers spent their first hour building fal-shaped plans, and the binding constraints turned out to be GMI's latency, its missing model categories, and a dead 3D endpoint. One cheap probe of each provider's 3D, panorama, depth and world-model endpoints at the start would have found all three.

## Files in the Captain drive

- `reports/YCCO-10.md` (this file) and `handoffs/walkable-worlds.md` (the winner's recipe). This thread also added a verified section to `handoffs/gmi-cloud.md`.
- Renders: `renders/YCCO-10/`, with `skybox/`, `pano3d/`, `splats/` (including the two 7–8 MB .spz worlds), `worldmodels/` (including `walk-santa-cruz-hailuo.mp4`, 7.6 MB) and `composite/`. Files under 5 MB are also committed under `research/walkable-worlds/<approach>/` on each branch.
