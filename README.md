# worlds

Your day as a place you can walk around in. Each night you talk for about 20 seconds about your day, and a minute later it becomes a small interactive 3D world. Your year is a feed of worlds, and friends' worlds show up live when they share them.

The planned pipeline is speech-to-text, then an LLM that writes the scene, then image generation, then a 3D model from Hunyuan3D, stored in Convex and rendered as an explorable world. Supermemory keeps recurring people and places consistent across days.

## Generation

`worlds.add` starts a run in `convex/pipeline.ts`. An LLM writes the scene (title, caption, palette, and an image prompt), an image model paints a concept image, and an image-to-3D model turns it into a GLB. The image and the GLB are kept in Convex file storage, and `status` moves through `queued`, `dreaming`, `painting`, and `sculpting` to `ready` or `failed`.

GMI Cloud runs all three steps. fal.ai's models sit behind the same provider interface, and `convex/generation/models.ts` picks the models for each step, so switching a step is a one-line change. The scene-writer prompt is in `convex/generation/sceneWriterPrompt.ts`.

Every Convex deployment needs the key for its provider, and `npm test` runs the Convex tests with the providers mocked:

```bash
npx convex env set GMI_API_KEY <your GMI key>
npm test
```
