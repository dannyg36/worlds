# Skybox approach: a 360° panorama around the day's diorama

**Verdict: ship it as the backdrop, at orbit and table scale. Life size is not ready yet.**

A seam-fixed 4K equirectangular panorama behind the day's diorama is cheap and fast. It costs about $0.09 and about 60 s of GMI time per world, and the phone downloads 1.1–1.7 MB for it. It reads as "your day happened here" when you orbit the diorama or stand next to it on a pedestal.

Life size doesn't work yet, for two reasons:

- It needs a real 3D model of the day. That is **blocked (GMI 3D down)**.
- A cutout of the concept image becomes a giant flat poster at that scale.

The real-iPhone run with the final assets is **pending (phones down, DAN-20)**. Earlier today the cloud iPhone ran this viewer with a heavier placeholder scene, a 142k-triangle GLB, at a steady 60 FPS.

Live preview (this machine, until 2026-11-16 20:45 UTC): https://5101-cs92xsqt7cu9lferd7mov6lqdsri3n5h.capysandbox.net
To run it anywhere, start from the repo root:

```bash
node spike/walkable/skybox/fetch-assets.mjs   # downloads every manifest URL into skybox/assets/ (13 files, 15.0 MB)
node spike/walkable/skybox/serve.mjs          # http://localhost:5101  (?day=santa-cruz, ?mode=stand&scale=life, ?pano=<id>, ?dio=glb)
```

The re-host check passed. Running `fetch-assets.mjs` in an empty folder downloaded all 13 assets from their URLs: 10 panoramas, 2 cutout cards and the sample GLB.

## What I ran (GMI Cloud, 2026-11-15)

Every paid call went through `kit/gmi.mjs` and is logged in `ledger/skybox.jsonl`. Skybox spend is **~$0.332 of the $5 cap**. That includes six requests whose ids were lost when this machine slept mid-poll; I logged them at their estimated price. The two seedream panoramas were already paid for by the root, in `inputs.json`.

| Method | GMI model | Price | Output | Latency (wall / GMI server) | Result |
| --- | --- | --- | --- | --- | --- |
| Text, root's pick | `seedream-5.0-lite` (root) | $0.035 | 4096×2048 | 166.8 s (hackathon), 67.1 s (santa-cruz) | ok |
| Eye-image referenced | `seedream-5.0-lite` (root) | $0.035 | 4096×2048 | 79.6 s, 104.9 s | ok |
| Text, control | `gpt-image-2.5-flare-generate`, quality medium, size 2048x1024 | $0.028 (token priced; medium 1024² = $0.0132, scales with pixels) | 2048×1024 | 24.5 s / 24 s, 20.9 s / 21 s | ok, **winner** |
| Seam fix on the GPT pano | `bria-genfill` (image + mask + panorama prompt) | $0.04 | 2048×1024 | 25.8 s, 25.8 s (queue 0.7 s) | ok |
| 2x upscale of the seam-fixed pano | `bria-image-increase-resolution`, desired_increase 2 | $0.02 | 4096×2048 | 8.7 s, 8.4 s (queue 0.7–1.0 s) | ok |
| Diorama stand-in | `bria-image-remove-background` on the concept image | $0.018 | 2048×2048 RGBA | 9.7 s / 7 s, 10.3 s / 7 s | ok |
| Outpaint the eye image | `wan2.7-image` (green 2:1 canvas, size 2K) | $0.03 | — | 0.4–1.4 s | **failed**: every POST returned HTTP 500 `{"error":"Backend error (403). Please try again."}`. I tried 4 times with a URL, a URL array and a base64 data URI. Nothing was charged. |
| Text | `Flux2-Klein`, `Flux2-Dev`, `Qwen-Image-2512` | $0.01 each | — | see below | **never finished**. Six requests submitted at 20:54 UTC were lost when the machine slept around 20:57. Six more, submitted at 21:02 UTC, were still `queued` when the kit's 15-minute timeout hit at 21:17; their ids are in the ledger. The schema shows `qworkers: 0`, meaning no warm workers. They may still run, and bill, on GMI. |

Other GMI facts that matter for this approach:

- Klein and Flux2-Dev cap width and height at 1024, so the best they can produce is 1024×512. That is a quarter of the pixels we need.
- Qwen-Image-2512 goes up to 2512 px.
- `hy-image-v3.5-preview` and `gemini-nano-banana-2.1` have no 2:1 size.
- `luma-uni-1.1` ($0.04, 2:1) and `reve-2-1` (~$0.20, 2:1) exist, but I didn't run them.
- The whole catalog is in `catalog/gmi-2026-11-15.md`.
- fal endpoints and prices for the same steps are in `notes-fal.md`. No fal calls were made.

## Panorama comparison (seam and pole scores)

