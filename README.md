# worlds

Your day as a place you can walk around in. Each night you talk for about 20 seconds about your day, and a minute later it becomes a small interactive 3D world. Your year is a feed of worlds, and friends' worlds show up live when they share them.

The planned pipeline is speech-to-text, then an LLM that writes the scene, then image generation, then a 3D model from fal.ai (Hunyuan3D or TRELLIS), stored in Convex and rendered as an explorable world. Supermemory keeps recurring people and places consistent across days.

## Stack

- Expo (SDK 58) with Expo Router and TypeScript; routes live in `src/app`.
- Convex for the backend; the `worlds` table and its `list`, `get`, `add`, and `retry` functions live in `convex/worlds.ts`.
- fal.ai generates each world. `convex/pipeline.ts` takes a new transcript through a scene writer, a concept image, and an image-to-3D model, and keeps the image and GLB in Convex file storage. Model ids and parameters live in `convex/generation/models.ts`, and the scene-writer prompt in `convex/generation/sceneWriterPrompt.ts`.

## Run it

```bash
npm install
npx convex dev   # signs you in, provisions a dev deployment, and writes EXPO_PUBLIC_CONVEX_URL to .env.local
npx convex env set FAL_KEY <your fal key>   # once, in a second terminal; every world needs it
npx expo start   # in the second terminal
npm test         # Convex tests, with fal mocked
```

Native builds need `EXPO_PUBLIC_CONVEX_URL` at bundle time, which Expo reads from `.env.local`.

fal reports finished requests to the deployment's `/fal/webhook` route when its site URL is public HTTPS, as on Convex cloud. A local deployment polls fal instead, or you can point `FAL_WEBHOOK_BASE_URL` at a public tunnel to it.
