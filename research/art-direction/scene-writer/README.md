# Scene writer (YCCO-9)

Turns tonight's 20-second voice note into a scene spec, then into an image prompt in one of the worlds house styles. Everything here was run on GMI Cloud on 2026-11-15. The pipeline thread can drop `sceneWriter.ts` into a Convex action as is.

## Files
- `sceneWriter.ts`: self-contained TypeScript that needs only `fetch` and `GMI_API_KEY`. `writeScene(transcript, { apiKey, known?, date? })` returns `{ spec, model, ms, errors }`, `buildImagePrompt(spec, styleId)` returns the image prompt, and `GMI_IMAGE_MODELS` holds the request-queue payloads for the two image models. It typechecks under `tsc --strict --noUncheckedIndexedAccess`.
- `system-prompt.md` and `user-template.txt`: the prompt, the same text that is embedded in `sceneWriter.ts`. The user message has optional `known` (Supermemory recall, to keep recurring people, pets and places consistent) and `date` sections.
- `llm-response.schema.json`: what the LLM returns. `scene-spec.schema.json`: the stored spec, which adds `image_prompt` and `style`.
- `styles.json`: the four house styles Rikhil is choosing from. `styles.alternates.json`: four runners-up from scouting, with the same guard.
- `examples/<day>.json`: for each of the 8 sample days, the transcript, the spec gemini-3.8-flash wrote, and the image prompt in every style.

## How it runs
```ts
const { spec } = await writeScene(transcript, { apiKey: process.env.GMI_API_KEY!, known, date });
const prompt = buildImagePrompt(spec, DEFAULT_STYLE);
// POST https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey/requests
//   { model: GMI_IMAGE_MODELS.flare.model, payload: GMI_IMAGE_MODELS.flare.payload(prompt) }
// GET .../requests/{request_id} until status is "success"; the image is outcome.media_urls[0].url (a public URL).
```
The image prompt is the style's `lead` + the spec's `scene` + the style's `look` + the style's `guard`. The LLM never sees the style: it writes content only, so one spec renders in any style and the style can change without re-running the LLM. The guard is the same in every style (one centered object filling about two thirds of the frame, nothing beyond its edges, a plain background, soft light, no text), because that is what image-to-3D needs. `DEFAULT_STYLE` is `clay` until Rikhil picks; it is one constant.

## LLM choice
Primary: `google/gemini-3.8-flash` on GMI's OpenAI-compatible endpoint (`https://api.gmi-serving.com/v1/chat/completions`) with `response_format: { type: "json_object" }` (the schema is appended to the system prompt) and `reasoning_effort: "minimal"`. Fallback: `deepseek-ai/deepseek-v4.1-flash-1017` with strict `json_schema` and `thinking: { type: "disabled" }`, tried up to twice. `parseSceneSpec` validates every field, so a bad reply moves on to the next attempt instead of reaching the image model.

Why `json_object` for Gemini: in strict `json_schema` mode, Gemini on GMI returned unparsable JSON for the profanity input in 2 of 2 runs (raw newlines inside strings, a truncated reply). In `json_object` mode with minimal reasoning it parsed 90 of 90 across three runs.

Each model ran the same prompt on 15 inputs (the 8 sample days plus 7 edge cases), twice each:

| Model and settings | p50 | max | Cost per call | Problems in 30 runs |
| --- | --- | --- | --- | --- |
| gemini-3.8-flash, json_object, reasoning minimal (final prompt) | 4.2 s | 6.7 s | $0.0029 | 1 cosmetic: "miniature" used for a laptop screen |
| gemini-3.8-flash, strict json_schema | 4.4 s | 10.0 s | $0.0031 | 2 unparsable replies |
| deepseek-v4.1-flash, strict json_schema, thinking off | 1.9 s | 2.3 s | $0.0006 | caption over 12 words in 14; a name in the scene in 1 of 15 on the final prompt; 1 malformed reply in about 55 calls overall |
| gpt-6-luna, reasoning none | 7.3 s | 9.2 s | $0.0003 | the pet's name in the scene twice (it would be painted as lettering) |

Dropped after one probe: grok-4.7 (about 50 s), Qwen3.8-Flash (about 53 s), and GLM-5.3-Flash and MiniMax-M3.1-Flash (both spent the token budget on reasoning and returned no JSON). GMI serves no Claude models to this key.

## How it behaves (final prompt, gemini-3.8-flash, 2 runs per input)
- Picks one moment and keeps the personal details as visible elements: the dog with his tennis ball, the purple carrots, the sparkler on the tiramisu, the cat drawn in the latte foam.
- Never puts a name in the scene (names get painted as lettering); names stay in the caption.
- Empty input gives `status: "empty"` and a calm default world titled "A Quiet Night". Filler gives `status: "sparse"` with no invented events.
- A rambling note still becomes one moment. A sad day becomes a calm, tender scene with an honest caption.
- Profanity is never repeated in any field. A transcript that tries to change the task or format is ignored.
- A Spanish note gets its title and caption in Spanish; every other field stays in English.
- Everything stands on one small patch: no horizon, sky or distant scenery (the frisbee players become two tiny figures at the back edge).

## Image models on GMI
- `gpt-image-2.5-flare-generate`, quality medium, 1024 px: $0.0132 per image, p50 25 s over 32 images (an occasional HTTP 500 at submit succeeds on retry). Recommended: it is the cheapest, it follows the prompt most closely, and it is never rate-limited.
- `seedream-5.0-lite`, 2048 px minimum: $0.035 per image, about 31 s when not throttled, but GMI allows 2 requests a minute across the whole account (HTTP 429 with `retry_after_ms`), so it is fine for art direction and wrong for production unless GMI raises that limit.
- Tried and dropped: `gemini-3.1-flash-image` (ignored the plain background), `hy-image-v3.5-preview` (works, weaker), `gemini-nano-banana-2.1`, `gemini-3.1-flash-lite-image` and `wan2.7-image` (HTTP 500 all session), `Flux2-Klein` (stuck in the queue), and `Z-Image-Turbo` (prompts capped at 250 characters, and ours run about 1,200).
