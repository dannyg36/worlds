# Walkable worlds spike (YCCO-10): ranked recommendation

How far past a single 3D diorama can we go toward a world you stand inside and look around on an iPhone? Five approaches were prototyped in parallel on 2026-11-15. The provider moved from fal to GMI Cloud mid-spike, GMI's only 3D model (`hunyuan-3d-pro`) failed for the whole account with `ResourceInsufficient`, and cloud iPhones stopped starting at about 21:00 UTC (DAN-20), so some checks are pending. Everything below says which numbers were measured and which are pending.

## Ranking

| Rank | Approach | Verdict | Why |
| --- | --- | --- | --- |
| 1 | **Diorama inside a 360° panorama** (`skybox`) | **Ship for the demo** | One extra image call. GMI `seedream-5.0-lite` makes a native 4096×2048 equirectangular panorama for $0.035 from the scene text; the takes in `shared-inputs/` read as real 360s with level horizons. Three.js renders it as background, image-based lighting and a `GroundedSkybox` floor you can stand on. Its harness held 60 FPS on a cloud iPhone with a 142k-triangle stand-in model, and MAX_TEXTURE_SIZE was 8192, so 4096×2048 fits. |
| 2 | **Depth-lifted panorama: splats or displaced mesh** (`splats`, `pano3d`) | **Stretch** | CPU depth (MoGe-2 on six cube faces of the panorama) turns the same panorama into a 0.72M-splat .spz (8 MB) in about 60 s per day on 4 CPU cores, at $0 beyond the panorama. Spark held about 60 FPS on the cloud iPhone from 0.25M to 8M splats (an upper bound; the device may be a simulator). You get look-around plus leaning or stepping about a metre with real parallax, not walking: nothing exists behind objects. |
| 3 | **Composite of separate assets** (`composite`) | **Stretch, true 3D blocked** | The renderer, procedural island layout and walk controls are built. True 3D objects need `hunyuan-3d-pro` (down) or fal; with one 3D job at a time the object count multiplies latency. The image-cutout variant works without 3D but reads as a paper diorama. |
| 4 | **Real-time world models** (`worldmodels`) | **Not yet** | Nothing on GMI qualifies; `Krea-Realtime-14B` has no movement controls. On fal, `robbyant/lingbot-world-2` and `alibaba/abot-world-0` cost $0.00125 per second ($0.075 per minute) over WebRTC. The guarded proxy, phone page and probes are built and mock-tested, but no live session has run because FAL_KEY is deferred. Nothing persists between sessions, so a world in the feed has to be re-imagined every visit. |

The demo pick is rank 1, upgraded to rank 2 if there's a day to spare. That holds as long as GMI or fal 3D comes back for the diorama itself. If 3D stays down, the panorama world alone (stand mode, with a cutout of the concept image as a centerpiece) is still a demo.

## Latency against the one-minute budget

GMI image latency was the surprise. `seedream-5.0-lite` took 38 to 167 s per image across 8 calls (concept 97 s, eye-level 38 s, panoramas 67 to 167 s; see `root-ledger.jsonl`). Run serially (scene, concept image, image-to-3D, panorama) that blows the one-minute budget, so the panorama call must start from the scene text in parallel with the concept-to-3D chain. It needs no reference image: the text-only take was the better 360 on both days. Then it adds no wall time as long as it finishes before the GLB.

## Files

- `shared-inputs/`: the base images every approach used, per day: concept diorama (2048²), eye-level (2560×1440), and two panorama takes (text-only, which is the pick, and eye-referenced). Full-resolution panorama JPEGs are included; the original PNGs are at the URLs in `inputs.json`.
- `scenes.json`: hand-written scene specs and every prompt, standing in for the scene writer.
- `inputs.json`: models, sizes, prompts, latencies and URLs for the shared inputs.
- `catalog/gmi-2026-11-15.md` and `catalog/fal-2026-11-15.md`: what each provider hosts for this problem, with prices. Per-model GMI JSON is in `spike/walkable/catalog/gmi-models/`.
- `root-ledger.jsonl`: every GMI call this thread made, with latency and estimated cost.
- Per-approach results: `spike/walkable/<approach>/RESULTS.md` and `research/walkable-worlds/<approach>/` on each `capy/walkable-<approach>` branch.

## Branches

| Branch | Contents |
| --- | --- |
| `capy/walkable-worlds-spike` | kit (budgeted GMI and fal runners), scene specs, shared inputs, catalogs, this recommendation |
| `capy/walkable-skybox` | panorama skybox prototype |
| `capy/walkable-pano3d` | panorama-to-depth-mesh prototype |
| `capy/walkable-splats` | Spark splat viewer, pano-to-splat CPU pipeline, iPhone benchmark |
| `capy/walkable-worldmodels` | guarded fal WMA proxy and phone page for real-time world models |
| `capy/walkable-composite` | walkable composite renderer and asset pipeline |

All six branches fork from `capy/google-apple-sign-in`, so they contain the shelved sign-in commit b8c47ca. Every spike change is confined to `spike/walkable/` and `research/walkable-worlds/`, so the easiest merge is `git checkout origin/<branch> -- spike/walkable research/walkable-worlds` onto a main-based branch.
