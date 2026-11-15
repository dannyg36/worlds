# worldmodels: walking your day through a world model (YCCO-10 walkable spike)

Status: **WIP, stopped at the wrap-up call (2026-11-15 ~21:20 UTC).** GMI has no interactive world model, so the live path is built for fal and proven only with a mock stream; the GMI fallback (a branching walk of image-to-video camera moves) works end to end for both days, tested in WebKit iPhone emulation because cloud phones were down.

## Verdict

- **Live, walkable world model on GMI: not yet.** GMI hosts no interactive world model. `Krea-Realtime-14B` is exposed only as an async request-queue job (prompt, optional input_video, 832*480 only; no session, no stream, no prompt updates, empty detailed_description, qworkers 0), and our one probe sat in `queued` for 11+ minutes without starting.
- **Live on fal: stretch, pending FAL_KEY.** `robbyant/lingbot-world-2` at $0.00125/s ($0.075 per minute of session) is the candidate. The browser client and guarded proxy are built and ran against a mock stream on a real cloud iPhone earlier today; no real session has run, so latency, coherence and fidelity are unmeasured.
- **GMI branching walk: works today as a "step into your day" teaser, not as a walkable world.** A node of three moves (walk, turn left, turn right) from the day's eye image takes 57 to 112 s with all three in parallel and costs $0.58 to $0.60; a second hop needs the first hop's last frame, so two hops take 2 to 3.5 minutes. On the client it is plain MP4 playback: swipe to first frame was 62 to 295 ms (median about 100 ms) in WebKit emulation, with 0 dropped frames. But it feels like choosing a path through short films, not walking: moves are canned 4 to 6 s clips, there is no free look, and branches are imagined independently, so the world isn't consistent across them ("back" is exact only because it plays the clip reversed).
- **Pick for the teaser:** Minimax-Hailuo-2.3-Fast for fidelity and consistency (stays on the source image, 1364x768 at 24 fps, $0.192 per 6 s clip), though its turns are small and "forward" is a gentle push-in. wan3.0-video at 480P makes bigger, more convincing moves but at 854x480, and it invents people: in 2 of 9 clips a person walks into frame from the camera position, which reads as third person.

## GPU option (report only, nothing set up)

An open-source real-time world model on a GMI GPU container: Matrix-Game 2.0 claims 25 fps on one H100 (an independent run measured 19.7 fps on the same GPU, Hugging Face blog, Oct 2026). GMI lists on-demand H100 "from $2.60/GPU-hour" on its pricing page and "from $2.00 per hour" in its 2026 pricing blog. One user per H100 means **$0.033 to $0.043 per user-minute** while someone is walking, plus idle time: one always-on H100 is about $1,460 to $1,900 a month. LingBot-World's open weights (the base of fal's lingbot-world-2) would need the same kind of deployment; its GPU needs aren't verified here.

## Numbers

### GMI branching-walk clips (2026-11-15, 20:56 to 21:07 UTC; all through kit/gmi.mjs)

Wall = submit to downloaded result; GMI = the request's updated_at minus created_at. Jobs in a batch ran in parallel.

| Day | Model (settings) | Move | Wall s | GMI s | Cost |
| --- | --- | --- | --- | --- | --- |
| hackathon | Minimax-Hailuo-2.3-Fast (768P, 6 s, prompt_optimizer off) | forward | 51.4 | 49 | $0.192 |
| hackathon | Hailuo | left | 112.1 | 109 | $0.192 |
| hackathon | Hailuo | right | 46.2 | 45 | $0.192 |
| hackathon | Hailuo, hop 2 from the end of forward | forward.forward | 76.6 | 74 | $0.192 |
| hackathon | Hailuo, hop 2 | forward.left | 50.9 | 47 | $0.192 |
| hackathon | Hailuo, hop 2 | forward.right | 96.7 | 94 | $0.192 |
| hackathon | wan3.0-video (480P, 4 s, 16:9, prompt_extend off) | forward | 66.5 | 63 | $0.20 |
| hackathon | Wan | left | 81.7 | 78 | $0.20 |
| hackathon | Wan | right | 66.4 | 62 | $0.20 |
| hackathon | Wan, hop 2 from the end of right | right.forward | 66.5 | 62 | $0.20 |
| hackathon | Wan, hop 2 | right.left | 81.9 | 77 | $0.20 |
| hackathon | Wan, hop 2 | right.right | 81.8 | 78 | $0.20 |
| santa-cruz | Hailuo | forward / left / right | 52.0 / 57.3 / 56.8 | 46 / 53 / 55 | $0.192 each |
| santa-cruz | Wan | forward / left / right | 67.4 / 83.3 / 82.7 | 62 / 80 / 78 | $0.20 each |

