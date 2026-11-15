# Sample worlds: fixtures for the viewer

One folder per sample day from handoffs/sample-days.md, each with `concept.png` (the 1024 x 1024 concept image) and `model.glb` (the 3D world). `manifest.json` lists the same facts per day. YCCO-8 overwrites these files in place when better models land, so code against the paths.

## Status: interim (YCCO-8, 2026-11-15)
GMI's hunyuan-3d-pro is down for our account (DAN-18), so these GLBs come from Stable Fast 3D, run anonymously on the public `stabilityai/stable-fast-3d` Hugging Face Space. They have the right format and framing, but they're rough. From the concept's viewpoint most days read as the day. From behind, every model is a smeared shell. dolores-park lost its row of houses and two palm trees, and birthday-dinner and finals-library lost parts of their floors and walls, because the background cutout fed to SF3D was too aggressive. Use them to build loading, framing, lighting, orbit, and memory handling, not to judge the look.

## Conventions
These are applied by `tools/3d-bakeoff/fixture.mjs` (branch `capy/3d-bakeoff`), and real models will get the same treatment.
- Binary glTF 2.0, Y up, one mesh with a metallic-roughness material: base color and normal textures at 1024 px. 22k to 37k triangles, 1.0 to 1.6 MB per file. No Draco or meshopt compression, so any glTF loader opens them.
- Scaled so the largest side is 1 unit, centered on X and Z, with the base resting on y = 0.
- The concept image's viewpoint is on the +Z side. A camera on +Z, 25 to 35 degrees above the horizon, looking at the center, sees the composition in `concept.png`. The base is a square turned 45 degrees, so a corner points at that camera.
- The files have no lights, cameras, or animations, so light them in the viewer.

| Day | Triangles | MB | Size (x × y × z) | Generation (s) |
| --- | --- | --- | --- | --- |
| hackathon | 22,500 | 1.0 | 1.00 × 0.95 × 0.85 | 9 |
| santa-cruz | 36,580 | 1.6 | 1.00 × 0.89 × 0.92 | 7 |
| rainy-monday | 24,544 | 1.2 | 1.00 × 0.93 × 0.86 | 62 |
| dolores-park | 24,156 | 1.1 | 1.00 × 0.74 × 0.88 | 27 |
| birthday-dinner | 29,140 | 1.6 | 1.00 × 0.91 × 0.77 | 4 |
| finals-library | 30,592 | 1.5 | 1.00 × 0.79 × 0.72 | 4 |
| mission-peak | 28,960 | 1.2 | 1.00 × 0.80 × 0.93 | 4 |
| farmers-market | 30,204 | 1.4 | 1.00 × 0.79 × 0.83 | 4 |

Generation time is from submit to the GLB on disk. It was 4 to 9 s when the Space's queue was empty and 27 to 62 s when it wasn't.

## Sources
- Concept images: GMI `gpt-image-2.5-flare-generate` at quality low, $0.006 and 11 to 26 s each, with the neutral recipe in `tools/3d-bakeoff/recipe.json` (one diorama on a square base, 3/4 isometric view, plain light grey background, no text).
- Models: SF3D with texture size 1024 and no remeshing, after cutting the background out locally.
