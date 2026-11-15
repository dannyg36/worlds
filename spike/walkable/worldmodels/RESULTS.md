# worldmodels: real-time world models you can drive (YCCO-10 walkable spike)

Status: **in progress**. Harness, guarded proxy, phone page, probes and recorder are built and verified without a provider key. The provider moved from fal to GMI Cloud mid-spike (FAL_KEY deferred), so no live world-model session has run yet; sections marked TODO fill in once a key lands.

## What fal hosts for this approach today (read 2026-11-15 from each endpoint's llms.txt)

All of these speak fal's WMA WebRTC contract: open with `fal.realtime.open(wma(endpoint))` in the browser through a server proxy; never `fal.run`/`subscribe`.

| Endpoint | Price line (verbatim) | Declared stream | Controls | Notes |
| --- | --- | --- | --- | --- |
| `robbyant/lingbot-world-2` | `$0.00125 per seconds` ($0.075/min) | 1664x960 @ 48 fps | forward/backward/left/right, look_up/down/left/right, quick_action_1..9 | `configure` takes prompt + image_url (+ prompt expansion, safety, up to 9 quick actions); `session_info` reports max_blocks, frames_per_block, model_variant 14b-causal-fast |
| `alibaba/abot-world-0` | `$0.00125 per seconds` ($0.075/min) | 1280x704 @ 16 fps | same 8 movement/look commands, no quick actions | `configure` takes prompt + image_url |
| `vast/eden-live-5b-game` | "Sessions cost $0.0035 per second of video generated, with a minimum of 10 billable seconds ($0.035) per session." ($0.21/min) | 1280x704 @ 24 fps | movement, look, fire, jump, ability_1..4 | A neural renderer over 12 built-in games (freeze, spiders, pulse, deepwater, kaiju, arcadeduel, desert, snowball, puppy, cat, drone, herding); prompt and image_url only restyle the game's scene, the geometry is the game's. Stats report billable_units and input_latency_ms |
| `vast/eden-live-14b-game` | "Sessions cost $0.01 per second of video generated, with a minimum of 10 billable seconds ($0.10) per session." ($0.60/min) | 832x480 @ 16 fps | as 5B | as 5B |
| `minimax/h3-max/reference-director` | `$0.05 per seconds` ($3.00/min, x1 at 480p up to x1.2 at 768p+ per billable_units_per_playable_second; pricing_status "provisional-experiment") | 24 fps, 480p-1440p, video + audio | none (directable by prompt, script and reference images, not walkable) | one session per 8-GPU B200/B300 machine |
| `minimax/h3-max/director` | "$0.056 per second" (Nov 1-15 promo), "$0.08 per second" from Nov 16, 2026; "Each session is billed at a minimum of 60 seconds" | 24 fps | directable | skipped per brief (60 s minimum) |
| `alibaba/happy-oyster` | none | - | - | **No longer supported**: the API page says "This model is no longer supported."; the model page and llms.txt return 404; `@fal-ai/client@1.11.0` dropped its `./happy-oyster` export |

Client libraries: `@fal-ai/client` `alpha` tag is 1.11.0-alpha.6; stable 1.11.0 (2026-11-14) ships byte-identical `realtime/wma.js`. `@fal-ai/server-proxy` 1.3.0-alpha.1 and 1.3.0 are identical; the proxy has first-class WMA support (service host `wma.fal.run`, app_id checked against `allowedEndpoints`). The WMA bridge has exactly three routes: POST /ice, POST /session (one-shot SDP offer/answer, returns session_id) and POST /session/heartbeat every 5 s (3 rejected beats end the client session). There is no close route: a session ends when the peer closes or the heartbeat lease lapses.

## What is built (spike/walkable/worldmodels/)

- `serve.mjs`: static page + `POST /stats` (appends to stats.jsonl) + `POST /snap`, `POST /clip` (probe snapshots and on-device recordings) + the guarded fal proxy at `/api/fal/proxy` built on `@fal-ai/server-proxy`'s `handleRequest`.
- Guardrails (verified against a dummy key in a throwaway copy, so the real ledger stayed clean): forwards only POST to wma.fal.run /ice, /session, /session/heartbeat and fal.run/<model>/ice; app_id must be one of the five world-model endpoints (duplicate-key JSON refused); everything else is 403. Each /session reserves cap-seconds x price in the ledger with the kit's `charge()` before forwarding and settles (negative adjustment) when the heartbeats stop, so the ledger sum is the estimated actual. New sessions are refused with 402 past the spend cap (budget cap minus $1 = $11) and 429 past 2 live sessions; heartbeats are refused (410) after 120 s (30 s for h3, 60 s for eden-14b), which ends the bridge lease. The page also sends `{type:"stop"}` and closes at the cap, and on pagehide.
- `public/`: fullscreen inline video (playsinline, muted), the day's eye-level image as poster until the configured world's first frame, joystick (forward/back/strafe), floating look stick (look_left/right/up/down), hold-to-act quick-action buttons (LingBot), WASD/arrows/1-9 on desktop, End, Rec (MediaRecorder on the received stream, uploads MP4/WebM to the server), Fill/contain toggle, HUD and Tests panel.
- HUD: model, day, connection state, session seconds of cap, estimated cost, billed seconds when the model reports them, time to first frame split into runner / media / first frame / configured, ICE path (host/srflx/relay, UDP/TCP, TURN), RTT and data-channel ping, received resolution, presented fps (requestVideoFrameCallback) and RTP fps, bitrate, codec, decode ms, jitter buffer, drops, losses, freezes, MB received, model-side generation fps / realtime factor / input latency, page fps and frame time, WebGL renderer, JS bytes and load time.
- Tests panel: latency probe (input to first frame of camera motion, from frame differencing, 4 trials), turn away and back, walk out and back, full turn (similarity to the start view over 14 s), snapshot, ICE probe (STUN gathering: does UDP leave the phone's network). Every result is POSTed to /stats with snapshots saved under captures/.
- `?mock=1` (canvas world that obeys the same commands, no provider) and `?mock=1&loopback=1&w=1664&h=960&fps=48` (the same stream pushed through a local RTCPeerConnection pair, so the phone decodes a LingBot-sized H.264 WebRTC track and the RTP stats path is exercised without a provider).

## Measurements

TODO once a key lands (per model, hackathon then santa-cruz): time to first frame, input latency, received resolution and fps, max session length, coherence, fidelity, cost per minute.

## Phone

TODO: Revyl iPhone slots were all busy on the first attempts.

## Verdict

TODO.
