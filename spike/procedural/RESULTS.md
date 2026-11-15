# Islands: a whole day as one island (current approach)

Each world is now an island with 4 or 5 vignettes, one per moment of the day, in order, joined by a trail. The hero moment sits at the front, a landmark stands in the middle, and every empty patch of ground is filled automatically. The format and the scene writer's prompt are in `ISLAND.md`. Start with `results/sheet-islands.jpg`: 8 demo days from the front and from behind.

## How a world is made
1. **Outline:** Claude Opus 5.5 (`claude-opus-5-5`) writes the island outline from the voice note: title, caption, palette, time of day, biome, landmark, a cast with fixed looks, and 4 or 5 vignette briefs.
2. **Vignettes:** one Claude call per vignette, all in parallel, places objects from the kit (75 types) and writes small three.js functions (`custom` objects) for details the kit lacks: sea lions, a cat drawn in latte foam, the Mission Peak pole, the Ferry Building clock tower.
3. **Checks:** every vignette is validated, gets one repair call if it fails, and anything still invalid is dropped rather than failing the world.
4. **Render:** `world.js` builds the island.
   - **Terrain:** `island.js` builds the plots, trail, beach, cliffs and sea.
   - **Vignettes:** each one is placed on its plot.
   - **Filler:** `scatter.js` plants about 1,000 instanced items, in 12–27 draw calls.
   - **Draw calls:** plain materials are baked into vertex colours and merged by material, so a full island is 360–790 draw calls including the shadow and AO passes. Without merging the hackathon island was 4,877.

## Numbers
**Writing a world with Claude Opus 5.5** (`island-gen.mjs`, measured):

| Step | Time |
| --- | --- |
| Outline | 11–13 s |
| Slowest vignette, all running in parallel | about 21 s |
| Total | 33–48 s |

- **Cost:** $0.25–0.32 per world; about 90% of it is output tokens.
- **Prompt caching:** `ISLAND.md` is a 4.5k-token cached system prompt, so the parallel calls read it from cache.
- **Gemini 3.8 Flash on GMI:** 25 s and $0.06, but it loses detail (one run dropped the eight diners).
- **Parallel-call fix:** Node's built-in fetch ran the parallel calls one at a time over a shared HTTP/2 connection (90–105 s). `island-gen.mjs` forces HTTP/1.1. The Convex pipeline needs checking for the same thing after the first deploy.

**Rendering:** 160–230 ms to build an island in headless Chrome on a Mac. Not yet measured on a real iPhone; the app uses `quality: "low"` (no GTAO or SMAA, half-resolution bloom).

## In the app
- **Pipeline** (`convex/pipeline.ts`): `dreaming` writes the island with Claude and stores it as `scene` (a JSON string) along with `title`, `caption` and `palette`. Then `painting` makes the feed thumbnail on GMI, and the world goes `ready`. A failed thumbnail no longer fails a world that has a scene. Sculpting (image-to-3D) is off.
- **World screen** (`src/app/world/[id].tsx`): renders `IslandViewer` (`src/world/island-viewer.tsx`, an Expo DOM component around `createWorld`) as soon as `scene` exists, even before the thumbnail is done.
- **Samples:** `src/world/fixtures.ts` gives all 8 sample days their island when `EXPO_PUBLIC_FIXTURES=1`.
- **Sync:** `npm run sync:island` copies the kit and the demo islands into `src/world/island/` and regenerates `convex/generation/islandPrompt.ts` from `ISLAND.md`. Run it after changing anything in `spike/procedural`.

## To turn on live generation
```bash
npx convex env set ANTHROPIC_API_KEY <key>     # GMI_API_KEY is still needed for the thumbnail
npx convex dev --once                         # pushes functions and regenerates convex/_generated
```
Use your own dev deployment, not the one the team's phones use.

## Known gaps
- **No phone test yet:** FPS and memory on a real iPhone haven't been measured.
- **Backs of buildings:** shop fronts are plain from behind, and back vignettes show their walls to the default camera until you orbit.
- **Bright scenes:** noon beach scenes wash out a little.
- **Cast colours:** a cast member's colours override per-vignette `skin`/`shirt` on purpose; for one-off looks (a sunburn), use a custom overlay.

---

# Procedural dioramas: an LLM writes the scene, three.js builds it

Spike from 2026-11-15. The question: instead of turning a concept image into a mesh (image-to-3D melts small things and hallucinates the back), can an LLM write a scene spec that a kit of hand-made three.js parts renders as a dense, orbitable diorama, fast enough for the one-minute pipeline?

**Answer: yes, and it's cheap and fast. It looks like a clean clay toy set rather than the painted concept, and the gap is mostly composition and kit coverage, which are both fixable.** Start with `results/sheet-procedural.jpg`.

## How it works
1. **Scene writer.** An LLM gets `SCHEMA.md` as its system prompt and returns one JSON spec: time of day, base, and 40 to 90 objects (`person`, `table`, `string-lights`, `cake` with a sparkler, …) with positions, rotations and `on` for things that sit on other things. Two inputs were tried: the transcript alone ("text"), and the transcript plus a GMI concept image ("image").
2. **Kit.** `parts/*.js` builds every type from rounded primitives, canvas textures and a shared clay normal map: 40 types: furniture 7, people 2, structures 8, nature 5, props 18. Each part takes its params with defaults, so a sparse spec still renders.
3. **Renderer** (`main.js`):
   - **Look:** time-of-day lighting with shadows and a room environment map, point lights merged from glowing parts, then GTAO, a colour clamp, bloom, SMAA and a vignette with grain.
   - **Layout:** the base shrinks to wrap the content and the camera frames it.
   - **Speed:** every static mesh that shares a material is merged into one draw call.
   - **Backdrop:** `?pano=<name>` puts a 360° panorama behind the diorama.

