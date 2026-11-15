# World generation: measured results (YCCO-6, 2026-11-15)

All numbers come from real GMI Cloud calls made with the project's `GMI_API_KEY`. hunyuan-3d-pro couldn't be measured, because every submission failed (see the 3D section).

## End-to-end through Convex, 8 sample days

Run at 21:10 UTC on a local Convex deployment, one world at a time. The concept images are in `concepts/`, and the raw run data is in `e2e-results.json`.

Setup for this run:
- Scene writer: `deepseek-ai/deepseek-v4.1-flash-1017`. The code now uses `google/gemini-3.8-flash` instead (see the next section).
- Concept image: `seedream-4-0-250828` at 1024×1024.
- 3D step: stubbed with a public sample GLB, so this run proves the Convex flow but not 3D latency.

| Day | Scene (s) | Concept image (s) | Image on GMI (s) | Download and store (s) | Until 3D starts (s) |
| --- | --- | --- | --- | --- | --- |
| hackathon | 2.9 | 10.6 | 10.5 | 0.14 | 13.6 |
| santa-cruz | 1.3 | 9.2 | 9.1 | 0.11 | 10.6 |
| rainy-monday | 3.7 | 7.4 | 7.3 | 0.12 | 11.1 |
| dolores-park | 2.4 | 9.4 | 9.3 | 0.12 | 11.8 |
| birthday-dinner | 3.6 | 9.8 | 9.6 | 0.11 | 13.4 |
| finals-library | 1.3 | 10.7 | 10.5 | 0.15 | 12.1 |
| mission-peak | 2.1 | 8.4 | 8.2 | 0.20 | 10.5 |
| farmers-market | 12.6 (one retry) | 12.6 | 12.5 | 0.10 | 25.2 |

Median until the 3D step starts: about 12 s. On farmers-market, the first scene-writer reply came back empty after 6.4 s, and the retry succeeded. That failure is why the scene writer changed.

## Scene writer (LLM on `https://api.gmi-serving.com/v1/chat/completions`)

Each row is 16 calls (8 days, twice each) with the real prompt, `response_format: json_object`, and `max_tokens: 1500`.

| Model and setting | p50 | max | Bad replies |
| --- | --- | --- | --- |
| deepseek-v4.1-flash-1017, default | 4.2 s | 7.1 s | 2 of 16: it spent all 1500 tokens reasoning and returned no JSON |
| deepseek-v4.1-flash-1017, `reasoning_effort: "low"` | 4.9 s | 7.0 s | 1 of 16, same cause |
| deepseek-v4.1-flash-1017, thinking off (three different flags) | 1.6 s | 60 s | 1 of 16 per flag: the request hung until the 60 s client timeout |
| **gemini-3.8-flash, `reasoning_effort: "low"` (in use)** | **3.1 s** | **4.4 s** | **0 of 16** |
| gemini-3.5-flash-lite, default | 3.0 s | 3.5 s | 0 of 16 |

## Concept image (GMI request queue), with the hackathon prompt

| Model | Result |
| --- | --- |
| **seedream-4-0-250828 (in use)** | 10.9 s, 380 KB JPEG, $0.05. 7.3 to 12.5 s across the 8 days above. Clean diorama on white, which suits image-to-3D. |
| hy-image-v3.5-preview | 13.6 s, 1.7 MB PNG, $0.024. Also clean. |
| Z-Image-Turbo, Flux2-Klein | Stuck in `queued` for more than 3 minutes; the model cards show 0 workers. |
| gemini-3.1-flash-lite-image, gemini-nano-banana-2.1, gemini-2.5-flash-image | HTTP 500 "Upstream provider unavailable; please retry". |
| wan2.7-image | HTTP 500 "Backend error (403)". |
| seedream-5.0-lite | HTTP 429. |

GMI's sync models block on submit and come back with `status: "success"` but no outcome. You have to GET the request to read `outcome.media_urls`, which are public storage.googleapis.com links.

## 3D (hunyuan-3d-pro)

Every submission since the first at 20:44 UTC has failed at submit with HTTP 500 `hunyuan api error [ResourceInsufficient]: Resources are insufficient.` That covers 38 of 38 across the crew, and the Captain's probe at 21:00 UTC failed the same way. It fails with any input and any face count, and with nothing else in flight. Tencent uses this code when the upstream account has no balance or resource pack. It's tracked as DAN-18.

Because of that, nothing about this model's latency or output is verified:
- **Latency:** third-party listings put hunyuan3d-pro at 3 to 6 minutes.
- **Output format:** Tencent's own API returns OBJ (in a zip) and GLB by default. GMI's `media_urls` shape for this model is unverified.

## What a one-minute world would take

Everything before the 3D step takes about 12 s, so the 3D step needs to finish in about 45 s, including GMI's queue. If hunyuan-3d-pro really takes 3 to 6 minutes, no amount of pipeline tuning reaches a minute. It would take one of these:
- a faster image-to-3D model, which can be switched in with one line in `convex/generation/models.ts` once its provider has a key (fal's models are already wired);
- showing the concept image (ready at about 12 s) as the world's first view while the GLB finishes.
