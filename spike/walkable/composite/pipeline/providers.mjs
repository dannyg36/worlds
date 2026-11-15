// Provider adapters for build-world.mjs. Each adapter turns (prompt | image url) into a downloaded local file via the
// spike kit, which enforces the composite budget cap and writes ledger/composite.jsonl.
import path from "node:path";

const kitDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../kit");
const firstFile = (files, re) => files.find((f) => re.test(f.local || f.url) && f.local) || files.find((f) => re.test(f.url));

export const PRICES = {
  gmi: {},
  fal: { "fal-ai/nano-banana-2": 0.08, "fal-ai/z-image/turbo": 0.005, "fal-ai/flux-2-pro": 0.03, "fal-ai/trellis": 0.02, "fal-ai/hyper3d/rodin/v2.5/fast": 0.1, "fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d": 0.225 },
};

export function provider(name, args) {
  if (name === "gmi") return gmiProvider(args);
  if (name === "fal") return falProvider(args);
  throw new Error("unknown provider " + name);
}

function gmiProvider(args) {
  const imageModel = args["image-model"];
  const model3d = args.model3d;
  const estImage = Number(args["est-image"]);
  const est3d = Number(args["est-3d"]);
  if (!imageModel || !model3d || !(estImage >= 0) || !(est3d >= 0)) throw new Error("gmi needs --image-model, --model3d, --est-image and --est-3d (USD, from the model's price)");
  const kit = import(path.join(kitDir, "gmi.mjs"));
  const imagePayload = JSON.parse(args["image-payload"] || "{}");
  const payload3d = JSON.parse(args["payload-3d"] || "{}");
  const imageField = args["image-field"] || "image_url";
  return {
    name: "gmi", imageModel, model3d, payload3d,
    async image({ prompt, size, label, outDir }) {
      const { run } = await kit;
      const r = await run({ approach: "composite", model: imageModel, payload: { prompt, size, ...imagePayload }, estCostUsd: estImage, label, outDir, is3d: false });
      const f = firstFile(r.files, /\.(png|jpe?g|webp)(\?|$)/i) || r.files[0];
      return { url: f.url, local: path.resolve(f.local), entry: r.entry };
    },
    async upload(local) {
      const { upload } = await kit;
      return upload(local);
    },
    async to3d({ imageUrl, label, outDir }) {
      const { run } = await kit;
      const r = await run({ approach: "composite", model: model3d, payload: { [imageField]: imageUrl, ...payload3d }, estCostUsd: est3d, label, outDir, is3d: true });
      const f = firstFile(r.files, /\.glb(\?|$)/i);
      if (!f) throw new Error("no .glb in outcome: " + JSON.stringify(r.files.map((x) => x.url)).slice(0, 300));
      return { url: f.url, local: path.resolve(f.local), bytes: f.bytes, entry: r.entry };
    },
  };
}

function falProvider(args) {
  const imageModel = args["image-model"] || "fal-ai/nano-banana-2";
  const model3d = args.model3d || "fal-ai/trellis";
  const kit = import(path.join(kitDir, "fal.mjs"));
  return {
    name: "fal", imageModel, model3d,
    async image({ prompt, aspect, label, outDir }) {
      const { run } = await kit;
      const input = imageModel.includes("nano-banana") ? { prompt, aspect_ratio: aspect, resolution: "1K", output_format: "png" } : { prompt, image_size: aspect === "1:1" ? "square_hd" : "landscape_4_3", output_format: "png" };
      const r = await run({ approach: "composite", endpoint: imageModel, input, estCostUsd: PRICES.fal[imageModel], label, outDir });
      const f = r.entry.files.find((x) => /image/.test(x.content_type || "") || /\.(png|jpe?g|webp)/i.test(x.url));
      return { url: f.url, local: path.resolve(f.local), entry: r.entry };
    },
    async upload(local) {
      const { upload } = await kit;
      return upload(local);
    },
    async to3d({ imageUrl, label, outDir }) {
      const { run } = await kit;
      const input = model3d.includes("rodin") ? { image_urls: [imageUrl], geometry_file_format: "glb", material: "PBR" } : model3d.includes("hunyuan") ? { input_image_url: imageUrl } : { image_url: imageUrl, texture_size: 1024 };
      const r = await run({ approach: "composite", endpoint: model3d, input, estCostUsd: PRICES.fal[model3d], label, outDir });
      const f = r.entry.files.find((x) => /\.glb/i.test(x.url));
      return { url: f.url, local: path.resolve(f.local), bytes: f.bytes, entry: r.entry };
    },
  };
}
