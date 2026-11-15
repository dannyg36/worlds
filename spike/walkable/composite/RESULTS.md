# Composite walkable world: results (YCCO-10 spike)

Status: spike wrapped up early (team moving to Claude Code). Everything below was measured; unfinished items are listed at the end.

**Verdict.** The image-card composite (each object a generated cutout card with CPU depth relief, laid out procedurally on a procedural island under the shared panorama) is a **stretch** for the demo: it runs end to end in about 35 to 45 s for about $0.50 per world, downloads about 1.8 MB, and reads as "my day" from the front, but from the side it is a paper theater, and real-iPhone FPS is **pending (phones down, DAN-20)**. The true-3D composite (one image-to-3D mesh per object) is **not yet**: it is **blocked (GMI 3D down)**, and even when `hunyuan-3d-pro» works, one 3D job at a time makes a 6-object world take minutes, not a minute.

Is the composite the right walkable upgrade over a single diorama? Not as the primary demo look. A single diorama GLB is more cohesive; the composite's advantages are per-object control from the scene spec (layout, counts, reuse, collisions) and walkability at low cost. Demo the single diorama on the panorama, and offer the card composite as a "step inside" mode if a real iPhone holds 30+ fps.

## Run it

```bash
cd spike/walkable/composite && npm install && cd -   # pipeline deps only (sharp, gltf-transform, transformers.js)
node spike/walkable/composite/fetch-assets.mjs         # 32 files, 3.47 MB, from manifest.json (GMI storage URLs, sha256-checked)
node spike/walkable/composite/serve.mjs                # PORT=5105 by default; POST /stats appends to stats.jsonl
# open http://localhost:5105/?day=hackathon  or  ?day=santa-cruz
```

`fetch-assets.mjs» and `serve.mjs» use Node built-ins only. The page pins three.js r187 and three-mesh-bvh 0.9.18 through an import map on jsDelivr. URL options: `view=3p|1p|orbit», `cards=relief|flat|billboard», `q=low» (no shadows, DPR 1), `dpr=», `hud=off», `tour=1» (auto-walk), `capture=N» (deterministic 30 fps frame capture to `out/frames/», used for the MP4s).

## What GMI hosts for this approach (2026-11-15)

| need | GMI model | price (model card) | status today |
| --- | --- | --- | --- |
| object images | `seedream-4-0-250828» | $0.05 per image | used: 7.3 to 13.8 s per 1024² image |
| cheaper images | `Flux2-Klein», `Z-Image-Turbo» | 0.01 USD per request | `qworkers: 0», sat in queue for other threads; not used |
| object images | `seedream-5.0-lite» | $0.035 per image | 3.6 MP floor, 38 to 167 s today (root's numbers); not used for objects |
| background removal | `bria-image-remove-background» (RMBG 2.0) | $0.018 per image | used: 8.3 to 9.0 s, GMI queue 0.6 to 1.1 s |
| image to 3D | `hunyuan-3d-pro» | $0.375 per 3D model | **blocked (GMI 3D down)**: every submit returns `ResourceInsufficient»; the kit refuses 3D. I submitted none. |
| depth | none on GMI | | Depth Anything V2 Small on CPU instead (ONNX via transformers.js 4.3.2) |
| panorama | general image models only | | shared pano from root (`seedream-5.0-lite» 4096×2048) |

fal endpoints we'd use instead (prices from each llms.txt, 2026-11-15; nothing on fal was called): `fal-ai/hyper3d/rodin/v2.5/fast» $0.10 per generation (fast tier caps at 20K triangles); `fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d» $0.225 (+$0.15 with PBR); `fal-ai/trellis-2» $0.25 at 512p, $0.30 at 1024p, $0.35 at 1536p; older and cheaper `fal-ai/trellis» $0.02 and `fal-ai/hunyuan3d/v2/mini/turbo» $0.08 (white mesh). Images: `fal-ai/nano-banana-2» $0.08, `fal-ai/flux-2-pro» $0.03 per MP, `fal-ai/z-image/turbo» $0.005 per MP.

## Pipeline as run (cards)

1. Scene spec from `scenes.json» (objects, `size_m», `count», `place», palette, time of day, ground). One image per unique object; `person» is generated once and reused for all 4 slots (tinted per copy).
2. Object images: `seedream-4-0-250828» with `{"prompt": "<object prompt>. A single isolated object, front view at eye level, the whole object fully inside the frame with generous empty margin on every side, centered, on a plain flat pure white background, no ground, no floor, no cast shadow, no text. <style>.", "size": "1024x1024"}», all in parallel (`pipeline/build-world.mjs --images objects --view front --images-only»).
3. Background removal: `bria-image-remove-background» with `{"image": "<GMI image URL>"}», all in parallel (`pipeline/rmbg.mjs»). The free local flood-fill keyer (`pipeline/sheet.mjs») leaves white floor-shadow blobs, so RMBG is worth $0.018.
4. Cards (`pipeline/cards.mjs»): trim, 768 px max palette PNG; Depth Anything V2 Small (`onnx-community/depth-anything-v2-small», fp32, 4 CPU cores) normalized inside the alpha mask, extended past the silhouette, blurred, saved as a 192 px depth PNG; tabletop height (`top_frac», the widest alpha row) for "on table" placement. Uploaded with `kit/gmi.mjs upload» so the manifest has public URLs.
5. Panorama: shared pano re-encoded to 4096×2048 JPEG q82 (`pipeline/pano.mjs»): 10.3 MB PNG to 0.75 MB (hackathon), 11.5 MB to 0.86 MB (santa-cruz).
6. Renderer (`web/»): each card is a 72×72-segment plane displaced by its depth map (relief 28% of its short side, capped at 0.55 m), alpha-tested, double-sided, casting alpha-correct shadows; deterministic layout from `place» hints (center, on X, around X, near X, edge, backdrop, cliff path, cliff edge, over water, in water) with oriented-box overlap rejection; cards face the spawn point (paper-diorama look; `cards=billboard» turns them to the camera). Ground: indoor wood-plank disc and rug under a grounded panorama (`GroundedSkybox»); outdoor heightmap cliff, beach, path, instanced grass, flowers and rocks, animated water, panorama sky. Third person, first person and orbit views; virtual joystick (left half) plus drag-look (right half), WASD on desktop; collision against card footprints; ground following; HUD (FPS, frame time, GL info, draws, triangles, texture estimate, asset bytes, load times) posted to `/stats».

## Measurements

| | hackathon (indoor) | santa-cruz (outdoor) |
| --- | --- | --- |
| unique objects / placed | 8 / 11 | 7 / 13 |
| object images, parallel | 8 calls, 7.8 to 13.8 s each, wall 14.3 s, $0.40 | 7 calls, 7.8 to 8.6 s, wall 9.0 s, $0.35 |
| background removal, parallel | 8 calls, 8.5 to 9.0 s (queue 0.8 to 1.1 s, server 6 to 7 s), wall about 9 s, $0.144 | 7 calls, 8.3 to 8.6 s (queue 0.6 to 0.9 s), wall 8.8 s, $0.126 |
| cards + CPU depth (sequential) | 20.6 s (depth inference 0.34 to 1.84 s per object) | 17.7 s (0.49 to 1.97 s) |
| total wall, stages back to back | about 44 s | about 35.5 s |
| GMI cost per world | $0.544 | $0.476 |
| download to the phone | 1.81 MB (cards + depth 1.02 MB, pano 0.78 MB) | 1.83 MB (0.92 + 0.91 MB) |
| card textures | 8 PNGs, 346 to 768 px, 79 to 134 KB each | 7 PNGs, 428 to 768 px, 69 to 171 KB each |
| scene, no shadows (Chromium) | 18 draws, 115k triangles, 48k vertices | 21 to 22 draws, 114k to 124k triangles, 39k vertices |
| scene, shadows on (WebKit) | 32 to 35 draws, 187k to 202k triangles | 35 to 41 draws, 184k to 235k triangles |
| GPU texture estimate | 12 textures, about 63 MB (pano about 45 MB with mips) | 10 textures, about 58 MB |
| first frame, Chromium, localhost | 0.88 s | 1.01 s |
| first frame, WebKit iPhone 15 Pro emulation, localhost, software GL | 5.9 s (6.8 s from navigation) | 6.7 s (6.9 s) |

Not counted: the scene-writer LLM (YCCO-6 measured 1.2 to 2.6 s on GMI) and the shared panorama, which root generated with `seedream-5.0-lite» in 67 to 167 s. If a pano is made per world it is the long pole by far, two to four times the whole card pipeline.

Sprite sheet versus one image per object (hackathon, `seedream-4-0-250828»): the sheet (1 call, 2048², 3×3) took 12.5 to 12.7 s for $0.05; per-object (8 calls, 1024²) took a 14.1 to 14.3 s wall for $0.40. The sheet keeps one style but the model drew per-cell floors and shadows, so the auto-cropper fell back to grid cells for 5 of 8 (three-quarter view) and 7 of 8 (front view) cells, the window cell drew a whole room corner, and objects get about 680 px each. Per-object is the better input today; the sheet is 8× cheaper at the same latency and worth another prompt pass (explicit gutters) plus RMBG on the whole sheet before splitting.

