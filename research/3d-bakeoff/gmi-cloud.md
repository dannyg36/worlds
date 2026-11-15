# GMI Cloud: what we know

Source: Rikhil, 2026-11-15, from GMI's console docs. YCCO-8 owns the catalog survey and appends verified findings below; any thread that verifies a fact adds it here. Never write the key here.

## Key
`GMI_API_KEY`, a shared project variable. Check presence with `test -n "$GMI_API_KEY"`. Never print it.

## Request queue API (image, video, and 3D models)
- Submit: `POST https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey/requests`
  - Headers: `Authorization: Bearer $GMI_API_KEY`, `Content-Type: application/json`
  - Body: `{ "model": "<model id>", "payload": { ... } }`
- Status: `GET https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey/requests/{request_id}`
  - status is one of queued, processing, success, failed. On success the output URLs are in `outcome.media_urls`.
- No webhook is documented, so poll.

## hunyuan-3d-pro (Tencent Hunyuan 3D Pro): text-to-3D and image-to-3D

> **Down for our account (DAN-18), 2026-11-15.** Every submit fails with `hunyuan api error [ResourceInsufficient] Resources are insufficient.` Don't submit or retry until your Captain says it works. Verified working with the same key: the LLM endpoint, hy-image-v3.5-preview, and seedream-4-0-250828.
- payload fields:
  - `prompt` (string) or `image_url` (string, a public URL); they are mutually exclusive.
  - `enable_pbr` (boolean): PBR materials.
  - `face_count` (integer, 40,000 to 1,500,000).
  - `generate_type`: `Normal` (with textures), `LowPoly`, `Geometry` (no textures), or `Sketch` (from a line drawing).
- Image-to-3D works best with a simple or solid background, a single object filling more than half the frame, and no text.
- Price: $0.375 per model.
- Concurrency: up to 3 simultaneous jobs on the account, shared by the whole crew.
- Output: "3D model file". The format (GLB or not) is unverified.

Example body:
```json
{ "model": "hunyuan-3d-pro", "payload": { "prompt": "A cute cartoon cat", "enable_pbr": true, "face_count": 500000 } }
```

## Unverified, to fill in
- Which image models and LLMs GMI hosts, with ids, prices, and latency. GMI's LLMs are typically served through an OpenAI-compatible endpoint; confirm the URL and whether this key works there.
- hunyuan-3d-pro's real latency and output format.
- The account's balance. The console showed a top-up prompt, so if calls fail for billing, report it to your Captain right away.

## Catalog survey (YCCO-8, 2026-11-15)
Sources: GMI's docs (docs.gmicloud.ai/llms.txt and all 127 text, image, audio, and 3D model pages) and GMI's own blog posts from Sept to Nov 2026. Marked [docs] until checked with our key; [verified] facts get added below as YCCO-8 confirms them.

### Endpoints [docs]
- LLMs: OpenAI-compatible chat completions at `https://api.gmi-serving.com/v1/chat/completions`, same Bearer key. List the LLMs a key can call: `GET https://api.gmi-serving.com/v1/models`.
- Media models on the request queue: `GET https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey/models` lists them, and `GET .../apikey/models/{model id}` returns one model's parameter schema.
- Uploading an input file: `POST .../apikey/upload-url` with `{"file_type": "png"}` returns a pre-signed `upload_url` (PUT the raw bytes with a matching Content-Type, valid about 15 minutes) and a stable `public_url` to pass as `image_url`. Accepts jpeg, jpg, png, mp4, mp3, wav.
- Sync models (most image models) can come back at `success` in the submit response; still GET the request to read `outcome.media_urls`, whose entries are objects with a `url` field.
- Optional `X-Organization-ID` header on both families for keys that belong to several organizations.
- Prices live on each model card in the console (Inference > Model Hub); GMI also has a price estimate endpoint that quotes the exact parameters you send.

### 3D [docs]
- hunyuan-3d-pro is the only 3D model GMI documents ("Our 3D option is hunyuan-3d-pro", GMI blog, Sept 2026). Async, $0.375 per model, up to 3 concurrent jobs per account. No other 3D, splat, or world model is listed.