`tools/pano.py metrics` computes two scores. `seam_ratio` is the mean difference between the left and right edge columns divided by the median difference between neighboring columns. A value of 1.0 means you can't find the seam; anything above about 2 is visible as a cut in the "back" view. `pole_detail` is the gradient energy in the top and bottom rows relative to the horizon band, and higher values mean more pinching or smearing at the poles. Both are measured on the source PNGs. Contact sheets show the 2:1 image plus front, right, back (seam), left, up and down views.

| Day | Method | Size | seam_ratio | pole detail top / bottom | JPEG sent to phone |
| --- | --- | --- | --- | --- | --- |
| hackathon | seedream text | 4096×2048 | 4.76 | 0.08 / 0.31 | 0.88 MB |
| hackathon | seedream eye-ref | 4096×2048 | 4.62 | 0.11 / 0.14 | 1.00 MB |
| hackathon | gpt-image-2.5 flare | 2048×1024 | 7.76 | 0.08 / 0.09 | 0.38 MB |
| hackathon | + seam fix | 2048×1024 | **0.90** | 0.05 / 0.06 | 0.39 MB |
| hackathon | + seam fix + 2x upscale (default) | 4096×2048 | 2.46 | — | 1.06 MB |
| santa-cruz | seedream text | 4096×2048 | 11.08 | 0.13 / 0.38 | 1.14 MB |
| santa-cruz | seedream eye-ref | 4096×2048 | 6.83 | 0.07 / 0.10 | 0.95 MB |
| santa-cruz | gpt-image-2.5 flare | 2048×1024 | 3.03 | 0.03 / 0.08 | 0.57 MB |
| santa-cruz | + seam fix | 2048×1024 | **0.88** | 0.02 / 0.06 | 0.57 MB |
| santa-cruz | + seam fix + 2x upscale (default) | 4096×2048 | 1.65 | — | 1.66 MB |

Every generator leaves a visible seam (ratio 3–11), even when the prompt asks for seamless edges. The genfill pass brings both days below 1.0, and in the contact sheets the santa-cruz tree and path now run straight through the back view.

The Bria upscaler isn't wrap-aware, so it pushes the ratio back up to 1.7–2.5. The absolute edge difference only goes from 3.4 to 5.8 gray levels, so this is hard to see, but the right order is upscale first, then seam fix at 4K. I didn't test that order.

## Pipeline (the winner, exact parameters)

1. `gpt-image-2.5-flare-generate` with `{ prompt: scenes.json panorama_prompt + SEAMLESS suffix (see gen.mjs), size: "2048x1024", quality: "medium", output_format: "png", n: 1 }` takes about 21–25 s and costs $0.028. Never send `quality: "auto"`, because GMI bills it at the max tier.
2. `pano.py roll <pano> rolled.jpeg --mask seam-mask.png --band 160` rotates the panorama by half its width, which moves the seam to the center, and masks a 160 px band there. Both files go up through `gmi.mjs upload`.
3. `bria-genfill` with `{ image: rolled, mask, prompt: panorama_prompt }` takes about 26 s and costs $0.04. Then `pano.py roll` rotates the result back.
4. `bria-image-increase-resolution` with `{ image, desired_increase: 2 }` takes about 8.5 s, costs $0.02 and outputs 4096×2048.
5. `ffmpeg -q:v 4` converts it to a 1.1–1.7 MB JPEG, which is uploaded and stored as a URL in `manifest.json`.
6. Stand-in for the diorama: `bria-image-remove-background` on the concept image (10 s, $0.018). `pano.py cutout` then crops it to the alpha bounding box and resizes the long side to 1024 px, giving a 1.0–1.2 MB PNG. The viewer shows it as a camera-facing card (2 triangles) on the floor or on the pedestal.

Total: **$0.088 for the panorama plus $0.018 for the card**, about 60 s of serial GMI time plus 3 uploads of 1–2 s each. Run with `gen.mjs run <day>:gpt`, `<day>:seamfix:gpt`, `<day>:upscale:seamfix-gpt` and `<day>:cutout`, plus `publish` and `card` (usage is at the top of `gen.mjs`).

## How it looks (honest)

Renders are committed in `research/walkable-worlds/skybox/`, and the same files are in Drive at `renders/YCCO-10/skybox/` (`~/.capy/drive/captain-gurnoor-sandu/renders/YCCO-10/skybox/`):

- `hackathon-orbit-hud.png`, `hackathon-stand-table.png` and `santa-cruz-orbit.png`: Chrome on this machine at 440×956 @2.
- `webkit-*-{orbit,stand-table,stand-life}.png`: WebKit with iPhone 15 Pro emulation.
- `sheet-<day>-<method>.jpg`: the eight contact sheets.
- `<day>-pano-final-4k.jpg`: the two final panoramas.
- `santa-cruz-tour-chrome.mp4`: 13.8 s, 440×956, H.264, 1.7 MB, recorded in-page by `?tour=1&rec=14` and transcoded with `libx264 -pix_fmt yuv420p`. It was recorded in software-GL Chrome at about 22 fps, so it is not phone footage.

