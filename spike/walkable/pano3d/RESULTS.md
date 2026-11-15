# pano3d: panorama to a depth mesh you can stand inside (WIP)

**Verdict: stretch.** A fused-depth displaced sphere built from the shared GMI panorama gives real parallax indoors and rendered at a steady 60 fps on a cloud iPhone (same 1.3M-triangle mesh, sample day), for about 1.8 MB per world. It holds for roughly 0.5 to 1 m of movement; at about 1.4 m toward close objects it tears (stretched edges, a smeared colour fill behind objects, floating cans). MoGe-2 on this 4-core CPU takes 5 to 9 minutes per world, so the one-minute budget needs a GPU or hosted depth; Depth Anything V2 on CPU fits (about 16 s total) but is noisier and tears more outdoors. The panorama itself took 67 to 167 s on GMI, which already exceeds the budget.

## What works, what is unfinished
- Works: `pipeline.mjs` (pano to 14 perspective crops, CPU depth per crop, scale-aligned fusion into a 1024x512 equirect distance map, foreground mesh with discontinuity cuts, a dilated background layer with push-pull colour fill, walk grid, PNG-packed depth, publish to GMI storage); the three.js viewer (`web/`) with drag-look, joystick, floor height from depth, clamped walk radius, a 3D/Pano toggle, a "2 steps" button, a mode switcher (MoGe-2 x14, DA2 x14, DA2 one-shot), HUD, and `POST /stats`; `capture.mjs` (deterministic headless MP4).
- Unfinished (WIP): santa-cruz MoGe-2 (12 of 14 crops when the wrap-up came, so santa-cruz only has the two DA2 modes); santa-cruz assets are not uploaded yet (`fetch-assets` has hackathon only; run `node pipeline.mjs publish --day santa-cruz`); WebKit emulation test (installed, not run); the MoGe-3 single eye-image comparison; the GLB export was only tried on the synthetic sample (4.6 MB with meshopt).
- Blocked: HunyuanWorld (`fal-ai/hunyuan_world/image-to-world`, $0.30/request) needs fal or a GMI GPU deployment (H100 from $2.60/GPU-hour, H200 from $3.20/GPU-hour per gmicloud.ai/en/pricing); not run. This approach needs no 3D model, so nothing here is blocked on GMI 3D.

## Run it
```bash
node spike/walkable/pano3d/fetch-assets.mjs     # hackathon assets from manifest.json (GMI-hosted URLs)
node spike/walkable/pano3d/serve.mjs            # http://localhost:5102/?day=hackathon  (PORT env overrides)
```
URL params: `day`, `mode=depth|da2f|da2e`, `view=pano`, `pos=x,z`, `yaw`, `pitch`, `radius`, `hud=0`, `auto=demo`.
Rebuild a day (CPU only, no paid calls): `npm install` in this folder; a Python venv with torch (CPU), `git+https://github.com/microsoft/MoGe.git` and transformers; then `node pipeline.mjs prep --day D --pano <url> && node pipeline.mjs views --day D --no-upload && python local_moge.py out/D && python local_da2.py out/D --scene indoor && python local_da2.py out/D --scene indoor --equirect && node pipeline.mjs fuse --day D && node pipeline.mjs fuse --day D --src da2 && node pipeline.mjs da2eq --day D && node pipeline.mjs publish --day D`.

## What GMI and fal host for this
- GMI (catalog 2026-11-15): no depth, panorama-to-3D, splat or world models; the only 3D model is hunyuan-3d-pro (down, and not needed here). Uploads through `kit/gmi.mjs upload` work for .png and .jpeg but fail for .jpg (HTTP 403 SignatureDoesNotMatch); `publish` uploads JPEGs as .jpeg.
- fal (not run, no key): `microsoft/moge-3` $0.015/MP (14 crops at 992x992 is about $0.21 per world), `microsoft/moge-2` $0.01/MP (about $0.14), `fal-ai/image-preprocessors/depth-anything/v2` $0 per compute second, `fal-ai/marigold-v2` $0.03/image, `fal-ai/hunyuan_world/image-to-world` $0.30 (output schema vague: `world_file`, example content type image/png).

## Pipeline as run (both days, shared `pano` from inputs.json: seedream-5.0-lite 4096x2048 PNG, 10.7 and 12.0 MB)
1. Re-encode to pano.jpg 4096x2048 (q88 mozjpeg, 1.02 / 1.16 MB).
2. 14 perspective crops, 992x992, 100° FOV: 8 around the horizon, 4 at -55°, zenith, nadir (split 1.9 to 2.1 s).
3. Depth per crop on CPU (4 threads): MoGe-2 ViT-L normal (`Ruicheng/moge-2-vitl-normal`, resolution_level 9, fov_x 100) and Depth Anything V2 Metric Small (indoor or outdoor checkpoint); plus DA2 one-shot on the 1024x512 equirect.
4. Fusion: per-pixel weighted blend of overlapping crops after solving per-crop log-scale offsets from 66 overlap pairs; metric scale set so the camera stands 1.6 m above the floor measured below 65° down; far cap 25 m.
5. Mesh in the browser: 1024x512 grid (526,850 vertices, about 1.05M triangles), triangles cut where the surface is near-parallel to the view ray (86°); background layer 512x256 (263k triangles) from a 40 px max-filtered depth plus push-pull inpainted colour; cut triangles are drawn only when standing at the capture point.