- Hailuo: median 56.8 s wall (46 to 112), delivers 1364x768, 24 fps, 5.88 s, H.264, no audio, 0.65 to 2.9 MB.
- Wan 480P: median 81.7 s wall (66 to 83), delivers 854x480, 30 fps, 4.04 s, H.264 with an audio track, 3.0 to 6.5 MB.
- **veo-3.1-lite-generate-001 failed 4 of 4** at submit (HTTP 500 "Generation failed for an unknown reason; please retry", 5 to 15 s), with personGeneration allow_all (3) and allow_adult (1). No charge.
- **LTX-2** ($0.01/request, qworkers 0): 3 jobs submitted at 20:56; the client died when the machine slept, so the request ids and outcome are lost. $0.03 reserved in the ledger.
- **Krea-Realtime-14B**: request ae6f8600-ea81-46b6-888b-d6a0eb582846, submitted 21:02:47 UTC, still `queued` at 21:14 UTC. $0.25 reserved; GMI has no cancel endpoint.
- Phone files (fetch-assets.mjs re-encodes to H.264 main, CRF 23, no audio, max 1280 wide, plus a reversed copy for "back"): hackathon Hailuo 6 clips 10.7 MB forward plus reverse, Wan 5.7 MB; santa-cruz Hailuo 3 clips 10.4 MB, Wan 5.0 MB.

### Look (contact sheets in research/walkable-worlds/worldmodels/)

- Hailuo keeps the eye image almost exactly and stays consistent; turns are about a quarter of the frame width; forward is a slow push-in toward the team or the bikes; hop 2 forward.right revealed the same bookshelves that hop 1 "right" did. forward.left barely moved.
- Wan makes real pans (new office areas, the wharf, the cliffs) and real forward motion, at 480p, but adds people: a walker from the camera position in hackathon forward and santa-cruz left, and new bystanders in other clips.

### Phone

- **Real cloud iPhone, earlier today (Revyl, 20:40 to 20:46 UTC; Safari UA "iPhone OS 18_7 ... Version/27.0 Mobile", 440x956 @3x), live page (fal WMA client) in mock mode:** JS 46 KB in 6 files, page ready 0.7 to 2.1 s, page 58 to 60 fps; touch joystick and look stick drove the mock world; requestVideoFrameCallback works; MediaRecorder recorded video/mp4 (avc1) and uploaded an 849 KB, 6.9 s, 960x540 clip; a direct canvas stream showed 27.5 fps at 960x540; a loopback WebRTC H.264 track decoded at 832x480 with 1.2 ms decode, then froze after about 165 frames (cause unproven; possibly the simulator's encoder); ICE probe gathered host and srflx UDP candidates in 118 ms, so STUN egress works. No camera device was listed, which hints the phone is a simulator.
- **Walk page, WebKit emulation, not an iPhone** (Playwright 1.65.1 WebKit, iPhone 15 Pro profile 393x659 @3x, software rendering, run by webkit-test.mjs): all 16 moves across both days and both models finished with no console errors. Swipe to first frame 62 to 295 ms (first move per page 230 to 295 ms, later moves 62 to 161 ms); decoded 22 to 29 fps against 24 and 30 fps sources with 0 dropped of 120 to 141 frames; clips loaded from localhost in 0.10 to 0.18 s; touch taps on the arrows and pointer swipes both worked. Page rAF was 14 to 31 fps, which is software GL, not phone performance.
- **Pending (phones down, DAN-20):** the walk page on a real iPhone (inline muted autoplay from blob URLs, swipe latency, smoothness, memory with about 10 MB of clips, how the swipes feel), and any real fal session on a phone (also needs FAL_KEY).

### Spend

worldmodels ledger: **$3.808 of $8** (24 entries), including $0.25 reserved for the Krea probe that never ran and $0.03 for the lost LTX-2 jobs. No 3D jobs; nothing here needs a 3D model, so nothing is blocked on GMI 3D.

## How to run

From the repo root (needs Node 24 and ffmpeg/ffprobe on PATH):

```bash
node spike/walkable/worldmodels/fetch-assets.mjs   # npm ci, eye images, downloads clips.json videos, builds phone files
node spike/walkable/worldmodels/serve.mjs          # PORT 5104
```

- Branching walk: `/walk.html?day=hackathon|santa-cruz&set=hailuo|wan`. Swipe up to walk, left or right to turn, down to go back (or tap the arrows; arrow keys on desktop). The HUD shows node, clip, generation latency and cost, swipe-to-frame, fps and drops; every move is POSTed to /stats (stats.jsonl).
- Live page (fal): `/?day=hackathon`, or `/?mock=1` without a key. Needs FAL_KEY on the server for real sessions.
- New clips: `node spike/walkable/worldmodels/make-clips.mjs --day hackathon --sets hailuo,wan [--from forward] [--plan]` (sets: veo, hailuo, wan, ltx2, kling; at most 12 jobs per run, refused past the cap; results go to clips.json).
- WebKit check: `cd spike/walkable/worldmodels && npm i --no-save playwright@1 && npx playwright install --with-deps webkit && node webkit-test.mjs`.

## What is built (spike/walkable/worldmodels/)

- `make-clips.mjs`: per-day prompts for walk forward, turn left and turn right on five GMI image-to-video models; hop 2 starts from the previous clip's last frame (ffmpeg, then the kit's upload). Records prompts, payloads, request ids, latency, cost and video URLs in `clips.json` (committed).
- `public/walk.html`, `walk.js`, `walk.css`: the branching-walk phone page. Double-buffered video elements, clips preloaded as blobs, reversed clips for "back", HUD, stats.
- `webkit-test.mjs`: Playwright WebKit iPhone-emulation run of the walk page with screenshots and per-move stats.
- `serve.mjs`: static page, `POST /stats`, `/snap`, `/clip`, and the guarded fal proxy at `/api/fal/proxy` (built on `@fal-ai/server-proxy`): only the WMA bridge routes for the five world-model endpoints; each session is reserved in the ledger before it opens and settled after; new sessions refused with 402 past the spend cap ($8 budget minus $1 = $7) and 429 past 2 live sessions; heartbeats refused (410) after 120 s (30 s for h3, 60 s for eden-14b), which ends the bridge lease. Guard tests passed against a dummy key earlier today.
- `public/index.html`, `app.js`, `style.css`: the live client: fullscreen inline video, joystick, look stick, quick actions, HUD (time to first frame, ICE path, RTT, resolution, fps, bitrate, decode, drops, cost), Tests panel (latency, turn, walk, spin, snapshot, ICE probe), Rec, and `?mock=1` / `&loopback=1` modes.