### Image models for the concept image [docs]
| Model id | Price per image | Notes |
| --- | --- | --- |
| `gemini-3.1-flash-lite-image` | ~$0.034 (1K, token-billed) | Fastest family in GMI's Nov 2 benchmark (4 to 8 s); fixed 1K output; tends to add unrequested text |
| `gemini-nano-banana-2.1` | ~$0.034 at 1K, $0.050 at 2K | Top quality in that benchmark, steady 14 to 15 s |
| `gemini-3.1-flash-image` | ~$0.067 at 1K | |
| `gemini-2.5-flash-image` | ~$0.039 | |
| `gemini-3-pro-image` | $0.134 | Slow and pricey for its score |
| `gpt-image-2-generate` | ~$0.053 medium, $0.211 high (1024²) | Token-billed; slow at medium |
| `seedream-5.0-lite` | $0.035 | 2K minimum output (3.7 MP floor) |
| `seedream-5.0-pro` | $0.085 | 2K; slow |
| `seedream-4-0-250828` | $0.05 | |
| `wan2.7-image` / `wan2.7-image-pro` | $0.03 / $0.075 | |
| `bria-fibo-generate-2.0` | $0.04 | |
| `luma-uni-1.1` | $0.0404 | 2K output; one image took 86 s in GMI's test |
| `Flux2-Klein`, `Flux2-Dev`, `Z-Image`, `Z-Image-Turbo`, `Qwen-Image-2512`, `GLM-Image`, `reve-2-1` | not on the docs page | Klein and Z-Image-Turbo are billed as fast models; check the console card |
| `bria-image-remove-background` | $0.018 | Useful to cut a concept image out before 3D |

### Audio [docs]
Text-to-speech, voice clone, and music only (MiniMax speech 2.6/2.8, Inworld TTS 1.5/2, Chatterbox, Kling custom voice, MiniMax music). **No speech-to-text model is documented**, so the voice note's transcription needs another provider, or an audio-capable LLM on the chat endpoint (unverified).

### LLMs [docs]
75 model pages, all on the chat endpoint. Fast, cheap scene-writer candidates: `openai/gpt-5.4-nano`, `openai/gpt-5.4-mini`, `google/gemini-3-flash-preview`, `google/gemini-3.1-flash-lite-preview`, `deepseek-ai/DeepSeek-V4-Flash`, `Qwen/Qwen3.6-35B-A3B`, `anthropic/claude-haiku-4.5`, `bytedance/seed-2.0-mini`. Larger: `openai/gpt-5.5`, `anthropic/claude-sonnet-4.6`, `anthropic/claude-opus-4.7`, `google/gemini-3.1-pro-preview`, `deepseek-ai/DeepSeek-V4-Pro`, `moonshotai/Kimi-K2.6`, `Qwen/Qwen3.7-Max`, `zai-org/GLM-5.1-FP8`, `MiniMaxAI/MiniMax-M2.7`. LLM prices are not on the docs pages.

## Verified with our key (YCCO-6, 2026-11-15 ~20:40–20:50 UTC)
- **LLMs:** the same `GMI_API_KEY` works on `https://api.gmi-serving.com/v1/chat/completions`, and `/v1/models` lists 75 ids. Scene-writer latency (about 320 prompt tokens, JSON reply, `response_format: {"type":"json_object"}`): `deepseek-ai/deepseek-v4.1-flash-1017` 1.2 to 2.6 s; `google/gemini-3.5-flash-lite` about 3 s; `google/gemini-3.8-flash` 6 to 10 s, or 2.5 s with `reasoning_effort: "low"`; `openai/gpt-6-luna` 8.4 s; `Qwen/Qwen3.8-Flash` 55 s. `openai/gpt-6.1-terra` returns 404 ("No matching target server").
- **Sync image models** block on submit and come back with `status: "success"`, but with no outcome in that response. GET the request to read `outcome.media_urls`, which looks like `[{ id, url, type?, width?, height? }]`. The URLs are public storage.googleapis.com links, so no auth is needed to download them or to pass them as `image_url`.
- **Images that worked:** `hy-image-v3.5-preview` (`size: "1024x1024"`) took 13.6 s and returned a 1.7 MB PNG for $0.024. `seedream-4-0-250828` (`size: "1024x1024"`) took 10.9 s and returned a 380 KB JPEG for $0.05. Both drew a clean diorama on a light background, which suits image-to-3D.
- **Images that didn't work:** `Z-Image-Turbo` and `Flux2-Klein` sat in `queued` for over 3 minutes; their model cards show `qworkers: 0`. `gemini-3.1-flash-lite-image`, `gemini-nano-banana-2.1`, and `gemini-2.5-flash-image` returned HTTP 500 "Upstream provider unavailable; please retry". `wan2.7-image` returned 500 "Backend error (403)". `seedream-5.0-lite` returned 429 once.
- **hunyuan-3d-pro is failing for this account.** Every request since the first at 20:44 UTC (38 of 38, across several threads) failed at submit with HTTP 500 `hunyuan api error [ResourceInsufficient] Resources are insufficient.`, and each one is recorded with status `failed`. It fails with text or image input, at 40k, 100k, or 500k faces, and with nothing else in flight. Tencent uses this code for an upstream account with no balance or resource pack, so YCCO-6 escalated it to the Captain. Don't retry in bursts.
- **No cancel endpoint:** `POST .../requests/{id}/cancel` and `DELETE .../requests/{id}` both return 404.
- **Listing requests:** `GET .../apikey/requests?limit=100&offset=0` lists the account's requests with status, payload, and outcome. Every thread uses the same key, so check it for 3D jobs already in flight before you submit.

