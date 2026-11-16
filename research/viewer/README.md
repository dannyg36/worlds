# YCCO-7: 3D world viewer and forming screen (handoff)

## Outcome
The world screen, the 3D viewer, the forming state, fixture worlds and tappable feed rows are built. Everything is on branch `capy/world-viewer`. It forks from main at 40522ca and has main merged at 260d139. There is no pull request, as the Captain asked. tsc, `expo lint` and `expo-doctor` (20/20) pass locally.

**What works**
- **World screen** (`src/app/world/[id].tsx`). A world that is forming shows the forming state, then the viewer once `modelUrl` arrives. A failed world shows its `error` and a Try again button that calls the retry hook. A legacy row (no `status`) shows its transcript and a short note. An unknown id shows "This world isn't here". The header has a Walk / Done toggle, with an SF Symbol on iOS and text elsewhere.
- **Viewer** (`src/world/viewer.tsx`). It is three.js r0.187 inside an Expo DOM component (`"use dom"`), rendered by the built-in `@expo/dom-webview`, so it needs no extra native module. Its features:
  - Loads a textured GLB from a URL with GLTFLoader, plus Draco (decoders from the gstatic CDN) and Meshopt.
  - A dark backdrop tinted by the world's palette, with soft glows, a lit pool on the floor and a blurred contact shadow.
  - RoomEnvironment IBL, a key light and a rim light that follows the camera, with NeutralToneMapping.
  - OrbitControls with damping, limits and a target clamp. Auto-rotate ramps up after the user is idle.
  - An entrance camera flight with a dissolve-reveal shader.
  - Tap a surface to fly to it (with a ripple); tap the backdrop to fly home.
  - Walk mode. A heightfield from an orthographic render of the model drives it, with a joystick, drag-to-look with inertia, and tap-to-walk.
  - Adaptive DPR, and an optional stats overlay.
- **Forming** (`src/world/forming.tsx`, `src/world/aurora.tsx`). An aurora in the world's palette. While dreaming, the transcript shows as a word wave. Once `imageUrl` exists, the concept card develops from blur, with tilt and a light sweep. A 4-step tracker (Dream, Paint, Sculpt, Arrive) shows the model download %.
- **Feed rows** (`src/app/index.tsx`). Each row has a thumbnail (`imageUrl`, or a palette gradient with a shimmer while forming), the date, a status chip, the title and the caption, and taps through to `/world/[id]`. This is minimal on purpose: YCCO-17 (Neel) owns WorldCard and the home screen.
- **Data access** (`src/world/worlds.ts`). The hooks `useWorlds`, `useWorld` and `useRetryWorld` match the field contract. worlds#3's `present()` returns exactly these fields.
- **Fixtures** (`src/world/fixtures.ts`, turned on with `EXPO_PUBLIC_FIXTURES=1`). Eight sample-day worlds use Khronos sample GLBs. `fixture-hackathon` forms live at launch (queued 0 s, dreaming 2.5 s, painting 7 s, sculpting 12 s, ready 26 s). `fixture-rainy-monday` is failed, and retrying it succeeds. `fixture-finals-library` is a legacy row.

**Evidence**
- On the cloud iPhone 16 simulator, the Debug build of a72c414 ran the DamagedHelmet fixture at 60.1 fps average (minimum 50.0). Load took 2727 ms, at dpr 3 (1179x2556 buffer), with 18,526 triangles in 4 draw calls. I also checked the feed rows and the forming overlay on the phone.
- Mobile Safari on the same simulator (WebGL 2, dpr 3), using `research/viewer/webgl-test/index.html`:

| Model | Size | Load | Frame rate |
| --- | --- | --- | --- |
| BoomBox | 10.6 MB | 1857 ms | about 59–60 fps |
| Corset | 13.5 MB | 1568 ms | 60.0 fps |
| DamagedHelmet | 3.8 MB | 1610 ms | 59.5 fps |