## What fal hosts for the live path (read 2026-11-15 from each endpoint's llms.txt)

All of these speak fal's WMA WebRTC contract: open with `fal.realtime.open(wma(endpoint))` in the browser through a server proxy.

| Endpoint | Price line (verbatim) | Declared stream | Controls | Notes |
| --- | --- | --- | --- | --- |
| `robbyant/lingbot-world-2` | `$0.00125 per seconds` ($0.075/min) | 1664x960 @ 48 fps | forward/backward/left/right, look_up/down/left/right, quick_action_1..9 | `configure` takes prompt + image_url |
| `alibaba/abot-world-0` | `$0.00125 per seconds` ($0.075/min) | 1280x704 @ 16 fps | same 8 movement/look commands | `configure` takes prompt + image_url |
| `vast/eden-live-5b-game` | $0.0035 per second, 10 s minimum ($0.21/min) | 1280x704 @ 24 fps | movement, look, fire, jump, ability_1..4 | restyles 12 built-in games; geometry is the game's |
| `vast/eden-live-14b-game` | $0.01 per second, 10 s minimum ($0.60/min) | 832x480 @ 16 fps | as 5B | as 5B |
| `minimax/h3-max/reference-director` | `$0.05 per seconds` ($3.00/min) | 24 fps, 480p to 1440p | none (directable, not walkable) | |
| `minimax/h3-max/director` | $0.056/s promo, $0.08/s from Nov 16; 60 s minimum | 24 fps | directable | skipped (60 s minimum) |
| `alibaba/happy-oyster` | none | - | - | no longer supported (page and llms.txt 404) |

Client libraries: `@fal-ai/client` 1.11.0-alpha.6 (same `realtime/wma.js` as stable 1.11.0), `@fal-ai/server-proxy` 1.3.0-alpha.1 (same as 1.3.0). The WMA bridge has three routes: POST /ice, POST /session, POST /session/heartbeat every 5 s; there is no close route.

## Expo SDK 58 path (not built)

- Branching walk: `expo-video` (`useVideoPlayer` and `VideoView`, documented for SDK 58) playing the same MP4s from a CDN, with a second player for the next clip and `react-native-gesture-handler` (already in the app, ~3.3.0) for swipes. No native module beyond what the app has; clips and `clips.json` would come from Convex.
- Live fal session: needs WebRTC in the app, either `react-native-webrtc` with its config plugin and a development build, or the existing web client in a WebView. Both unverified.

## Outputs

- Repo: `research/walkable-worlds/worldmodels/`: contact sheets per day and model, WebKit screenshots, `webkit-results.json`.
- Drive (captain): `renders/YCCO-10/worldmodels/`: `walk-hackathon-hailuo.mp4` (29 s, 1280x720, 4.5 MB), `walk-hackathon-wan.mp4` (16 s, 854x480, 2.0 MB), `walk-santa-cruz-hailuo.mp4` (29 s, 1280x720, 8.0 MB), `phone-mock-hackathon-2026-11-15.mp4` (recorded on the cloud iPhone, mock world, 6.9 s), `webkit-4up.jpg`.

## Unfinished

- Real iPhone run of the walk page (phones down, DAN-20).
- Any real fal world-model session (FAL_KEY deferred): time to first frame, input latency, coherence, max session length, and the heartbeat-lease cap test.
- Krea-Realtime-14B never left the queue; LTX-2 outcome unknown; Veo image-to-video failed at submit.
- More hops for santa-cruz, and a smaller re-encode for phones (Hailuo clips are 0.9 to 2.1 MB each).
