# Splats spike: how far Gaussian splats go on an iPhone

YCCO-10, approach **splats**. Branch `capy/walkable-splats`, everything lives in `spike/walkable/splats/`.

## Verdict: stretch

Rendering is ready and content is the stretch. On the Revyl cloud "iPhone 16" (Safari, 2026-11-15 20:41 to 20:58 UTC), Spark 2.4 drew 0.25M to 8M splats at about 60 fps and World Labs' real 500k exports at 53 to 60 fps. A 7.7 MB world showed its first sorted frame 2.4 s after the page started. The catch is that this phone may be an iOS Simulator on a Mac GPU, so a real phone's budget is Spark's documented 1 to 3M splats. Our default world has 0.72M splats, well inside that. Cloud phones went down before the day worlds reached the phone (DAN-20). WebKit with iPhone emulation loads and renders both day worlds with no console errors, and look, walk and tap all work there.

The splat source that fits today's limits (no GPU, no 3D model, about a minute) is this spike's CPU pipeline. It takes the shared GMI `seedream-5.0-lite` 4096×2048 pano, runs MoGe-2 depth on six cube faces on CPU, writes one Gaussian per pixel and saves a .spz. It takes about 60 s per day on 4 cores, costs $0 beyond the pano and gives 0.72M splats in 8 MB. What you get is a 360° photo bubble you can look around and lean or step about a metre inside. You can't walk across it, because there is nothing behind any object. A world you can really walk through means World Labs Marble at about $1.20 and 5 minutes per world, which isn't on GMI or fal and misses the one-minute target.

**Splat source named: GMI seedream pano → CPU MoGe-2 ViT-S depth → per-pixel surfel splats (`tools/pano-world.mjs`).**

## Phone results (Revyl cloud "iPhone 16", Safari, 2026-11-15 20:41 to 20:58 UTC)

The device reports UA `iPhone OS 18_7 … Version/27.0 Mobile Safari`, WebGL2 on "Apple GPU", 4 cores and a 393×852 screen at DPR 3. The page renders at DPR 2, so the drawing buffer is 786×1390 and max texture size is 8192. The only compressed-texture formats are ASTC and ETC (no S3TC). Every number below comes from the page's HUD, posted to `/stats` and kept in `stats.jsonl`.

**Treat FPS as an upper bound.** Holding 60 fps at 8M splats is far beyond what Spark itself budgets for an iPhone (1 to 3M). Revyl also once answered "Mach port not connected, device may not be ready yet", which is a simulator-style message. Against that, the phone exposed only ASTC and ETC textures, which is what real iPhone hardware exposes, so the page's own simulator check stayed quiet. Desktop WebKit, by contrast, exposes S3TC and trips that check. Load times, decode times and the fact that nothing crashed are still useful. If this is a simulator, GPU-bound frame rates on a real A18 will be lower.

### Splat count suite (run `s4`, `?bench=suite&set=synthetic&auto=1`, camera moving, 12 s window per step)

| Splats | FPS | Frame p95 | Sort (ms, 25/s) | Generate in page |
|---|---|---|---|---|
| 0.25M | 59.8 | 17 ms | 9 | 67 ms |
| 0.5M | 59.7 | 18 ms | 12 | 91 ms |
| 1M | 60.0 | 18 ms | 16 | 163 ms |
| 2M | 59.7 | 19 ms | 22 | 323 ms |
| 3M | 59.5 | 20 ms | 30 | 520 ms |
| 4M | 58.6 | 20 ms | 34 | 607 ms |
| 6M | 59.4 | 22 ms | 35 | 1,041 ms |
| 8M | 60.0 | 23 ms | 39 | 1,194 ms |

The suite reached `bench-done` with no crash and no lost WebGL context. Sort time grows with splat count (9 to 39 ms, in a worker), but sorting runs off the render thread, so frame time barely moves.

### Real content

| World | Bytes | Download | Decode + init | First sorted frame | FPS (30 s) | p95 |
|---|---|---|---|---|---|---|
| Marble cobblestone lane, 500k (`stats.jsonl` line 26) | 7.7 MB | 1.50 s | 0.15 s | 2.43 s after page start | 52.9 | 26 ms |
| Marble rustic kitchen, 500k (first session, HUD only) | 7.6 MB | 1.47 s | 0.20 s | about 5.8 s after navigation (cold vendor libs) | 57 to 60 | 18 ms |

The kitchen numbers are from the first phone session, whose `/stats` lines were lost when the machine was replaced. I read them off the HUD. The lane run had someone else tapping the page (another org user shared the phone slot), which accounts for the 15 frames over 50 ms in its 30 s window.

