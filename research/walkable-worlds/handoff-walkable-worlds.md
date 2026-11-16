# Walkable worlds: the recipe to ship (from YCCO-10)

**Winner: the day's diorama inside a 360° panorama, viewed at orbit or table scale.** The evidence and the alternatives are in `research/walkable-worlds/README.md` on branch `capy/walkable-worlds-spike`. The full write-up is `spike/walkable/skybox/RESULTS.md` on `capy/walkable-skybox`, and the code is `spike/walkable/skybox/` (`gen.mjs`, `tools/pano.py`, `main.js`).

## Generation (GMI request queue)

Submit with `POST https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey/requests` and the header `Authorization: Bearer $GMI_API_KEY`. Poll `GET .../requests/{id}`; the result URL is `outcome.media_urls[0].url`. Start this chain right after the scene writer, in parallel with the concept-to-3D chain. It needs only the scene text.

1. **Panorama**: `{ "model": "gpt-image-2.5-flare-generate", "payload": { "prompt": <panorama prompt>, "size": "2048x1024", "quality": "medium", "output_format": "png", "n": 1 } }`. About 21–25 s, $0.028. Never send `quality: "auto"`, because GMI bills it at the top tier. The prompt is `equirectangular 360 degree panorama, eye level, <setting, time of day, weather and key props from the scene>. <house style>` plus a seamless suffix (see `gen.mjs`) and "no text, no signage". Text crossing the seam gets garbled by the fix in step 2.
2. **Seam fix**: roll the panorama by half its width so the seam sits in the middle, and mask a 160 px vertical band there (`tools/pano.py roll --band 160`). Upload both files (GMI `POST .../upload-url` with `file_type: "jpeg"` or `"png"`, then PUT the bytes; `"jpg"` fails). Then send `{ "model": "bria-genfill", "payload": { "image": <rolled url>, "mask": <mask url>, "prompt": <panorama prompt> } }`, about 26 s and $0.04, and roll the result back. This takes the seam ratio below 1.0, where it's invisible. Every generator alone left a visible seam (ratio 3 to 11).
3. **Upscale**: `{ "model": "bria-image-increase-resolution", "payload": { "image": <url>, "desired_increase": 2 } }` gives 4096×2048 in about 8.5 s for $0.02. It isn't wrap-aware, so doing the upscale before the seam fix should be better (untested).
4. Convert to JPEG at about quality 85, so the phone downloads 1.1–1.7 MB, and store it as `panoramaUrl`.

Total: **$0.088 and about 60 s of GMI time per world.** Fallbacks: `seedream-5.0-lite` at `size: "4096x2048"` ($0.035) works but took 38–167 s and leaves worse seams. On fal: `fal-ai/hunyuan_world` (image to panorama, 1920×960, $0.15).

## Rendering (three.js 0.187; WKWebView or Safari)

- Load the panorama: `TextureLoader`, then `tex.mapping = EquirectangularReflectionMapping` and `tex.colorSpace = SRGBColorSpace`. Set `scene.background = tex` and `scene.environment = pmrem.fromEquirectangular(<1024×512 downscale>).texture`, so the diorama is lit by its own day.
- **Orbit mode:** the diorama GLB at the origin on a ground disc that fades radially into the panorama.
- **Table mode (ship this):** `GroundedSkybox(tex, 1.6, ~20)` from `three/addons/objects/GroundedSkybox.js`, with the camera at eye height 1.6 m and the 0.85 m diorama on a 0.8 m pedestal 2.3 m ahead. Add drag-look and a joystick clamped to a few metres.
- **Phone budget:** a 4096×2048 texture is under the iPhone's MAX_TEXTURE_SIZE of 8192 and uses about 45 MB of GPU memory with mipmaps. With a heavier scene, the viewer held 60 FPS on a cloud iPhone, which may be a simulator; the real-iPhone check is pending (DAN-20).
- **Expo SDK 58:** the fastest route is to host this page in `react-native-webview` (WKWebView uses the same WebGL as Safari), passing `panoramaUrl` and `modelUrl` as query parameters. For gyro look, send `expo-sensors` DeviceMotion through postMessage instead of the web permission prompt. `expo-gl` with three.js also works, but the DOM pieces (HUD, joystick) would need rewriting.
- **Known weak spot:** `GroundedSkybox` projects the lower hemisphere onto a flat floor, so the metre around your feet smears, and outdoors the sea can end up under the pedestal. Table scale hides this. The fix is depth (see rank 2).
- **Without a GLB** (3D down): show the concept image with its background removed (`bria-image-remove-background`, $0.018) as a camera-facing card on the pedestal. It reads well at table scale but not at life size.
