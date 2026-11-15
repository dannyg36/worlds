#!/usr/bin/env bash
# Recreates the local placeholder assets used before generated assets existed:
# Poly Haven CC0 panoramas (blender_institute, cliffside) and three.js LittlestTokyo.glb.
set -euo pipefail
D="$(cd "$(dirname "$0")/.." && pwd)/assets/_sample"
mkdir -p "$D"
T=$(mktemp -d)
curl -sL -o "$T/indoor.jpg" https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/blender_institute.jpg
curl -sL -o "$T/outdoor.jpg" https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/cliffside.jpg
curl -sL -o "$D/diorama.glb" https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/models/gltf/LittlestTokyo.glb
for n in indoor outdoor; do
  ffmpeg -y -v error -i "$T/$n.jpg" -vf scale=2048:1024:flags=lanczos -q:v 3 "$D/pano-$n.jpg"
  ffmpeg -y -v error -i "$T/$n.jpg" -vf scale=4096:2048:flags=lanczos -q:v 3 "$D/pano-$n-4k.jpg"
done
rm -rf "$T"
ls -la "$D"