**GPT-image-2.5 flare is the best looking panorama.** The rooms are lived-in, with people, beanbags, pizza and whiteboards. The equirectangular curvature is right, the ceiling and sky poles are believable, and the visible sun gives the viewer's sun finder a clean light direction for the diorama's shadow. It has three costs:

- It paints text (signs, T-shirts), and the genfill band garbles any text crossing the seam: "Hack Build Ship" became "ack uild chip". Add "no text, no signage" to the prompt.
- The people in the panorama compete with the diorama's own characters.
- It only generates 2K, so it needs the upscale.

**Seedream text is the root's pick and the cheapest 4K option.** The lines are clean, but the hackathon room is sterile, the santa-cruz seam is the worst of the set (a tree cut in half behind you), and latency ranged from 67 to 167 s.

**The seedream eye-referenced take** matches the eye image best but looks like a flat wide-angle photo stretched to 2:1, and the santa-cruz sky pole has a hard vertical join.

**The grounded floor is the weak spot of any single panorama.** `GroundedSkybox` projects the lower hemisphere onto a flat floor, so the meter around your feet is a smeared, low-resolution projection: chairs and backpacks streak in the orbit shots. On the outdoor cliff the ocean below gets projected onto the flat ground, so in stand mode the pedestal looks like it stands in the sea. A per-day `pano_height`, depth from a depth model (the pano3d approach), or a prompt that puts the camera on flat ground would fix this. None of those is done here.

**The concept cutout card works at orbit and table scale.** It always faces you and the concept art is good. At life size it is a flat 12–16 m poster towering over you, and the santa-cruz card has a white fog puff that background removal kept as an opaque blob.

## Table size vs life size

- **Table** (the 0.85 m diorama on a 0.8 m pedestal, 2.3 m in front of you, eye height 1.6 m) is the one to ship. It reads as "a model of my day, in the place where it happened", it works with the card or a GLB, and it hides the panorama's weak floor because you look at the pedestal, not your feet.
- **Life** (the island scaled to 2 × `island_radius_m` = 12 m for hackathon and 16 m for santa-cruz, top surface at the floor) only makes sense with a real day GLB. With the card it breaks, as described above. With the sample GLB the cloud iPhone held 60 FPS earlier, but at that scale texel density runs out quickly. A day-specific life-size GLB is **blocked (GMI 3D down)**. The fal endpoint we'd use is `fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d` ($0.225 per generation, +$0.15 for PBR; GLB out), or `fal-ai/trellis-2` ($0.25–0.35 by texture size). Both are in `catalog/fal-2026-11-15.md`.

## Phone verdict

**Real iPhone with the final assets: pending (phones down, DAN-20).** Cloud phones currently fail with "The organization does not have enough credits to start a phone". These checks still need a real iPhone:

- FPS in orbit, stand/table and stand/life with the 4K seam-fixed panorama and the card on both days: **pending (phones down, DAN-20)**
- Cold and warm TTFF over cellular-like latency with 2.1–2.9 MB of assets: **pending (phones down, DAN-20)**
- Gyro look on a physical device. The cloud iPhone granted permission but delivered 0 `deviceorientation` events, which suggests a simulator: **pending (phones down, DAN-20)**
- Memory headroom with the 4K panorama in Safari and in a WKWebView: **pending (phones down, DAN-20)**

**Cloud iPhone with placeholder assets** (2026-11-15, about 20:30–20:44 UTC, evidence in `phone/placeholder-stats.jsonl`):

- Device: iPhone OS 18_7, Safari 27.0, screen 440×956 @3, "Apple GPU", WebGL 2.0, MAX_TEXTURE_SIZE 8192.
- Scene: a 2K Poly Haven panorama, plus the 142k-triangle LittlestTokyo GLB with shadows at DPR 2 (880×1592). That is heavier than the final scene, which is a 4K panorama plus a 2-triangle card.
- Frame rate: a steady **60 FPS** (16.7 ms average, p95 18 ms) in orbit, stand/table and stand/life, at about 153 draw calls and 320k triangles.
- Cold load: TTFF 15.1 s. Most of that was the first render (10.5 s of shader compile and upload); the pano fetch took 0.77 s, PMREM 2.24 s and the GLB fetch 3.1 s.
- Warm reload: TTFF 1.8 s.
- Controls: drag look, joystick, mode buttons and the gyro permission prompt all worked.