## True-3D composite: blocked (GMI 3D down)

Built and dry-tested on sample GLBs: `pipeline/build-world.mjs» uploads each object image and submits one 3D job per object through the kit, then `pipeline/optimize.mjs» welds, simplifies to a size-based triangle budget (4k to 24k), downsizes textures (512 to 1024 px), encodes KTX2 (ETC1S, KTX-Software 4.4.2) and meshopt-compresses geometry; on Khronos samples that took 0.3 to 1.4 s per GLB and cut 0.4 to 10.6 MB files to 92 to 627 KB. The renderer loads those GLBs (meshopt and KTX2 decoders) with the same layout. `generate_type» LowPoly versus Normal and a low `face_count» were never testable because no 3D job ran.

Serial-time math, N = 6 unique objects per day (one person reused), images about 14 s, T3 = per-object 3D latency (never measured on GMI, so shown for 60, 120 and 180 s):

| 3D jobs in flight | wall time | T3 = 60 s | T3 = 120 s | T3 = 180 s |
| --- | --- | --- | --- | --- |
| 1 (our thread's share) | 14 s + N × T3 | 6.2 min | 12.2 min | 18.2 min |
| 3 (the account limit) | 14 s + ceil(N/3) × T3 | 2.2 min | 4.2 min | 6.2 min |
| N (all at once, as fal normally runs) | 14 s + T3 | 1.2 min | 2.2 min | 3.2 min |

3D cost per world: GMI 6 × $0.375 = $2.25; fal Rodin v2.5 fast $0.60; fal Hunyuan 3D v3.1 rapid $1.35; fal Trellis 2 at 512p $1.50. Only full parallelism gets near "about a minute".

## How it looks (honest)

From the spawn view it reads as the day. Hackathon: a long table of laptops with the monitor showing a little world, four cheering people behind and beside it, a sunset window behind, whiteboard and beanbag at the edges, pizza boxes on the floor, under a sunset office panorama. Santa-cruz: windswept cypresses, red bikes and a bench on the cliff path, sea lions on the wharf, surfers in the water, a chowder stand, under a sunny coast panorama. The relief adds a little parallax as you walk past, and real alpha shadows help ground the cards.

What breaks: it is a paper theater. From the side, cards go thin and the relief is a few centimeters of bulge with painted lighting; backs show the mirrored front; the four people are clones (tinted); scale cues fight (the table card includes its chairs); the object images' perspective doesn't match the panorama; the walkable area is a 6 to 8 m disc; the auto-tour walks into the window card at the end of the hackathon clip.

Media:
- In git, `research/walkable-worlds/composite/»: WebKit iPhone 15 Pro emulation screenshots before and after a walk and drag-look for both days, `santa-cruz-3p.png», `hackathon-orbit-side-view.png» (the paper-theater side view), `hackathon-objects-front-and-cutouts.png», `hackathon-sprite-sheet-front.png», and the per-run timing JSON.
- In Drive, `~/.capy/drive/captain-gurnoor-sandu/renders/YCCO-10/composite/»: `hackathon-tour-cards.mp4» (11 s, 2.6 MB) and `santa-cruz-tour-cards.mp4» (11 s, 4.2 MB), auto-walk tours captured frame by frame at 30 fps at 390×844, plus copies of the screenshots.

## Phone verdict

**Real iPhone: pending (phones down, DAN-20).** My cloud-iPhone attach at about 20:43 UTC queued behind four sessions holding every org phone slot, and every wake after that failed with "The organization does not have enough credits to start a phone". No real-iPhone numbers exist for this approach.

**WebKit (software GL), iPhone 15 Pro emulation** (Playwright WebKit, 393×659, DPR 3 capped to 2, shadows on, localhost): both days load and render with no console errors; first frame at 5.9 s (hackathon) and 6.7 s (santa-cruz); joystick walk and drag-look work (the avatar moves and the camera turns between screenshots). The HUD says "Apple GPU · WebGL2 · maxTex 16384" because WebKit masks the renderer string; this is CPU rendering on a GPU-less Linux box, so its 2 to 7 fps is not iPhone performance.

Still needs a real iPhone, each **pending (phones down, DAN-20)**: FPS and frame time at DPR 2 with shadows (20 to 40 draws and 115k to 235k triangles is light for an A16 or A17, but unmeasured); memory and tab stability with about 60 MB of textures plus PMREM (a 2048 px pano would halve it); joystick feel under a finger; Safari toolbar resizing; thermals over a few minutes.

## Path into the Expo SDK 58 app

Use **react-native-webview** for the demo: `web/» is plain ES modules with no build step, so bundle it with esbuild into one file (no import map or jsDelivr at runtime), load it from the app bundle, and inject the world JSON plus Convex storage URLs for cards and pano. **expo-gl with three** is possible later but needs polyfills for the canvas-2D textures and image decoding plus a port of the touch controls. Native (SceneKit or RealityKit) is out of scope for the hackathon.

## Unfinished

- Real-iPhone test: pending (phones down, DAN-20). The harness is ready: open the preview URL, the HUD and `/stats» log record FPS, frame time, GL info and load times.
- True-3D composite: blocked (GMI 3D down); LowPoly versus Normal and `face_count» untested.
- Sprite-sheet path stops at crops (no cards built from it); depth step runs sequentially on CPU (a worker pool would roughly halve it); no lower-resolution pano variant for phones.

## Spend

GMI, approach `composite»: about $1.54 of $10 over 41 calls (images and background removal only, no 3D): four rounds of hackathon object images while testing views and the sheet ($0.90), santa-cruz object images ($0.35), 16 background removals ($0.29).

## Files

- `fetch-assets.mjs», `serve.mjs», `manifest.json» (32 files, 3.47 MB), `worlds/<day>.json» (scene spec, card set, pano).
- `web/»: `index.html», `main.js» (loader, cards, GLBs, HUD, capture), `world.js» (palette, lights, ground, decor, layout), `controls.js» (joystick, drag-look, collision, cameras, tour), `hud.js» (perf, GL info, GPU estimate, in-page recorder).
- `pipeline/»: `build-world.mjs», `providers.mjs» (GMI and fal adapters), `rmbg.mjs», `cards.mjs», `depth.mjs», `pano.mjs», `sheet.mjs», `optimize.mjs», `optimize-set.mjs», `sample-assets.mjs», `worldfile.mjs».
- `runs/*.json»: per-run timelines and per-call timings.