## Numbers
**Scene writing on GMI, `google/gemini-3.8-flash`:**

| Step | Time | Cost |
| --- | --- | --- |
| Text to spec | 10 to 26 s | $0.009 to $0.017 |
| Concept image to spec | 18 to 26 s | $0.013 to $0.017 |
| Paint a concept, then write the spec (`gen.mjs --paint`) | 47 s total | $0.02 |

- The image is downscaled to a 768 px JPEG first. At full size, one call ran past Cloudflare's 100 s limit (HTTP 524), so requests now stream.
- **Build:** 75 to 120 ms in headless Chrome on a Mac. That's the time from spec to scene, not counting the page load.
- **Load:** 37 to 76 objects become 55 to 170 merged meshes, which is 380 to 900 draw calls per frame across the shadow, AO and main passes, and 150k to 580k triangles across those passes.
- **Not yet measured on a real iPhone.**
- **Spend this session:** about $0.25 of GMI credit confirmed, all logged in `gen-ledger.jsonl` and `compare/ledger.jsonl`.

## What we learned
- **Image to spec beats text to spec.** Reading the concept image keeps its composition: the library's three window bays and wall of shelves, and the hackathon's L of walls. Text-only specs spread out and leave a big empty floor.
- **Painting first is the best pipeline.**
  - **The steps:** GMI paints a clay concept with the people in it (23 s, $0.006), and Gemini reads it (26 s, $0.017).
  - **The result:** the corner house and roof, a table of 10 cheering, and the guitarist on the pier (`results/birthday-dinner.image.gmi.jpg`).
  - **Why paint first:** the painting doubles as the feed thumbnail. If the image has no people, the spec drops them too, so the paint prompt has to ask for them.
- **Claude writes denser, more intentional specs than Gemini Flash** (54 to 76 objects against 37 to 62). Gemini Flash on `reasoning_effort: "low"` once spent 7.7k of its 8k tokens on reasoning.
- **It's real 3D all the way round.** Every view from behind shows real walls, chairs and people (`results/*.back.jpg`), with nothing smeared.
- **The quality gap against the painted concept:**
  - **Scale:** the painting is about a 4 m vignette packed with props, while our specs spread real-size furniture over 9 m, so the floor dominates and props are tiny from the hero camera. `SCHEMA.md` rule 7 (a footprint of about 7 x 7 m, with the front dressed) helped; a smaller world scale or a closer camera would help more.
  - **Kit gaps the writers had to fake with boxes:** water, pier, desk lamp, whiteboard, pizza box, backpack, bin, window views (skyline, snow), rug.
  - **Glow:** light surfaces next to the sparkler or a candle still bloom.
  - **Walls from behind:** back walls hide the scene when you orbit behind it. Dioramas usually fade walls that face away from the camera (a cutaway).

## Other routes, checked live the same day
- **Image-to-3D on GMI (`hunyuan-3d-pro`):** still fails with `[ResourceInsufficient]`. The new key is on the same GMI account (request `3da71802-c0c1-4242-921d-e3ad1275795a`). Image-to-3D now means fal.
- **360° panorama backdrop:** works, in about 50 s for $0.068 (flare at 2048x1024, then a bria-genfill seam fix), and is saved as `pano/birthday-dinner.jpg`. It came out painterly, not clay, so the prompt needs a stronger style cue. Try it with `?pano=birthday-dinner`.
- **Prior art** (research summary): no off-the-shelf JS text-to-scene system exists. Holodeck, SceneCraft and Infinigen use the same LLM-spec-plus-solver idea, but need Python, Blender or Unity. CC0 stylized kits (Quaternius, KayKit, Kenney) are the best source if we want ready-made people and props instead of parametric ones.

## Next steps, in order
1. **Fill the kit gaps** above: water, pier, desk lamp, whiteboard, pizza box, rug, window view. Each is about 30 to 60 minutes of work for one agent.
2. **Add a cutaway:** fade walls between the camera and the scene centre while orbiting.
3. **Tighten scale:** a smaller default footprint and a closer hero camera, and maybe figures at about 1.2x.
4. **Add a critique pass:** render the hero view, show it to the vision model next to the concept, and apply its fixes to the spec (about 15 to 25 s).
5. **Wire it into the app:** the pipeline stores the spec, and the viewer builds it on the phone. A 5 to 10 KB JSON replaces the GLB, with no 3D provider and no file storage. Then check FPS and memory on a real iPhone.
6. **Optionally use fal ($10 budget) for one unique hero prop per world** that the kit can't build, placed like any other object.

## Run it
```bash
npm install --prefix spike/procedural
node spike/procedural/shot.mjs "scene=birthday-dinner.image.gmi&size=1000" out.png     # render a spec (yaw, elev, dist, tx, ty, tz, time, pano, post=0, merge=0, fit=0)
node spike/procedural/shot.mjs "gallery=people&size=900" people.png                     # one module's parts on a board (furniture, people, structures, nature, props, all)
node spike/procedural/shot.mjs --serve                                                  # serve for a real browser with orbit controls
node --env-file=<file with GMI_API_KEY> spike/procedural/gen.mjs --day birthday-dinner --mode image --paint   # paint + write on GMI
node spike/procedural/validate.mjs spike/procedural/scenes/*.json
node spike/procedural/sheet.mjs out.png "Title" "Row" a.png:"caption" b.png:"caption" -- "Row 2" ...
```
Scenes: `scenes/<day>.text.json` and `<day>.image.json` were written by Claude subagents (an upper bound on spec quality). `*.gmi.json` were written by Gemini 3.8 Flash on GMI, which is what the pipeline would actually run.