**WebKit (software GL)** used Playwright 1.65.1 WebKit with `devices['iPhone 15 Pro']` emulation (393×659 @3, touch on) against the local server. Results are in `phone/webkit-iphone15pro-emulation.json`, and `tools/webkit-check.mjs` reruns it (it needs `npm i playwright && npx playwright install --with-deps webkit`). Because it renders in software on a CPU-only machine, its FPS (3–8) is **not** phone FPS. It shows that the page works under WebKit:

- It rendered on both days with **0 console errors**.
- TTFF was 1.74 s (hackathon) and 0.73 s (santa-cruz) from localhost.
- The pano took 10–18 ms to decode and PMREM took 0.23–0.71 s.
- Tapping Stand and Life switched modes, drag-look changed the view, and holding the joystick moved the player.
- The estimated GPU memory was about 91 MB.

**What goes to the phone:** a 1.06 MB (hackathon) or 1.66 MB (santa-cruz) JPEG panorama, a 1.04 or 1.19 MB PNG card, and three.js 0.187 from jsDelivr. The textures are a 4096×2048 sRGB panorama with mipmaps (about 45 MB of GPU memory), a PMREM generated from a 1024×512 downscale, and the card at 891×1024 or 1001×1024. With the sample GLB instead of the card (`?dio=glb`), add 4.13 MB and 142k triangles.

**Path into Expo SDK 58.** Wrapping this exact page in `react-native-webview` is the fastest route. A WKWebView uses the same WebKit and WebGL as Safari, so the iPhone numbers above should carry over, and assets stay plain URLs. For gyro I would pass `expo-sensors` DeviceMotion into the page with postMessage instead of relying on the web permission prompt inside a WebView; that is untested. `expo-gl` with three.js is possible but means replacing the DOM pieces: the 2D canvas used for panorama analysis, `TextureLoader`, and `MediaRecorder`. A native renderer isn't worth it for a hackathon.

## Is 4K needed?

Yes for stand mode, and 8K isn't worth it. In stand mode the camera's vertical FOV is 70°, and a portrait canvas at DPR 2 shows about 25 screen pixels per degree. A 2K panorama has 5.7 px per degree and a 4K one has 11.4, so 2K is visibly soft at about 4.3× magnification and 4K is acceptable at about 2.2×. 8K would give 22.8 px per degree, but it means 4× the download and about 180 MB of GPU memory with mips. MAX_TEXTURE_SIZE on the iPhone was 8192, so 8K is the hard ceiling. In orbit mode the panorama is mostly backdrop, and 2K looks fine.

## Added latency and cost over the diorama-only baseline

- **Generation:** about 60 s serial (21–25 s GPT, 26 s seam fix, 8.5 s upscale, plus about 5 s of uploads), costing $0.088 per world. Seedream text alone costs $0.035 but takes 67–167 s and keeps its seam. This runs in parallel with the diorama's image-to-3D step, so it adds no wall time as long as that step takes over a minute. I couldn't measure the 3D step today (**blocked (GMI 3D down)**).
- **Phone:** 1.1–1.7 MB more to download, 0.2–2.2 s of PMREM on first load (2.24 s measured on the cloud iPhone), and about 45 MB more GPU memory. Draw calls didn't change in a way that matters (the panorama is one mesh).

## Findings for the root and the kit

- `kit/gmi.mjs upload` fails for `.jpg` files: the PUT to the signed GCS URL returns 403 `SignatureDoesNotMatch`. `.jpeg` works, and so does `.png`. I named the published files `.jpeg`. The likely fix is to send `file_type: "jpeg"` for `.jpg`.
- The kit writes a ledger entry only after a job ends. When the machine slept mid-poll, six request ids were lost and couldn't be checked or recovered. Logging the request id at submit time would fix that.
- `wan2.7-image` image-to-image returned `Backend error (403)` on every POST. It looks like a GMI-side provider problem, not our payload.
- The GMI-hosted open models (Flux2-Klein, Flux2-Dev, Qwen-Image-2512; `qworkers: 0`) never left `queued` within 15 minutes, on two tries of 6 requests each. Hosted partner models (GPT, Bria, Seedream) answered in 7–167 s.
- GMI output URLs are on `storage.googleapis.com/gmi-video-assests-prod/...`. The manifest points at re-uploads made with `gmi.mjs upload`, not at the raw outputs.

## Unfinished (WIP)

- The real-iPhone run with the final assets: **pending (phones down, DAN-20)**.
- The day-specific diorama GLB, and life size with it: **blocked (GMI 3D down)**. Use the fal endpoints listed above.
- The Wan outpaint and the Klein, Flux2-Dev and Qwen panoramas: GMI never served them (see the table above), so they are missing from the comparison.
- Not tried: seam fix after the upscale (at 4K), a "no text" prompt for GPT, and a per-day `pano_height` for the cliff scene.