### Checks that still need a real iPhone

When the spike resumed at 21:00 UTC, waking the phone failed with "The organization does not have enough credits to start a phone". Each of these is **pending (phones down, DAN-20)**:

* Load and render both day worlds (`?day=hackathon`, `?day=santa-cruz`): download time, decode, first sorted frame, FPS, and whether memory pressure kills the tab.
* The real-content suite `?bench=suite&set=real&step=0&auto=1&run=r1`: Marble 2M with LoD off and on, then the day levels at 0.36M, 0.72M, 1.44M and 2.89M. It is wired up; read the `bench-result` lines in `stats.jsonl`.
* The synthetic suite on a physical iPhone, which settles the simulator question and gives a real splat budget.
* Drag-to-look and stick-to-walk with real fingers, plus pinch.
* The in-page MediaRecorder clip (`?rec=10`) on Safari.

Going by the measured tunnel throughput (about 5 MB/s), the 8.2 MB default world should download in about 1.6 s on the phone. That is an estimate, not a measurement.

### WebKit stand-in (software GL), not iPhone performance

`tools/webkit-check.mjs` runs Playwright 1.65.1 WebKit 27.2 with `devices["iPhone 15 Pro"]` against the local server. That means a 393×659 viewport, DPR 3, touch and an iPhone UA. The page renders at DPR 2, so the buffer is 786×1318. WebGL2 here is software-rendered on a 4-core VM, so the frame rate says nothing about a phone. Downloads came from localhost.

| World | Renders | Decode + init | First sorted frame (page clock) | Drag to look | Stick to walk | Touch tap on HUD button | Console errors | FPS |
|---|---|---|---|---|---|---|---|---|
| Hackathon 0.72M (8.2 MB) | yes | 0.32 s | 1.94 s | view changed (mean pixel diff 27.3/255) | moved (31.7/255) | toggled the HUD | none | 2 to 3 (software GL) |
| Santa Cruz 0.72M (7.6 MB) | yes | 0.36 s | 1.97 s | view changed (26.2/255) | moved (10.9/255) | toggled the HUD | none | 2 to 3 (software GL) |

One UI nit showed up: on a 393-pt-wide screen, the walk stick overlaps the world switcher buttons and the hint text. In the app, the WebView would show only the world and React Native would draw the controls.

## CPU pano → splat scene, both days

### Pipeline (`tools/pano-world.mjs --depth moge2-cpu`)

1. Cut the 4096×2048 GMI pano into six 768² cube faces with a 100° field of view, so neighbouring faces overlap.
2. Run MoGe-2 ViT-S (`Ruicheng/moge-2-vits-normal`, `tools/moge_faces.py`, torch 2.15 CPU, 4 threads) on each face to get metric range and a validity mask. The mask drops sky.
3. Align face scales by log-ratio least squares on the overlaps. A face with no overlap to the others is treated as sky (fixed this run; see Santa Cruz).
4. Fuse the faces into one equirect range map with edge feathering, then rescale the world so the camera sits 1.6 m above the floor under it.
5. Decimate rows equal-area, then place one flat Gaussian (surfel) per pixel. Its tangents point toward the neighbouring pixels (stretch capped at 6×), its thickness is 0.12× its smaller axis and its opacity is 0.98. Sky is a dome at 120 m.
6. Write SPZ v2 (gzip, SH0, 12 fractional bits) at four levels: 2896, 2048, 1448 and 1024 px wide.

### Numbers

| | Hackathon | Santa Cruz |
|---|---|---|
| Wall time, whole pipeline | 61.7 s | 60.1 s (first build); 113 s rebuild while a render shared the CPU |
| MoGe-2 on 6 faces | 46.0 s wall, 162.5 CPU-s, model load 0.5 s | 45.0 s wall, 158.7 CPU-s |
| Everything else | 13 s, half of it writing the 2.9M level | about the same |
| Peak RSS | 1.93 GB | 1.96 GB |
| Camera height from MoGe | 1.43 units → scale ×1.12 | 5.71 units → scale ×0.28 |
| Face scale spread | 0.72 to 1.21, 12 overlapping pairs | 0.75 to 1.47, 8 pairs; `up` had no overlap (sky) |
| Range in the world | 0.71 to 7.45 m | 1.44 to 114 m |
| Sky share / fallback splats at the 1448 level | 0% / 2.0% | 44% / 47% (sky splats count as fallback) |
| Level 2896 | 2,889,056 splats, 30.8 MB | 2,889,056, 28.7 MB |
| Level 2048 (`pano-hi`) | 1,444,466, 16.1 MB | 15.0 MB |
| **Level 1448 (`pano`, default)** | **722,134, 8.2 MB** | **7.6 MB** |
| Level 1024 (`pano-lo`) | 361,040, 4.2 MB | 3.9 MB |

