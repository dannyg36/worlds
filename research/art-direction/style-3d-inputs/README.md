# Style 3D inputs (YCCO-9)

Three images per house style, staged so the image-to-3D check can run as soon as GMI's hunyuan-3d-pro works again (DAN-18). Nothing here has been sent to 3D yet.

Each `<style>/` folder holds the three PNGs and a `manifest.json` with each image's public URL (storage.googleapis.com, no auth needed), the image model and prompt that made it, and the exact hunyuan-3d-pro jobs to submit.

## The three days
The same three days in every style, so the styles compare fairly. Each stresses a different way image-to-3D fails:
- `dolores-park`: open lawn, seated figures, the dog with his tennis ball, a palm tree.
- `birthday-dinner`: clutter and thin parts: a table and chairs, string lights on posts, the sparkler.
- `santa-cruz`: pier railings, bikes, sea lions on pilings, water.

## The jobs
12 jobs with `generate_type: "Normal"` (3 per style), plus 3 with `"LowPoly"` for the low-poly style, which is the pairing the Captain suggested. That is 15 jobs, $5.63 at $0.375 each. Every job has `enable_pbr: false` and leaves `face_count` at GMI's default.

YCCO-9 runs them one at a time, never retries a `ResourceInsufficient` error, renders each GLB from a three-quarter view textured and untextured, and puts the renders beside the flat images on the contact sheets in renders/YCCO-9/.
