# Walkable worlds spike (YCCO-10): ranked recommendation

The question: how far past a single 3D diorama can we go toward a world you stand inside and look around on an iPhone? Five approaches were prototyped in parallel on 2026-11-15. Partway through, the provider moved from fal to GMI Cloud. GMI's only 3D model (`hunyuan-3d-pro`) then failed for the whole account with `ResourceInsufficient`, and cloud iPhones stopped starting at about 21:00 UTC (DAN-20). The cloud-iPhone numbers below come from before 21:00, on a device that may be a simulator, so treat its FPS as an upper bound. "WebKit" means Playwright WebKit with iPhone emulation and software GL, which shows the pages work but says nothing about phone FPS.

## Ranking

| Rank | Approach (branch) | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | **Diorama inside a 360° panorama** (`capy/walkable-skybox`) | **Ship for the demo, at orbit and table scale** | The GMI pipeline (`gpt-image-2.5-flare-generate` 2048×1024, then a `bria-genfill` seam fix, then a `bria-image-increase-resolution` 2× upscale) costs $0.088 and takes about 60 s of GMI time per world, and the phone downloads a 1.1–1.7 MB JPEG. The seam fix takes the seam ratio from 7.76 and 3.03 down to 0.90 and 0.88. The upscaler isn't wrap-aware and pushes it back to 2.46 and 1.65. The viewer held 60 FPS on the cloud iPhone with a heavier placeholder scene (142k triangles). Life size needs a real day GLB, which is **blocked (GMI 3D down)**. |
| 2 | **Depth-lifted panorama** (`capy/walkable-pano3d` mesh, `capy/walkable-splats` splats) | **Stretch** | Real parallax for 0.5 to 1 m of movement; the mesh tears at about 1.4 m. You can look around and lean, but not walk across, because nothing exists behind objects. Depth on CPU is the bottleneck: MoGe-2 on 14 crops takes 5 to 9 min per world, and MoGe-2 on 6 cube faces takes about 60 s per world (0.72M splats, 8 MB .spz). On the cloud iPhone, a 1.3M-triangle mesh ran at 60 FPS and Spark held about 60 FPS from 0.25M to 8M splats. |
| 3 | **Composite of separate assets** (`capy/walkable-composite`) | **Image cards: stretch, as a "step inside" mode. True 3D: not yet (blocked)** | Each card world took 35 to 44 s and $0.48 to $0.54, with a 1.8 MB download. It reads as the day from the front and as a paper theater from the side. A true-3D composite of 6 objects takes 6 to 18 min with one 3D job at a time, or 2 to 6 min with three; fal would cost $0.60 to $1.50 per world. |
| 4 | **Real-time world models** (`capy/walkable-worldmodels`) | **Live: not yet. GMI branching video walk: teaser only** | GMI has no interactive world model. `Krea-Realtime-14B` is an async job, and the one probe sat queued for more than 11 minutes. On fal, `robbyant/lingbot-world-2` costs $0.075 per minute; its client and guarded proxy are built and mock-tested on the cloud iPhone but have never run live, because FAL_KEY is deferred. The branching walk (Hailuo-2.3-Fast or wan3.0 at 480p) takes 57 to 112 s and about $0.60 per three-move node, and it feels like choosing between short films. As a GPU option, Matrix-Game 2.0 on a GMI H100 at $2.00 to $2.60 per hour works out to about $0.033 to $0.043 per user-minute. |

The recommendation for the demo is rank 1. Upgrade it to rank 2 if a hosted depth model becomes available, for example fal `microsoft/moge-2` at $0.01 per megapixel. If 3D stays down, rank 1 still demos, with a cutout card of the concept image on a pedestal in place of the GLB.

## Latency against the one-minute budget

GMI image latency varies widely. `seedream-5.0-lite` took 38 to 167 s per image and `gpt-image-2.5-flare` took 21 to 25 s. `Flux2-Klein`, `Flux2-Dev` and `Qwen-Image-2512` never finished; GMI reports `qworkers: 0` for them, meaning no warm workers. The panorama chain needs only the scene text, so it should start right after the scene writer, in parallel with the concept-image-to-3D chain. Then it adds no wall time as long as the GLB takes longer.

## Files in this folder

- `REPORT.md`: the handoff: what works, what's unfinished, how to run it, what's blocked, and the next three steps.
- `shared-inputs/`: the base images every approach used, per day: concept diorama, eye-level image, and the two seedream panorama takes. The final seam-fixed panoramas are in `research/walkable-worlds/skybox/` on the skybox branch.
- `scenes.json`: the hand-written scene specs and every prompt. `inputs.json`: models, sizes, latencies and URLs for the shared inputs.
- `catalog/`: what GMI and fal host for this problem, with prices (snapshot from 2026-11-15).
- `root-ledger.jsonl`: every GMI call the root thread made.
- Each approach branch has `spike/walkable/<approach>/RESULTS.md` and `research/walkable-worlds/<approach>/`.

## Merging

All six branches fork from `capy/google-apple-sign-in`, so they contain the shelved sign-in commit b8c47ca. Every spike change is confined to `spike/walkable/` and `research/walkable-worlds/`, so the clean way onto a main-based branch is `git checkout origin/<branch> -- spike/walkable research/walkable-worlds`, once per branch. Of the shared files, `spike/walkable/kit/`, `scenes.json`, `inputs.json` and `catalog/` are newest on `capy/walkable-worlds-spike`.