The machine is a 4-core cloud VM. MoGe-2 on one 768² face takes about 7.5 s wall. On GPU the same model runs in well under a second per face. That's an expectation from the model's size; I didn't measure it.

### How it looks

* **Hackathon** reads well from the middle of the room. The curved window wall, the sunset skyline, the bean bags, the desks, the cans and the laptops all hold their shape. Near objects show surfel speckle along depth edges (desk rims, cans). Once you move away from the capture point, occlusion edges smear into stretched "curtains", because nothing exists behind them. The walk radius is capped at 1.2 m for that reason. Screenshots: `renders/YCCO-10/splats/hackathon-iphone-webkit.png` (iPhone emulation) and `hackathon-desktop.jpg`.
* **Santa Cruz** reads well too. You see breaking waves with surfers, the wharf with people and sea lions, a headland and clean sky. The first build had a bug: the sky straight overhead was painted on a dome 0.3 m above your head. The `up` face is pure sky, MoGe gave it a confident near depth, and it had no overlap to align against. The fix is in `pano-world.mjs`: a face with no depth overlap is sky, now a dome at 120 m. The metric scale is shaky, because the camera looks down from a height, so "1.6 m above the floor" shrinks everything by 0.28. Screenshots: `renders/YCCO-10/splats/santa-cruz-iphone-webkit.png` and `santa-cruz-iphone-webkit-look.png`.
* Range maps (white is near, black is sky): `renders/YCCO-10/splats/<day>-pano-range.png`.

## Splat sources we can't run today

* **Object splats from the concept image: blocked (GMI 3D down).** GMI's only 3D model is `hunyuan-3d-pro` (mesh, not splats), which was returning ResourceInsufficient and is paused in the kit. These fal endpoints would do it instead. All of them need `FAL_KEY`, which is deferred, and none has a CPU fallback:
  * `tripo3d/triposplat`: $0.05 per generation, up to 262,144 Gaussians, ply or splat output
  * `speridlabs/idol`: $0.10, 32k to 1M Gaussians
  * `fal-ai/sam-3/3d-objects`: $0.02 per object, a Gaussian-splat .ply
* **Scene from a pano or image on fal** (needs `FAL_KEY`):
  * `microsoft/moge-2` ($0.01/MP) and `microsoft/moge-3` ($0.015/MP, 1 MP minimum per call) are GPU versions of our depth step. At 6 calls per world that's about $0.06 to $0.09.
  * `fal-ai/hunyuan_world/image-to-world`: $0.30.
  * `fal-ai/vggt-1b`: $0.000975 per compute-second. This covers the video → multi-view-points stretch (a GMI `veo-3.1-lite` or `ltx-2-fast` clip, then VGGT), which I cut for time.
* **World Labs Marble** (the reference worlds in this spike):
  * Call: `POST https://api.worldlabs.ai/marble/v1/worlds:generate` with header `WLT-Api-Key`, then poll; about 5 minutes per world.
  * Price: 1,500 credits ($1.20) per world, 150 credits ($0.12) for a draft. $1 buys 1,250 credits.
  * Exports: SPZ at about 2M and 500k splats, a collider GLB and a 2560×1280 pano, in OpenCV axes (rotate 180° about X).
  * Spark is World Labs' own renderer. Marble isn't on GMI or fal; it needs its own key.
* **A GMI GPU** would let us host MoGe or an open splat model ourselves. On-demand GMI pricing starts at $2.60 per GPU-hour for H100, $3.20 for H200, $5.00 for B200 and $8.00 for GB200 (gmicloud.ai pricing, October 2026). I didn't set one up.

## Expo path

1. **Recommended: `react-native-webview` hosting this page** (Spark 2.4.0 and three 0.180.0, pinned). WKWebView is the same WebKit and WebGL2 as Safari, so the phone numbers above carry over. The app passes the world URL in and gets "loaded" or "exit" back over `postMessage`. Install it with `npx expo install react-native-webview`.
2. **Not `expo-gl`.** Spark sorts and decodes in Web Workers with WASM. Hermes has neither, and expo-gl's WebGL2 is partial.
3. **Later: native MetalSplatter** (Swift; reads SPZ natively; SH0 to SH3; iOS 18+) wrapped in an Expo module. That needs a dev build and is iOS only.