## Verified by YCCO-10, 2026-11-15 (walkable-worlds spike)
- `GET /api/v1/ie/requestqueue/apikey/models` works with the key and returns 380 `model_ids`, some of them internal test or capture ids. `GET .../models/{id}` returns `parameters` (names, types, options), `pricing_details` (text) and `price_info.price` in micro-dollars (hunyuan-3d-pro: 375000). A full catalog snapshot is on branch `capy/walkable-worlds-spike` at `spike/walkable/catalog/gmi-2026-11-15.md`.
- A request's status JSON carries `created_at`, `queued_at` and `updated_at` (unix seconds), so `updated_at - created_at` is GMI's own processing time. `outcome.media_urls` is an array of objects, `[{ "id": "0", "url": "https://storage.googleapis.com/..." }]`, plus `outcome.thumbnail_image_url`. The URLs are public.
- Polling saw `queued` straight to `success` for seedream-5.0-lite, never `processing`.
- `seedream-5.0-lite` ($0.035) accepts a custom `size` of `WxH` from 3.7 to 10.4 MP with aspect ratio 1:16 to 16:1, so `4096x2048` works for a 360 panorama. `image: [url]` adds references. Wall latency today was 38 to 167 s per image (8 calls).
- `hunyuan-3d-pro` submits failed with HTTP 500 `hunyuan api error [ResourceInsufficient]: Resources are insufficient.` from 20:48 UTC onward, while other crew threads were running 3D jobs. The job is rejected, not queued, so callers must retry with a delay (for example every 30 s for up to 15 min) rather than assume GMI will queue it.
- None of these are on GMI: panorama, depth, Gaussian-splat, HunyuanWorld or interactive world models, and no model takes LoRAs. `Krea-Realtime-14B` ($0.025/s) is the only real-time video model, and it has no movement or camera controls.

## Verified by YCCO-8, 2026-11-15 (3D bake-off)
- **Cheapest concept-image model that works: `gpt-image-2.5-flare-generate`.** Payload `{ prompt, size: "1024x1024", quality: "low", output_format: "png", background: "opaque" }`. Model card price at 1024²: $0.0059 at low, $0.0132 at medium. It took 9 to 26 s at low (9 images, two in flight) and 21.5 s at medium. 2 of my 12 calls failed with "The server had an error while processing your request." and worked on one retry. Output is a public storage.googleapis.com PNG of 1.4 to 1.7 MB. The 8 sample-day concepts are in `handoffs/sample-worlds/<day>/concept.png`, and the prompt recipe is `tools/3d-bakeoff/recipe.json` on branch `capy/3d-bakeoff`.
- **hunyuan-3d-pro model card** (`GET .../apikey/models/hunyuan-3d-pro`): `generate_type` is Normal, LowPoly, Geometry, or Sketch (default Normal); `enable_pbr` defaults to false; `face_count` defaults to 500000 (min 40000, max 1500000, step 10000); `qworkers: 1`.
- **A rejected submit still creates a request.** The POST returns HTTP 500 with no `request_id`, but `GET .../requests` lists the request as `failed` with the same error, so count attempts there. Whether failed requests are billed is unverified.
- **LLM prices** from `GET https://api.gmi-serving.com/v1/models` (`pricing.prompt` and `pricing.completion` are USD per token, shown here per million). At these prices a scene-writer call of about 300 tokens in and 300 out costs under $0.002.

  | Model id | Input / output per M tokens |
  | --- | --- |
  | `openai/gpt-6-luna` | $0.10 / $0.50 |
  | `deepseek-ai/DeepSeek-V4-Flash` | $0.14 / $0.28 |
  | `XiaomiMiMo/MiMo-V2.6-Flash` | $0.14 / $0.28 |
  | `zai-org/GLM-5.3-Flash` | $0.15 / $0.50 |
  | `MiniMaxAI/MiniMax-M3.1-Flash` | $0.15 / $0.60 |
  | `Qwen/Qwen3.8-Flash` | $0.16 / $0.47 |
  | `google/gemini-3.1-flash-lite-preview` | $0.25 / $1.50 |
  | `deepseek-ai/deepseek-v4.1-flash-1017` | $0.30 / $1.20 |
  | `google/gemini-3.5-flash-lite` | $0.30 / $2.50 |
  | `google/gemini-3.8-flash` | $0.75 / $3.75 |
- **Reasoning models spend `max_tokens` on reasoning first.** With `max_tokens: 120`, `google/gemini-3.8-flash` returned two characters, and `deepseek-ai/DeepSeek-V4-Flash` returned `content: null` with the text in `reasoning_content`. Allow 1,000 or more tokens, or lower the reasoning effort.