- The latest commit (dark stage, contact-shadow fix) was checked **only in Chrome** on the cloud VM: the web build, with software WebGL at about 5–10 fps. Screenshots are in `research/viewer/screenshots/` and in the Captain drive at `renders/YCCO-7/`.
- The rendering-stack bake-off is written up in `research/viewer/bake-off/README.md`.

## PR
None, per the Captain's wrap-up instruction. Branch: `capy/world-viewer`. It does not contain the shelved sign-in commit b8c47ca.

## Needs
- **Not yet on a phone.** The dark stage, the contact shadow, walk mode, tap-to-fly and pinch from commit 103ef33 still need a check on an iPhone, plus a short screen recording. Cloud phones stopped starting when the organization's Capy balance ran out (DAN-20).
- **Bake-off unfinished.** Neither the r3f/expo-gl arm nor the react-native-filament arm drew a model on the phone before phones went down. Their notes and sources are in `research/viewer/bake-off/`.
- **Fixtures.** Real sample worlds (`handoffs/sample-worlds/`) never landed, because GMI's hunyuan-3d-pro was blocked (DAN-18). The fixtures still use Khronos GLBs.
- **Design spec.** Neel's spec (`project-worlds/design/` in Drive) never landed, so the viewer chrome follows my own dark, glass styling.
- **Known dev-only warning.** On viewer mount, LogBox shows "Uncaught (in promise, id: 0) Error: Unable to find the 'DomWebView' view with tag". This is an upstream race in `expo/src/dom/webview-wrapper.tsx`, tracked as expo/expo#52503. It is harmless, because props are re-sent on DOM ready.
- **Web is not a target.** Dev web shows a hydration warning because fixture timestamps come from `Date.now()`, and the aurora glows don't render on react-native-web.

## How to run
1. `npm ci`
2. In `.env.local` (it is gitignored), set `EXPO_PUBLIC_CONVEX_URL` to your own Convex dev deployment, `EXPO_PUBLIC_FIXTURES=1` and, optionally, `EXPO_PUBLIC_VIEWER_STATS=1` for an fps and load overlay. Don't push to compassionate-goose-961.
3. Run `npx convex dev` (your own deployment) and then `npx expo run:ios` for a debug build that loads from Metro. `npx expo start --web` also works for a quick look.
4. Tap a row in the feed, or open `worlds://world/fixture-dolores-park`. `fixture-hackathon` shows the whole forming sequence at launch, and `fixture-rainy-monday` tests retry.
5. **Cloud-only workaround.** On cloud simulators, Metro's DOM page builds its script URLs from the request Host. My cloud build patched the AppDelegate bundle URL to a Host-rewriting proxy in front of Metro. On a Mac you don't need any of this.

## Next three steps
1. Run 103ef33 on an iPhone. Check the dark stage, the contact shadow, walk mode (joystick and tap-to-walk), tap-to-fly, pinch and the entrance, and record a short video.
2. When worlds#3 merges, switch `src/world/worlds.ts`. Set `useWorld` to `useQuery(api.worlds.get, { id })` and `useRetryWorld` to `useMutation(api.worlds.retry)`, and keep the fixtures behind `EXPO_PUBLIC_FIXTURES`. This is a one-file change. worlds#3's retry also starts legacy rows, so QuietWorld could gain a "bring it to life" button.
3. Swap the fixtures for real hunyuan-3d-pro GLBs (40k+ faces, PBR) and check that load time and 60 fps hold. Tune walk eye height (0.075) and speed (0.34) on real dioramas. Then apply Neel's spec to the chrome.

## Cost
- Generation (fal/GMI): $0.
- Capy for this thread including subagents: $36.63 priced, $29.36 charged. That breaks down as $26.30 for this thread alone, and about $10 for the two bake-off subagents.

## Lesson
Check each render pass in isolation with a pixel readback before tuning how it looks. The contact shadow had rendered nothing since the first commit, because its blur passes ran with a layer-masked camera and the blur plane sat behind the camera's near plane. A ten-line readback of the render target found both problems in minutes, after screenshots had been read as "subtle".