## Re-hosting

```bash
node spike/walkable/splats/fetch-assets.mjs   # pinned vendor libs + Marble reference worlds (about 50 MB), checked by sha256
node spike/walkable/splats/serve.mjs          # http://localhost:5103/?day=hackathon  (PORT defaults to 5103)
```

The two day worlds are the exception. There's no public bucket for this spike's own .spz files (no fal key, and GMI upload takes png/jpg/mp4 only), so the manifest lists them as `local: true` with their build command. `node spike/walkable/splats/fetch-assets.mjs --build` builds them in about a minute per day. That needs `npm install` in `spike/walkable/splats` and a Python venv. These are the versions installed here; I didn't re-run the install on a clean machine:

```bash
cd spike/walkable/splats && npm install
uv venv .venv --python 3.12
uv pip install --python .venv/bin/python torch==2.15.0 torchvision==0.29.2 --index-url https://download.pytorch.org/whl/cpu
uv pip install --python .venv/bin/python "git+https://github.com/microsoft/MoGe.git@74fbce054ebed49800de42d0ad0e83495065719a"
```

The venv is 2.4 GB and the model weights add 135 MB on first run. Crew threads can skip the build: copy `<day>-pano-1448.spz` from the captain drive (`renders/YCCO-10/splats/`) into `spike/walkable/splats/work/<day>-pano/`. The bytes and sha256 match the manifest.

WebKit stand-in check: `cd spike/walkable/splats && npx playwright install --with-deps webkit && node tools/webkit-check.mjs`. It writes `work/webkit/*.png` and `webkit-check.json`.

Page parameters:

* `day=hackathon|santa-cruz`, `src=pano|pano-hi|pano-lo|pano-max|marble|marble2m|marble-outdoor`, `file=<path under splats/>`, `lod=1`, `dpr=1|2|3`, `hud=0`, `mode=walk|orbit`
* `bench=suite&set=synthetic|real|dpr&step=0&auto=1&run=<tag>`
* `rec=10` (in-page clip; not tested on Safari)
* `offline=<frames>&fps=24&name=<n>` (deterministic frames posted to the server, for GPU-less video)

Controls: drag to look; the on-screen stick or WASD to move.

## Files

* In the repo, `research/walkable-worlds/splats/` (each file under 5 MB):
  * `hackathon-walk.mp4`: 4.2 s, 1280×632, 0.56 MB, a deterministic offline render in Chromium on SwiftShader. **WIP:** I stopped it at 101 of 168 frames for the wrap-up.
  * the WebKit iPhone-emulation screenshots and `webkit-check.json`
  * `hackathon-desktop.jpg`, the range maps, and both days' `*-pano-summary.json` with the build numbers
* Captain drive `renders/YCCO-10/splats/` holds the same media plus the larger files that stay out of git:
  * `hackathon-pano-1448.spz` (8.2 MB) and `santa-cruz-pano-1448.spz` (7.6 MB)
  * `REPORT.md`
  * `hackathon-walk.mp4` (deterministic offline render, Chromium on SwiftShader)
  * `hackathon-iphone-webkit.png`, `santa-cruz-iphone-webkit.png` and `santa-cruz-iphone-webkit-look.png` (WebKit, iPhone 15 Pro emulation)
  * `hackathon-desktop.jpg`
  * `<day>-pano-range.png`
  * `<day>-pano-1448.spz` (the default worlds, for other threads to load)
* Repo: `stats.jsonl` (every phone and browser session; WebKit runs carry `run=webkit` in the query, and their iPhone UA is emulated), `manifest.json`, `tools/pano-world.mjs`, `tools/moge_faces.py`, `tools/splatlib.mjs`, `tools/webkit-check.mjs`

## Unfinished (WIP at wrap-up)

* Every real-iPhone check above is **pending (phones down, DAN-20)**.
* The offline MP4 stopped at 101 of 168 frames. There's no Santa Cruz clip.
* The video → VGGT stretch was cut, and no GMI video was generated.
* The day worlds have no public URL, so re-hosting them takes `fetch-assets.mjs --build` (or the drive copies). A bucket or `FAL_KEY` would fix that.

## Cost

$0. This approach made no GMI or fal calls, and `spike/walkable/ledger/splats.jsonl` was never created. The shared pano inputs were paid for by the spike's inputs step. Compute was about 2 minutes of 4-core CPU for both days.