## Measurements
| day | method | depth CPU s (per crop) | split + fuse + post s | overlap residual | depth range m | far px | download MB (pano + depth + bg + bgdepth) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| hackathon | MoGe-2 ViT-L x14 crops | 329.4 (36.61) | 1.9 + 1.4 + 2 | 4.2% | 0.78-8.0 | 0% | 1.81 (1.02 + 0.63 + 0.04 + 0.12) |
| hackathon | DA2 metric-S x14 crops | 10.3 (0.74) | 1.9 + 1.3 + 2.2 | 4.13% | 1.03-6.2 | 0% | 1.88 (1.02 + 0.69 + 0.05 + 0.13) |
| hackathon | DA2 metric-S one-shot equirect | 6.1 | 0 + 0 + 2 | n/a | 1.39-6.7 | n/a | 1.93 (1.02 + 0.74 + 0.05 + 0.13) |
| santa-cruz | DA2 metric-S x14 crops | 48.3 (3.45) | 2.1 + 1.1 + 1.3 | 15.4% | 1.42-27.3 | 0% | 2.02 (1.16 + 0.70 + 0.03 + 0.13) |
| santa-cruz | DA2 metric-S one-shot equirect | 5.6 | 0 + 0 + 1.4 | n/a | 1.33-18.2 | n/a | 2.05 (1.16 + 0.74 + 0.02 + 0.12) |

- MoGe-2 CPU per crop: 23.2 s uncontended (sample day, 324 s for 14 plus 4 s load); 31 to 41 s when sharing the CPU (hackathon, 9 timed crops, 36.6 s average). GPU estimate, not measured: about 0.1 to 0.2 s per crop on an H100, so 2 to 3 s for 14 crops warm.
- DA2 Metric Small CPU: 0.74 s per crop on hackathon (10.3 s for 14); 3.45 s per crop on santa-cruz while Chromium was rendering on the same CPU. One-shot equirect: 5.6 to 6.1 s.
- Raw camera height before rescaling: MoGe-2 1.27 m (close to true), DA2 crops 2.82 m (scale off by about 1.8x indoors). Overlap residual after alignment: about 4% for both indoors, 15% for DA2 outdoors.
- Download per world (MoGe mode): 1.81 MB (pano.jpg 1.02, depth.png 0.63, bg.jpg 0.04, bgdepth.png 0.12) plus three.js r187 from jsDelivr.

## How it looks (honest)
- Hackathon, MoGe-2: from the centre it is the panorama. Two steps toward the table give convincing parallax for the laptops and cans against the window, but at 1.4 m the cut edges show: a beige smear behind the monitor and laptop where the background fill is a blur, jagged silhouettes, and the near can floating. Images: research/walkable-worlds/pano3d/hackathon-moge2-t2.9.jpg (start), -t5.0.jpg (after 1.4 m), -t10.0.jpg (plain-pano toggle), -t13.0.jpg.
- DA2 crops look similar indoors but with wrong absolute scale and mushier edges; DA2 one-shot on the equirect bends straight walls near the poles. Outdoors (santa-cruz, DA2 only) the wharf tears badly at 1.4 m and the sky shows a seam between crops.
- Depth maps: research/walkable-worlds/pano3d/*-depth-*.png. Default walk radius is now 1.25 m (was 2.5).

## Phone verdict
- Real cloud iPhone (Revyl, 20:48 to 20:50 UTC, synthetic sample day with the identical 1024x512 mesh, 1.31M triangles, 2 draw calls): 60 fps steady, frame 16.7 ms average, p95 17 to 19 ms, spikes to 94 to 110 ms on toggles; canvas 880x1592 (DPR 3 capped at 2); WebGL 2, "Apple GPU", max texture 8192; first frame 4.1 s after navigation (mesh build 226 ms, pano decode 106 ms). UA iOS 18.7 / Safari 27; the platform did not report the model and it may be a simulator, so FPS is indicative. Drag-look, joystick, the scripted two steps and the 3D/Pano toggle all worked.
- **Pending (phones down, DAN-20):** hackathon and santa-cruz on a real iPhone (FPS, memory, crashes), control feel on the real worlds, an on-device recording. WebKit (software GL) emulation was installed but not run.

## Path into the Expo SDK 58 app
Host this page in react-native-webview (WKWebView has WebGL 2; zero native work; postMessage for world id and controls), with assets per world: pano.jpg, depth.png, bg.jpg, bgdepth.png. expo-gl with three is the next step if the WebView is too heavy; it needs the depth as a raw binary instead of a PNG. A server-baked GLB (`pipeline.mjs glb`) works with any GLTF viewer but is larger (4.6 MB) than the 1.8 MB of textures plus depth.

## Renders
- Drive: renders/YCCO-10/pano3d/hackathon-moge2-demo.mp4 (3.1 MB, 17 s deterministic headless capture at 390x844 @2x: look, two steps, strafe, toggle to plain panorama and back) and the four stills.
- Repo: research/walkable-worlds/pano3d/.

## Spend
GMI: $0.000 (0 paid calls; only free storage uploads). fal: none.
